'use strict';

const { renderPrintDocument, esc } = require('./print-template');

const TONE_COLORS = { success: '#16A34A', danger: '#DC2626', warning: '#D97706', info: '#2563EB', neutral: '#334155' };

/** Public page behind the QR code on printed documents. Shows minimal, escaped data only. */
function verifyPageHtml({ title, rows, statusLabel, statusColor }) {
  const safeTitle = esc(title);
  const safeStatus = esc(statusLabel);
  const color = /^#[0-9a-f]{6}$/i.test(statusColor || '') ? statusColor : TONE_COLORS.neutral;
  const safeRows = (rows || []).map((r) => [esc(r[0]), r[1] === null || r[1] === undefined || r[1] === '' ? '' : esc(r[1])]);
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>${safeTitle} — HSE Platform</title>
<style>
  body{font-family:'Cairo',Tahoma,sans-serif;background:#0F172A;color:#fff;margin:0;padding:24px;min-height:100vh;box-sizing:border-box;display:flex;align-items:center;justify-content:center;}
  .card{background:#fff;color:#0F172A;border-radius:16px;padding:28px 24px;max-width:420px;width:100%;box-shadow:0 20px 60px -10px rgba(0,0,0,.5);}
  .brand{font-size:12px;color:#64748B;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;}
  h1{font-size:19px;margin:0 0 16px;}
  .status{display:inline-block;padding:8px 18px;border-radius:8px;font-weight:800;font-size:14px;border:2px solid ${color};color:${color};margin-bottom:18px;}
  .row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #E2E8F0;font-size:13.5px;}
  .row span:first-child{color:#64748B;font-weight:700;}
  .row span:last-child{font-weight:700;text-align:left;}
  .foot{margin-top:16px;font-size:11px;color:#94A3B8;text-align:center;}
</style></head>
<body>
  <div class="card">
    <img src="/icons/elsewedy-logo-print.png" alt="Elsewedy Polymers" style="height:44px;display:block;margin:0 0 10px">
    <div class="brand">Elsewedy Polymers — HSE Platform</div>
    <h1>${safeTitle}</h1>
    <div class="status">${safeStatus}</div>
    ${safeRows.map((r) => `<div class="row"><span>${r[0]}</span><span>${r[1] || '—'}</span></div>`).join('')}
    <div class="foot">تحقق آلي لحظي من النظام الرسمي — ${new Date().toLocaleString('ar-EG')}</div>
  </div>
</body></html>`;
}

/**
 * Status shown on the verify page. Anything deleted by HSE or the super admin
 * (or permanently by anyone) counts as cancelled; a department admin removing
 * it from their own list does not.
 */
function verifyStatus(rec, st) {
  const del = rec && rec.deletedBy;
  const perm = rec && rec.permanentlyDeletedBy;
  const cancelled = Boolean(rec && (rec.deleted || rec.isDeleted || rec.deletedAt))
    || Boolean(del && typeof del === 'object' && (del.safetyAdmin || del.superAdmin))
    || Boolean(perm && typeof perm === 'object' && Object.values(perm).some(Boolean));
  if (cancelled) return { label: 'ملغي — المستند ده اتحذف من المنصة', color: TONE_COLORS.danger };
  return { label: st.label, color: TONE_COLORS[st.tone] || TONE_COLORS.neutral };
}

function sendPrintPage(res, html) {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(html);
}

function printErrorPage(message) {
  return renderPrintDocument({ title: 'تعذّر فتح المستند', sections: [{ kind: 'text', text: message }] });
}

module.exports = { verifyPageHtml, verifyStatus, sendPrintPage, printErrorPage };
