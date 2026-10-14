'use strict';

const express = require('express');
const chatbotAnalytics = require('../chatbot/analytics');
const { auditLogStore, drillsStore, employeesStore, hazardsStore, penaltiesStore, permitsRepo, readAuditLog, readDrills, readEmployees, readHazards, readPenalties, readTrainings, trainingsStore } = require('../data/stores');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { cacheJsonResponse, viewerKey } = require('../middleware/http-cache');
const { normalizeEmpCode } = require('../utils/validation');

const router = express.Router();
function isSoftDeletedRecord(rec) {
  const db = rec && rec.deletedBy;
  return !!(db && (db.areaAdmin || db.safetyAdmin || db.superAdmin || db.worker));
}
function daysBetween(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  if (isNaN(d1) || isNaN(d2)) return null;
  const diff = (d2 - d1) / 86400000;
  return diff >= 0 ? diff : null;
}

const executiveOverviewCache = cacheJsonResponse({
  stores: [permitsRepo, hazardsStore, trainingsStore, drillsStore, penaltiesStore, employeesStore, auditLogStore],
  keyFn: req => `exec:${viewerKey(req)}:${req.originalUrl}`,
});
router.get('/api/executive/overview', authenticateToken, requireRole('ceo', 'super_admin', 'hse_admin'), executiveOverviewCache, (req, res) => {
  try {
    let permits = permitsRepo.all().filter(p => !isSoftDeletedRecord(p));

    const hazards   = readHazards().filter(h => !isSoftDeletedRecord(h) && !(h.permanentlyDeletedBy && Object.values(h.permanentlyDeletedBy).some(Boolean)));
    const employees = readEmployees();
    const trainings = readTrainings();
    const drills     = readDrills();
    const penalties  = readPenalties().filter(p => p.status !== 'deleted');

    const permitsByStatus = {};
    const approvalDurations = [];
    permits.forEach(p => {
      const st = p.status || 'pending';
      permitsByStatus[st] = (permitsByStatus[st] || 0) + 1;
      if (p.createdAt && p.reviewedAt && (st === 'approved' || st === 'rejected')) {
        const d = daysBetween(p.createdAt, p.reviewedAt);
        if (d !== null) approvalDurations.push(d);
      }
    });
    const avgApprovalDays = approvalDurations.length
      ? Math.round((approvalDurations.reduce((a, b) => a + b, 0) / approvalDurations.length) * 10) / 10
      : null;

    const hazardsByStatus = {};
    const hazardsByRisk = {};
    const closureDurations = [];
    hazards.forEach(h => {
      const st = h.status || 'open';
      hazardsByStatus[st] = (hazardsByStatus[st] || 0) + 1;
      const risk = h.riskLevel || 'غير محدد';
      hazardsByRisk[risk] = (hazardsByRisk[risk] || 0) + 1;
      if (h.submittedAt && h.resolvedAt) {
        const d = daysBetween(h.submittedAt, h.resolvedAt);
        if (d !== null) closureDurations.push(d);
      }
    });
    const avgClosureDays = closureDurations.length
      ? Math.round((closureDurations.reduce((a, b) => a + b, 0) / closureDurations.length) * 10) / 10
      : null;

    const deptMap = new Map();
    function deptBucket(name) {
      const key = String(name || '').trim();
      if (!key) return null;
      if (!deptMap.has(key)) {
        deptMap.set(key, { department: key, hazardsTotal: 0, hazardsClosed: 0, permitsTotal: 0, permitsApproved: 0, employeeCount: 0 });
      }
      return deptMap.get(key);
    }
    hazards.forEach(h => {
      const b = deptBucket(h.department);
      if (!b) return;
      b.hazardsTotal++;
      if (h.status === 'closed') b.hazardsClosed++;
    });
    permits.forEach(p => {
      const b = deptBucket(p.department);
      if (!b) return;
      b.permitsTotal++;
      if (p.status === 'approved') b.permitsApproved++;
    });
    employees.forEach(e => {
      const b = deptBucket(e.department);
      if (b) b.employeeCount++;
    });
    const execCompliance = chatbotAnalytics.complianceData(
      { data: { employees, trainings, hazards, penalties } },
      { depts: [] }
    );
    const scoreByDept = new Map();
    execCompliance.rows.forEach(r => {
      const dept = String((r.emp && r.emp.department) || '').trim();
      if (!dept) return;
      if (!scoreByDept.has(dept)) scoreByDept.set(dept, { scores: [], trainOk: 0, hazOk: 0, penalties: 0 });
      const b = scoreByDept.get(dept);
      b.scores.push(r.score);
      if (r.trainOk) b.trainOk++;
      if (r.hazOk) b.hazOk++;
      b.penalties += r.penalties;
    });
    const departmentLeaderboard = Array.from(scoreByDept.entries())
      .filter(([, b]) => b.scores.length >= 3)
      .map(([department, b]) => {
        const act = deptMap.get(department) || {};
        return {
          department,
          employeeCount: b.scores.length,
          score: Math.round((b.scores.reduce((s, v) => s + v, 0) / b.scores.length) * 10) / 10,
          trainAchieved: b.trainOk,
          hazardAchieved: b.hazOk,
          penalties: b.penalties,
          hazardsTotal: act.hazardsTotal || 0,
          hazardsClosed: act.hazardsClosed || 0,
          hazardsOpen: (act.hazardsTotal || 0) - (act.hazardsClosed || 0),
          permitsTotal: act.permitsTotal || 0,
        };
      })
      .sort((a, b) => b.score - a.score);

    const companySafetyScore = departmentLeaderboard.length
      ? Math.round((departmentLeaderboard.reduce((s, d) => s + d.score, 0) / departmentLeaderboard.length) * 10) / 10
      : null;

    const oneYearAgo = new Date(); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const recentTrainings = trainings.filter(t => t.date && new Date(t.date) >= oneYearAgo);
    const trainingAttendeeSet = new Set();
    let trainingAttendances = 0;
    recentTrainings.forEach(t => (t.attendees || []).forEach(a => {
      trainingAttendances++;
      if (a.code || a.empCode) trainingAttendeeSet.add(normalizeEmpCode(a.code || a.empCode));
    }));

    const recentDrills = drills.filter(d => d.date && new Date(d.date) >= oneYearAgo);
    let drillAttendances = 0;
    recentDrills.forEach(d => { drillAttendances += (d.attendees || []).length; });

    const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const auditLog = readAuditLog();
    const recentActivityCount = auditLog.filter(e => e.timestamp && new Date(e.timestamp) >= sevenDaysAgo).length;

    res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        employees: employees.length,
        permits: permits.length,
        hazards: hazards.length,
        openHazards: hazardsByStatus.open || 0,
        activePenalties: penalties.length,
      },
      permits: { byStatus: permitsByStatus, avgApprovalDays },
      hazards: { byStatus: hazardsByStatus, byRiskLevel: hazardsByRisk, avgClosureDays },
      training: {
        sessionsLast12Months: recentTrainings.length,
        attendancesLast12Months: trainingAttendances,
        uniqueEmployeesTrainedLast12Months: trainingAttendeeSet.size
      },
      drills: {
        sessionsLast12Months: recentDrills.length,
        attendancesLast12Months: drillAttendances
      },
      companySafetyScore,
      departmentLeaderboard,
      recentActivityCount7d: recentActivityCount
    });
  } catch (err) {
    console.error('[Executive] Overview failed:', err);
    res.status(500).json({ error: 'فشل تحميل المؤشرات التنفيذية' });
  }
});

module.exports = router;
