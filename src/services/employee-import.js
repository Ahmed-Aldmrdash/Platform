'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');
const config = require('../config');
const { readEmployees, writeEmployees } = require('../data/stores');
const { normalizeEmpCode, sanitizeStr } = require('../utils/validation');

function cellText(val) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'object' && val.richText) return val.richText.map((r) => r.text || '').join('').trim();
  return String(val).trim();
}

/** Maps one sheet row (keyed by header text, Arabic or English) to an employee record. */
function normalizeEmployeeRow(row) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = cellText(row[k]);
      if (v) return v;
    }
    for (const k of keys) {
      const kl = k.toLowerCase();
      for (const rk of Object.keys(row)) {
        if (rk.trim().toLowerCase() === kl) {
          const v = cellText(row[rk]);
          if (v) return v;
        }
      }
    }
    return '';
  };

  const code = pick(
    'Employee Number', 'EmployeeNumber', 'employee number', 'employee_number',
    'الكود الوظيفي', 'الكود', 'كود', 'كود الموظف', 'الرقم الوظيفي', 'رقم القيد',
    'code', 'Code', 'empCode', 'id', 'ID', 'emp_id', 'EMP_CODE',
  );
  const empCode = normalizeEmpCode(code);
  if (!/^d{1,12}$/.test(empCode)) return null;

  const name = pick(
    'Arabic Name', 'ArabicName', 'arabic name', 'arabic_name',
    'الاسم الكامل', 'الاسم', 'اسم الموظف', 'اسم العامل', 'الاسم ثلاثي',
    'name', 'Name', 'full name', 'Full Name', 'employee name',
  );
  const department = pick(
    'Organization Description', 'OrganizationDescription', 'organization description', 'organization_description',
    'القسم', 'الإدارة', 'الادارة', 'القطاع', 'مكان العمل',
    'department', 'Department', 'dept', 'sector',
  );
  const jobTitle = pick(
    'Position', 'position', 'job title', 'Job Title', 'jobtitle',
    'المسمى الوظيفي', 'الوظيفة', 'المهنة', 'مسمى الوظيفة',
    'title', 'Title',
  );
  const rawRole = pick('الصلاحية', 'الدور', 'role', 'Role').toLowerCase();
  const validRoles = ['worker', 'supervisor', 'area_head', 'contractor'];

  return {
    empCode,
    name: sanitizeStr(name, 150) || 'موظف',
    department: sanitizeStr(department, 100) || 'عام',
    jobTitle: sanitizeStr(jobTitle, 100),
    role: validRoles.includes(rawRole) ? rawRole : 'worker',
    phone: sanitizeStr(pick('رقم الهاتف', 'الهاتف', 'الموبايل', 'رقم التليفون', 'phone', 'Phone', 'mobile', 'Mobile', 'tel'), 20),
  };
}

async function parseEmployeesXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const cellStr = (cell) => {
    if (!cell) return '';
    const v = cell.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text || '').join('').trim();
    if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim();
    if (v instanceof Date) return v.toISOString().split('T')[0];
    return String(v).trim();
  };

  const headers = {};
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNum) => {
    const h = cellStr(cell);
    if (h) headers[colNum] = h;
  });

  const employees = [];
  ws.eachRow((row, rowNum) => {
    if (rowNum === 1) return;
    const rowObj = {};
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const hdr = headers[colNum];
      if (hdr) rowObj[hdr] = cell.value;
    });
    const emp = normalizeEmployeeRow(rowObj);
    if (emp && emp.empCode) employees.push(emp);
  });
  return employees;
}

/** First boot only: seeds the employee directory from data/employees.xlsx when it exists. */
async function loadEmployeesFromXlsxIfNeeded() {
  if (readEmployees().length > 0) return;
  const file = config.paths.EMPLOYEES_XLSX_SEED;
  if (!fs.existsSync(file)) return;
  try {
    const employees = await parseEmployeesXlsx(fs.readFileSync(file));
    if (!employees.length) {
      console.warn('[employees] employees.xlsx has no usable rows — check the column headers');
      return;
    }
    writeEmployees(employees);
    console.log(`[employees] imported ${employees.length} employees from employees.xlsx`);
  } catch (err) {
    console.error('[employees] import from employees.xlsx failed:', err.message);
  }
}

module.exports = { normalizeEmployeeRow, parseEmployeesXlsx, loadEmployeesFromXlsxIfNeeded };
