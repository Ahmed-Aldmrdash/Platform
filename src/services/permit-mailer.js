'use strict';

// A work permit forwarded by hand from the permits screen: the permit document as an e-mail.

const config = require('../config');
const mailer = require('./mailer');
const { renderPrintDocument, esc, localDateTime } = require('../documents/print-template');
const { buildPermitPrint, permitStatus } = require('../documents/print-docs');
const { permitRiskLevel, RISK_LABEL } = require('../utils/permit-order');

function permitLink() {
  return /^https?:\/\/\S+$/i.test(config.publicBaseUrl) ? `${config.publicBaseUrl}/#tabSup` : '';
}

async function sendPermitForwardEmail(permit, { to, by, note }) {
  const status = permitStatus(permit.status).label;
  const risk = RISK_LABEL[permitRiskLevel(permit)];
  const link = permitLink();
  const intro = `${by} وجّهلك تصريح العمل ده للمتابعة — حالته: ${status}.`;

  const doc = buildPermitPrint(permit, {});
  doc.sections = [
    {
      kind: 'html',
      html:
        `<div style="border:2px solid #1F2937;background:#F9FAFB;border-radius:8px;padding:10px 14px;margin:0 0 10px">` +
        `<div style="font-weight:700;font-size:13pt">${esc(intro)}</div>` +
        (note ? `<div style="margin-top:6px;font-size:11pt">ملاحظة: ${esc(note)}</div>` : '') +
        (link ? `<div style="margin-top:6px;font-size:10pt"><a href="${esc(link)}">افتح التصاريح على المنصة</a></div>` : '') +
        `</div>`,
    },
    ...doc.sections.filter((s) => s.kind !== 'signatures'),
  ];
  doc.footerNote = `الإيميل ده اتبعت من منصة السلامة بواسطة ${by}.`;

  const text = [
    intro,
    ...(note ? [`ملاحظة: ${note}`] : []),
    '',
    `رقم التصريح: ${permit.id}`,
    `النوع: ${permit.typeFullLabel || permit.typeLabel || '—'} (خطورة ${risk})`,
    `القسم: ${permit.department || '—'}`,
    `مكان العمل: ${permit.location || '—'}`,
    `العامل: ${permit.workerName || '—'}`,
    `تاريخ التنفيذ: ${permit.date || '—'}`,
    `وقت التقديم: ${localDateTime(permit.submittedAt) || '—'}`,
    '',
    `وصف العملية: ${permit.description || '—'}`,
    ...(link ? ['', `افتح التصاريح على المنصة: ${link}`] : []),
  ].join('\n');

  const where = [permit.typeLabel, permit.department].map((x) => String(x || '').trim()).filter(Boolean).join(' — ');
  return mailer.sendMail({
    to: to.join(', '),
    subject: `📌 تصريح عمل للمتابعة — ${where || 'تصريح'} — ${permit.id}`,
    text,
    html: renderPrintDocument({ ...doc, forEmail: true, logoSrc: 'cid:elsewedy-logo' }),
    attachments: [{ filename: 'elsewedy-logo.png', path: config.paths.REPORT_LOGO, cid: 'elsewedy-logo' }],
  });
}

module.exports = { sendPermitForwardEmail };
