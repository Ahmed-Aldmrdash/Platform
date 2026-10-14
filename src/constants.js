'use strict';

const ADMIN_TIER_ROLES = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin'];

// Read-only oversight accounts: they see everything a super admin sees but can't change anything.
const VIEWER_ROLES = ['hse_director', 'ceo'];

const MAINTENANCE_DEPARTMENTS = ['Electrical Maintenance', 'Mechanical Maintenance', 'Preventive Maintenance'];

// Old hazard reports were filed under department names that were later split up.
const LEGACY_DEPARTMENT_ALIASES = {
  'Electrical Maintenance': ['Maintenance'],
  'Mechanical Maintenance': ['Maintenance'],
  'Preventive Maintenance': ['Maintenance'],
  'IT Operations': ['IT'],
  'IT Applications': ['IT'],
};

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

const INITIAL_TRAINING_TOPICS = [
  'فصل وعزل الطاقة LOTO',
  'القيادة الامنة للفوركليفت',
  'مخاطر المواد الكيماوية',
  'المخاطر الكهربية',
  'مخاطر القطع واللحام',
  'سلامة الماكينات وحواجز الحماية',
  'مخاطر العمل علي ارتفاع',
  'الاسعافات الاولية',
  'مهمات الوقاية الشخصية PPE',
  'خطة الطوارئ والاخلاء',
  'مخاطر الاماكن المغلقة',
  'مكافحة الحرائق واستخدام الطفايات',
];

function emptyDeleteFlags() {
  return { areaAdmin: false, safetyAdmin: false, superAdmin: false, worker: false };
}

module.exports = {
  ADMIN_TIER_ROLES,
  VIEWER_ROLES,
  MAINTENANCE_DEPARTMENTS,
  LEGACY_DEPARTMENT_ALIASES,
  EMAIL_RE,
  INITIAL_TRAINING_TOPICS,
  emptyDeleteFlags,
};
