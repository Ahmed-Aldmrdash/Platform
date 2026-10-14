'use strict';

const INSPECTION_ADMIN_ROLES = ['hse_admin', 'super_admin'];

function computeInspectionStats(sectionItems, allRecords, year, month) {
  let compliant = 0, nonCompliant = 0;
  const recMap = new Map();
  allRecords.forEach(r => {
    if (r.year === year && r.month === month) recMap.set(r.itemId, r);
  });
  sectionItems.forEach(it => {
    const r = recMap.get(it.id);
    if (!r) return;
    if (r.status === 'مطابق') compliant++;
    else if (r.status === 'غير مطابق') nonCompliant++;
  });
  const total = sectionItems.length;
  const pending = total - compliant - nonCompliant;
  const compliancePct = total > 0 ? Math.round((compliant / total) * 1000) / 10 : null;
  return { itemCount: total, compliant, nonCompliant, pending, compliancePct };
}

module.exports = {
  computeInspectionStats,
  INSPECTION_ADMIN_ROLES,
};
