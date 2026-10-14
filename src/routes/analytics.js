'use strict';

// Dashboard numbers for the signed-in user, scoped to their role and department.

const express = require('express');
const {
  drillsStore, employeesStore, hazardsStore, penaltiesStore, trainingsStore, permitsRepo,
  readEmployees, shared,
} = require('../data/stores');
const { authenticateSession } = require('../middleware/auth');
const { cacheJsonResponse, viewerKey } = require('../middleware/http-cache');
const { deptMatches } = require('../utils/validation');

const router = express.Router();

const analyticsCache = cacheJsonResponse({
  stores: [permitsRepo, hazardsStore, trainingsStore, drillsStore, penaltiesStore, employeesStore],
  keyFn: (req) => `an:${viewerKey(req)}:${req.originalUrl}`,
});

router.get('/api/analytics', authenticateSession, analyticsCache, (req, res) => {
  try {
    const role = req.worker ? 'worker' : req.user.role;
    const department = req.worker ? null : (req.user.department || null);
    const tokenEmpCode = req.worker ? req.worker.empCode : null;

    let { dateFrom, dateTo, dept, empCode } = req.query;

    if (role === 'worker') {
      empCode = tokenEmpCode;
    }

    const from = dateFrom ? new Date(dateFrom) : null;
    const to   = dateTo   ? new Date(dateTo + 'T23:59:59') : null;

    function inRange(dateStr) {
      if (!dateStr) return true;
      const d = new Date(dateStr);
      if (from && d < from) return false;
      if (to   && d > to)   return false;
      return true;
    }

    const scopeDept = (role === 'dept_admin' || role === 'maint_admin') ? department : (dept || null);

    let permits  = [];
    let hazards  = [];
    let trainings = [];
    let drills   = [];
    let penalties = shared.penalties().filter(p => p.status !== 'deleted');

    permits = permitsRepo.all();

    hazards   = shared.hazards();
    trainings = shared.trainings();
    drills    = shared.drills();
    if (!Array.isArray(hazards))   hazards = [];
    if (!Array.isArray(trainings)) trainings = [];
    if (!Array.isArray(drills))    drills = [];

    function normEmp(v) {
      if (v === null || v === undefined) return '';
      const s = String(v).trim();
      const stripped = s.replace(/^0+/, '');
      return (stripped === '' ? '0' : stripped).toUpperCase();
    }
    function attendeeCode(a) {
      return normEmp(a.empCode || a.code || a.employeeCode || a.id || '');
    }

    if (scopeDept) {
      permits   = permits.filter(p  => deptMatches(p.department || p.dept, scopeDept));
      hazards   = hazards.filter(h  => deptMatches(h.department || h.dept, scopeDept));
      penalties = penalties.filter(p => deptMatches(p.department, scopeDept));

      const scopeDeptNorm = String(scopeDept).trim().toLowerCase();
      const deptEmpCodes = new Set(
        readEmployees()
          .filter(e => String(e.department || '').trim().toLowerCase() === scopeDeptNorm)
          .map(e => normEmp(e.empCode || e.code || e.id))
          .filter(Boolean)
      );
      trainings = trainings
        .map(t => ({ ...t, attendees: (t.attendees || []).filter(a => deptEmpCodes.has(attendeeCode(a))) }))
        .filter(t => t.attendees.length > 0);
      drills = drills
        .map(d => ({ ...d, attendees: (d.attendees || []).filter(a => deptEmpCodes.has(attendeeCode(a))) }))
        .filter(d => d.attendees.length > 0);
    }

    let viewingEmployee = null;
    if (empCode) {
      const wantCodeForLookup = normEmp(empCode);
      const allEmployees = readEmployees();
      let empRecord = allEmployees.find(e => normEmp(e.empCode || e.code || e.id) === wantCodeForLookup);

      if (empRecord && scopeDept && (role === 'dept_admin' || role === 'maint_admin')) {
        const empDeptNorm  = String(empRecord.department || '').trim().toLowerCase();
        const scopeDeptNorm = String(scopeDept || '').trim().toLowerCase();
        if (empDeptNorm !== scopeDeptNorm) {
          empRecord = null;
        }
      }

      if (empRecord) {
        viewingEmployee = {
          empCode:    empRecord.empCode || empRecord.code || empCode,
          name:       empRecord.name || '',
          jobTitle:   empRecord.jobTitle || '',
          department: empRecord.department || '',
        };
      } else {
        viewingEmployee = { empCode, name: '', jobTitle: '', department: '' };
      }
    }

    if (empCode) {
      const wantCode = normEmp(empCode);
      permits   = permits.filter(p => normEmp(p.employeeId || p.empCode || p.code) === wantCode);
      hazards   = hazards.filter(h => normEmp(h.empCode || h.code) === wantCode);
      trainings = trainings
        .map(t => ({ ...t, attendees: (t.attendees || []).filter(a => attendeeCode(a) === wantCode) }))
        .filter(t => t.attendees.length > 0);
      drills    = drills
        .map(d => ({ ...d, attendees: (d.attendees || []).filter(a => attendeeCode(a) === wantCode) }))
        .filter(d => d.attendees.length > 0);
      penalties = penalties.filter(p => normEmp(p.empCode) === wantCode);
    }

    permits   = permits.filter(p => inRange(p.createdAt || p.date || p.submittedAt));
    hazards   = hazards.filter(h => inRange(h.date || h.createdAt));
    trainings = trainings.filter(t => inRange(t.date || t.createdAt));
    drills    = drills.filter(d => inRange(d.date || d.createdAt));
    penalties = penalties.filter(p => inRange(p.date || p.createdAt));

    const permitTotal  = permits.length;
    const permitByStatus = {
      approved: permits.filter(p => p.status === 'approved').length,
      pending:  permits.filter(p => String(p.status || '').startsWith('pending')).length,
      rejected: permits.filter(p => String(p.status || '').startsWith('rejected')).length,
    };
    const permitByType = {};
    permits.forEach(p => {
      const t = p.typeKey || p.type || p.permitType || 'general';
      permitByType[t] = (permitByType[t] || 0) + 1;
    });

    function buildMonthly(items, dateField) {
      const months = {};
      const now = new Date();
      for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        months[key] = 0;
      }
      items.forEach(item => {
        const raw = item[dateField] || item.date || item.createdAt || item.submittedAt;
        if (!raw) return;
        const d = new Date(raw);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (key in months) months[key]++;
      });
      return months;
    }

    const permitsMonthly  = buildMonthly(permits,  'createdAt');
    const hazardsMonthly  = buildMonthly(hazards,  'date');
    const trainingsMonthly = buildMonthly(trainings, 'date');
    const drillsMonthly   = buildMonthly(drills,   'date');

    const hazardTotal = hazards.length;
    const hazardByStatus = {
      open:     hazards.filter(h => !h.status || h.status === 'open' || h.status === 'in_progress' || h.status === 'pending').length,
      resolved: hazards.filter(h => h.status === 'resolved' || h.status === 'closed').length,
      rejected: hazards.filter(h => h.status === 'rejected').length,
    };
    const hazardBySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
    hazards.forEach(h => {
      const risk = parseInt(h.riskScore || h.risk || 0);
      if (risk >= 16) hazardBySeverity.critical++;
      else if (risk >= 9 || h.riskLevel === 'H') hazardBySeverity.high++;
      else if (risk >= 4 || h.riskLevel === 'M') hazardBySeverity.medium++;
      else hazardBySeverity.low++;
    });

    const trainingTotal    = trainings.length;
    const trainingAttendees = trainings.reduce((s, t) => s + (t.attendees || []).length, 0);
    const topicCounts = {};
    trainings.forEach(t => {
      const topic = t.topic || t.title || 'غير محدد';
      topicCounts[topic] = (topicCounts[topic] || 0) + 1;
    });
    const topTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    function getTrainingDuration(t) {
      if (t && t.durationHours !== undefined && t.durationHours !== null && t.durationHours !== '') return Number(t.durationHours);
      if (t && t.hours !== undefined && t.hours !== null && t.hours !== '') return Number(t.hours);
      if (t && t.duration !== undefined && t.duration !== null && t.duration !== '') return Number(t.duration);
      if (t && t.durationMinutes) return Number(t.durationMinutes) / 60;
      return 0.5;
    }
    const trainingTotalHours = trainingAttendees / 2;
    const trainingsList = trainings
      .slice()
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
      .slice(0, 100)
      .map(t => ({
        title: t.topic || t.title || 'محاضرة تدريبية',
        date: t.date || t.createdAt || null,
        hours: getTrainingDuration(t),
        trainer: t.trainer || t.instructor || '',
      }));

    const activeDrills = drills.filter(d => d.status === 'active').length;
    const closedDrills = drills.filter(d => d.status === 'closed').length;
    const drillTotal   = drills.length;
    const drillAttendees = drills.reduce((s, d) => s + (d.attendees || []).length, 0);
    const drillsList = drills
      .slice()
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
      .slice(0, 100)
      .map(d => ({
        title: d.title || d.name || 'تجربة إخلاء',
        date: d.date || d.createdAt || null,
        status: d.status || 'active',
        location: d.location || '',
      }));

    const hazardsList = hazards
      .slice()
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
      .slice(0, 100)
      .map(h => ({
        title: h.description || h.title || h.hazardType || 'بلاغ خطورة',
        date: h.date || h.createdAt || null,
        status: (h.status === 'resolved' || h.status === 'closed') ? 'resolved' : (h.status === 'rejected' ? 'rejected' : 'open'),
        department: h.department || h.dept || '',
      }));

    const permitsList = permits
      .slice()
      .sort((a, b) => new Date(b.createdAt || b.date || 0) - new Date(a.createdAt || a.date || 0))
      .slice(0, 100)
      .map(p => ({
        title: p.typeLabel || p.type || p.permitType || 'تصريح عمل',
        date: p.createdAt || p.date || null,
        status: p.status || 'pending',
      }));

    const penaltyTotal = penalties.length;
    const penaltiesList = penalties
      .slice()
      .sort((a, b) => new Date(b.date || b.createdAt || 0) - new Date(a.date || a.createdAt || 0))
      .slice(0, 100)
      .map(p => ({
        title: p.reason || 'جزاء',
        date: p.date || p.createdAt || null,
        issuedBy: p.issuedBy || '',
        empName: p.empName || '',
      }));

    res.json({
      permits: { total: permitTotal, byStatus: permitByStatus, byType: permitByType, monthly: permitsMonthly, list: permitsList },
      hazards: { total: hazardTotal, byStatus: hazardByStatus, bySeverity: hazardBySeverity, monthly: hazardsMonthly, list: hazardsList },
      trainings: { total: trainingTotal, totalAttendees: trainingAttendees, totalHours: trainingTotalHours, topTopics, monthly: trainingsMonthly, list: trainingsList },
      drills: { total: drillTotal, active: activeDrills, closed: closedDrills, totalAttendees: drillAttendees, monthly: drillsMonthly, list: drillsList },
      penalties: { total: penaltyTotal, list: penaltiesList },
      meta: { role, scopeDept, dateFrom, dateTo, empCode: empCode || null, viewingEmployee, generatedAt: new Date().toISOString() }
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Analytics error' });
  }
});

module.exports = router;
