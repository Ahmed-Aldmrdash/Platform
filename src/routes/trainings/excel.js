'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const { readEmployees, readTrainings, writeTrainings } = require('../../data/stores');
const { enqueueWrite } = require('../../data/write-queue');
const { authenticateToken, requireRole } = require('../../middleware/auth');
const { normalizeEmpCode, sanitizeStr, deptMatches } = require('../../utils/validation');
const { setDownloadFilename } = require('../../utils/http');
const { finalizeExcel } = require('../../services/excel');

const router = express.Router();

router.post('/api/trainings/upload-excel', authenticateToken, requireRole('super_admin', 'hse_admin'), async (req, res) => {
  try {
    const { base64Data } = req.body;
    if (!base64Data) {
      return res.status(400).json({ success: false, message: 'No file data provided' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    let ws = workbook.worksheets[0];
    let headerRowNumber = 1;
    let colMap = { code: 1, name: 2, dept: 3, pos: 4, location: 5, topic: 6, date: 7, trainer: 8, duration: 9 };
    let headersFound = false;

    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row, rowNum) => {
        if (headersFound || rowNum > 5) return;
        const vals = row.values;
        const hasCode = vals.some(v => v && (String(v).toLowerCase().includes('code') || String(v).includes('كود')));
        const hasTopic = vals.some(v => v && (String(v).toLowerCase().includes('topic') || String(v).includes('موضوع')));

        if (hasCode && hasTopic) {
          ws = sheet;
          headerRowNumber = rowNum;
          headersFound = true;

          vals.forEach((v, idx) => {
            if (!v) return;
            const val = String(v).toLowerCase();
            if (val.includes('code') || val.includes('كود')) colMap.code = idx;
            else if (val.includes('name') || val.includes('اسم')) colMap.name = idx;
            else if (val.includes('department') || val.includes('قسم')) colMap.dept = idx;
            else if (val.includes('position') || val.includes('وظيفة')) colMap.pos = idx;
            else if (val.includes('location') || val.includes('مكان') || val.includes('منطقة')) colMap.location = idx;
            else if (val.includes('topic') || val.includes('موضوع') || val.includes('محاضرة')) colMap.topic = idx;
            else if (val.includes('date') || val.includes('تاريخ')) colMap.date = idx;
            else if (val.includes('supervisor') || val.includes('محاضر') || val.includes('مدرب')) colMap.trainer = idx;
            else if (val.includes('duration') || val.includes('مدة') || val.includes('وقت')) colMap.duration = idx;
          });
        }
      });
      if (headersFound) break;
    }

    const sessions = {};

    ws.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowNumber) return;
      const vals = row.values;

      const code = normalizeEmpCode(sanitizeStr(String(vals[colMap.code] || '').trim(), 20));
      if (!code || code === 'undefined') return;

      const name = sanitizeStr(String(vals[colMap.name] || '').trim(), 150);
      const dept = sanitizeStr(String(vals[colMap.dept] || '').trim(), 100);
      const topic = sanitizeStr(String(vals[colMap.topic] || '').trim(), 200);

      let dateObj = vals[colMap.date];
      if (!dateObj) return;

      let d = null;
      if (dateObj instanceof Date) {
        d = dateObj;
      } else if (typeof dateObj === 'string') {
        const parsed = new Date(dateObj.trim());
        if (!isNaN(parsed.getTime())) d = parsed;
      } else if (typeof dateObj === 'number') {
        d = new Date(Math.round((dateObj - 25569) * 86400 * 1000));
      }

      if (d) {
        const y = d.getFullYear();
        if (y < 2000 || y > 2100) d = null;
      }
      if (!d || isNaN(d.getTime())) return;
      const dateStr = d.toISOString().split('T')[0];

      const trainer = sanitizeStr(String(vals[colMap.trainer] || '').trim(), 150);
      const duration = parseFloat(vals[colMap.duration]) || 0;

      const sessionKey = `${topic}_${dateStr}_${trainer}`;

      if (!sessions[sessionKey]) {
        sessions[sessionKey] = {
          id: 'TRN-' + Date.now() + '-' + Math.floor(Math.random() * 1000) + '-' + Object.keys(sessions).length,
          title: topic,
          topic: topic,
          type: 'مخطط',
          targetGroup: dept,
          trainer: trainer,
          date: dateStr,
          duration: duration,
          description: 'تم الاستيراد من ملف Excel',
          status: 'closed',
          isClosed: true,
          createdAt: dateStr,
          closedAt: dateStr,
          attendees: []
        };
      }

      const s = sessions[sessionKey];
      if (!s.attendees.find(a => a.code === code)) {
        s.attendees.push({ code, name, department: dept, verified: true, attendanceTime: dateStr });
      }

      if (s.targetGroup !== 'متعدد' && s.targetGroup !== dept) {
        s.targetGroup = 'متعدد';
      }
    });

    const importedList = Object.values(sessions);
    await enqueueWrite(async () => writeTrainings([...readTrainings(), ...importedList]));
    res.json({ success: true, count: importedList.length });
  } catch (error) {
    console.error('Error parsing Excel:', error);
    res.status(500).json({ success: false, message: 'Invalid Excel file or parsing error' });
  }
});

router.post('/api/trainings/export-bulk', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'No training IDs provided' });
    }

    const allTrainings = readTrainings();
    const targetTrainings = allTrainings.filter(t => ids.includes(t.id));

    if (targetTrainings.length === 0) {
      return res.status(404).json({ error: 'No matching trainings found' });
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('سجل المحاضرات المجمع');
    sheet.views = [{ rightToLeft: true }];

    sheet.columns = [
      { header: 'موضوع المحاضرة', key: 'topic', width: 30 },
      { header: 'اسم المحاضر', key: 'trainer', width: 25 },
      { header: 'تاريخ المحاضرة', key: 'date', width: 15 },
      { header: 'كود الموظف', key: 'empCode', width: 15 },
      { header: 'اسم الموظف', key: 'empName', width: 30 },
      { header: 'القسم', key: 'department', width: 25 },
      { header: 'حالة الحضور', key: 'status', width: 15 }
    ];

    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD51E27' } };
    sheet.getRow(1).alignment = { horizontal: 'center' };

    targetTrainings.forEach(trn => {
      trn.attendees.forEach(att => {
        sheet.addRow({
          topic: trn.topic || trn.title || '',
          trainer: trn.trainer || '',
          date: trn.date || trn.createdAt || '',
          empCode: att.code || att.empCode || '',
          empName: att.name || att.empName || '',
          department: att.department || '',
          status: att.verified ? 'مؤكد' : 'غير مؤكد'
        });
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(workbook, 'سجل المحاضرات التدريبية');
    setDownloadFilename(res, `سجل المحاضرات التدريبية - ${new Date().toISOString().slice(0,10)}`, 'xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Error generating bulk Excel:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/api/trainings/:id/export-excel', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), async (req, res) => {
  try {
    const trainings = readTrainings();
    const trn = trainings.find(t => t.id === req.params.id);
    if (!trn) return res.status(404).json({ error: 'المحاضرة غير موجودة' });

    const employees = readEmployees();
    const empMap = new Map();
    employees.forEach(e => {
      const code = normalizeEmpCode(e.code || e.empCode);
      if (code) empMap.set(code, e);
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('سجل الحضور');

    const topicName = trn.topic || trn.title || 'غير محدد';
    const trainerName = trn.trainer || 'غير محدد';
    const trainerCode = trn.trainerCode || trn.trainer_code || 'غير مسجل';
    const trainingDate = trn.date || '';
    const trainingLoc = trn.location || 'غير محدد';

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD51E27' } };

    ws.addRow([`الموضوع / اسم المحاضرة: ${topicName}`]);
    ws.getRow(1).getCell(1).style = { font: { bold: true, size: 13, color: { argb: 'FFD51E27' } }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A1:F1');

    ws.addRow([`اسم المحاضر: ${trainerName}`]);
    ws.getRow(2).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A2:F2');

    ws.addRow([`كود المحاضر: ${trainerCode}`]);
    ws.getRow(3).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A3:F3');

    ws.addRow([`تاريخ المحاضرة: ${trainingDate}   |   الموقع: ${trainingLoc}`]);
    ws.getRow(4).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A4:F4');

    ws.addRow([]);

    const headerRow = ws.addRow(['الكود الوظيفي', 'الاسم', 'القسم', 'المسمى الوظيفي', 'وقت الحضور', 'حالة التأكيد']);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = headerFill;
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.columns = [
      { key: 'A', width: 16 },
      { key: 'B', width: 30 },
      { key: 'C', width: 25 },
      { key: 'D', width: 25 },
      { key: 'E', width: 25 },
      { key: 'F', width: 15 },
    ];

    trn.attendees.forEach(a => {
      const code = normalizeEmpCode(a.empCode || a.code);
      const empRec = empMap.get(code) || {};
      const position = empRec.jobTitle || a.jobTitle || 'غير محدد';
      const attendedAt = a.attendedAt || a.attendanceTime;
      ws.addRow([
        a.empCode || a.code,
        a.name || empRec.name || '',
        a.department || 'غير محدد',
        position,
        attendedAt ? new Date(attendedAt).toLocaleString('ar-EG') : '',
        a.verified ? 'مؤكد' : 'غير مؤكد'
      ]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(wb, 'حضور محاضرة تدريبية');
    setDownloadFilename(res, `محاضرة - ${trn.topic || trn.title || ''} - ${trn.date || ''}`, 'xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export training error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل تصدير الكشف' });
  }
});

router.get('/api/trainings/stats/employees', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), (req, res) => {
  let employees = readEmployees();

  if (req.user.role === 'dept_admin' && req.user.department) {
    employees = employees.filter(e => deptMatches(e.department, req.user.department));
  }

  const trainings = readTrainings();

  const statsMap = new Map();
  employees.forEach(e => {
    const code = normalizeEmpCode(e.code || e.empCode);
    if (!statsMap.has(code)) {
      statsMap.set(code, {
        empCode: code,
        name: e.name || 'غير معروف',
        department: e.department || 'غير محدد',
        attendedCount: 0,
        attendanceHours: 0,
        percentage: 0
      });
    }
  });

  trainings.filter(t => !t.isDeleted).forEach(trn => {
    trn.attendees.forEach(att => {
      if (att.verified) {
        const code = normalizeEmpCode(att.empCode || att.code);
        if (statsMap.has(code)) {
          statsMap.get(code).attendedCount++;
        }
      }
    });
  });

  const statsList = Array.from(statsMap.values()).map(stat => {
    stat.attendanceHours = stat.attendedCount * 0.5;
    stat.percentage = Math.min(100, Math.round((stat.attendanceHours / 8) * 100));
    return stat;
  });

  res.json({ stats: statsList });
});

module.exports = router;
