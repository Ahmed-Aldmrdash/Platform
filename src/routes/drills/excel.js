'use strict';

const express = require('express');
const ExcelJS = require('exceljs');
const { readDrills, readEmployees } = require('../../data/stores');
const { authenticateToken, authenticateTokenFlexible, requireRole } = require('../../middleware/auth');
const { normalizeEmpCode } = require('../../utils/validation');
const { setDownloadFilename } = require('../../utils/http');
const { finalizeExcel } = require('../../services/excel');

const router = express.Router();

router.get('/api/drills/export/:id', authenticateTokenFlexible, async (req, res) => {
  try {
    const drills = readDrills();
    const drl = drills.find(d => d.id === req.params.id);
    if (!drl) return res.status(404).send('Drill not found');

    const employees = readEmployees();
    const empMap = new Map();
    employees.forEach(e => {
      const code = normalizeEmpCode(e.code || e.empCode);
      if (code) empMap.set(code, e);
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('سجل حضور التجربة');
    const redFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD32F2F' } };
    const whiteBold = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };

    ws.addRow([`عنوان التجربة: ${drl.title || 'غير محدد'}`]);
    ws.getRow(1).getCell(1).style = { font: { bold: true, size: 13, color: { argb: 'FFD32F2F' } }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A1:E1');

    ws.addRow([`اسم المشرف: ${drl.trainer || 'غير محدد'}`]);
    ws.getRow(2).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A2:E2');

    ws.addRow([`كود المشرف: ${drl.trainerCode || 'غير مسجل'}`]);
    ws.getRow(3).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A3:E3');

    ws.addRow([`المكان: ${drl.location || 'غير محدد'}   |   التاريخ: ${drl.date || ''}`]);
    ws.getRow(4).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A4:E4');

    ws.addRow([]);

    const headerRow = ws.addRow(['الكود الوظيفي', 'الاسم', 'القسم / المسمى', 'وقت الحضور', 'حالة التأكيد']);
    headerRow.font = whiteBold;
    headerRow.fill = redFill;
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    ws.columns = [
      { key: 'A', width: 16 },
      { key: 'B', width: 30 },
      { key: 'C', width: 28 },
      { key: 'D', width: 25 },
      { key: 'E', width: 15 },
    ];

    if (drl.attendees && drl.attendees.length > 0) {
      drl.attendees.forEach(a => {
        const code = normalizeEmpCode(a.empCode);
        const empRec = empMap.get(code) || {};
        ws.addRow([
          a.empCode,
          a.name || empRec.name || 'غير محدد',
          a.department || empRec.department || 'غير محدد',
          a.attendedAt ? new Date(a.attendedAt).toLocaleString('ar-EG') : '',
          a.verified ? 'مؤكد' : 'غير مؤكد'
        ]);
      });
    } else {
      ws.addRow(['لا يوجد حضور مسجل في هذه التجربة']);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(wb, 'حضور تجربة طوارئ');
    setDownloadFilename(res, `حضور تجربة طوارئ - ${drl.title || ''} - ${drl.date || ''}`, 'xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export drill error:', err);
    if (!res.headersSent) res.status(500).send('Error generating Excel file');
  }
});

// Only HSE sees the attendance PIN; other admin roles get the sessions without it.
router.get('/api/drills/:id/export-excel', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), async (req, res) => {
  try {
    const drills = readDrills();
    const drl = drills.find(t => t.id === req.params.id);
    if (!drl) return res.status(404).json({ error: 'التجربة غير موجودة' });

    const employees = readEmployees();
    const empMap = new Map();
    employees.forEach(e => {
      const code = normalizeEmpCode(e.code || e.empCode);
      if (code) empMap.set(code, e);
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('سجل الحضور');

    const titleName = drl.title || 'غير محدد';
    const trainerName = drl.trainer || 'غير محدد';
    const trainerCode = drl.trainerCode || drl.trainer_code || 'غير مسجل';
    const drillDate = drl.date || '';
    const drillLoc = drl.location || 'غير محدد';

    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD51E27' } };

    ws.addRow([`الموضوع / اسم التجربة: ${titleName}`]);
    ws.getRow(1).getCell(1).style = { font: { bold: true, size: 13, color: { argb: 'FFD51E27' } }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A1:F1');

    ws.addRow([`اسم المحاضر: ${trainerName}`]);
    ws.getRow(2).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A2:F2');

    ws.addRow([`كود المحاضر: ${trainerCode}`]);
    ws.getRow(3).getCell(1).style = { font: { bold: true, size: 11 }, alignment: { horizontal: 'right' } };
    ws.mergeCells('A3:F3');

    ws.addRow([`تاريخ التجربة: ${drillDate}   |   الموقع: ${drillLoc}`]);
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

    drl.attendees.forEach(a => {
      const code = normalizeEmpCode(a.empCode);
      const empRec = empMap.get(code) || {};
      const position = empRec.jobTitle || a.jobTitle || 'غير محدد';
      ws.addRow([
        a.empCode,
        a.name,
        a.department || 'غير محدد',
        position,
        new Date(a.attendedAt).toLocaleString('ar-EG'),
        a.verified ? 'مؤكد' : 'غير مؤكد'
      ]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    finalizeExcel(wb, 'تقرير تجربة طوارئ');
    setDownloadFilename(res, `تجربة طوارئ - ${drl.title || ''} - ${drl.date || ''}`, 'xlsx');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export drill error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'فشل تصدير الكشف' });
  }
});

router.get('/api/drills/stats/employees', authenticateToken, requireRole('super_admin', 'hse_admin', 'dept_admin'), (req, res) => {
  let employees = readEmployees();

  if (req.user.role === 'dept_admin' && req.user.department) {
    employees = employees.filter(e => e.department === req.user.department);
  }

  const drills = readDrills();

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

  drills.filter(t => !t.isDeleted).forEach(drl => {
    drl.attendees.forEach(att => {
      if (att.verified) {
        const code = normalizeEmpCode(att.empCode);
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
