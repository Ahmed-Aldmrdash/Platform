'use strict';

// E-mail sending started by hand from the permits and hazards screens: recipient checks and
// Excel registers as attachments.

const mailer = require('./mailer');
const { parseRecipients } = require('./backups');
const { esc, localDateTime } = require('../documents/print-template');
const { XLSX_TYPE } = require('../documents/excel-exports');

const MAX_RECIPIENTS = 5;
const SMTP_MISSING = { error: 'إعدادات الإيميل (SMTP) مش متظبطة — كلّم مدير النظام', notConfigured: true };

/** { list } or { error } for a comma/space separated string or an array of addresses. */
function parseEmailRecipients(input) {
  const { list, invalid } = parseRecipients(input);
  if (invalid.length) return { error: `إيميل غير صحيح: ${invalid.join('، ')}` };
  if (!list.length) return { error: 'اكتب إيميل واحد على الأقل' };
  if (list.length > MAX_RECIPIENTS) return { error: `أقصى عدد ${MAX_RECIPIENTS} إيميلات في المرة` };
  return { list };
}

function senderName(user) {
  return (user && (user.fullName || user.name || user.username)) || 'المنصة';
}

async function emailWorkbook({ workbook, to, title, filename, count, sender }) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const when = localDateTime(new Date());
  const lines = [
    `مرفق ${title} من منصة السلامة والصحة المهنية — ${count} سجل.`,
    `أرسله: ${sender} — ${when}`,
  ];
  return mailer.sendMail({
    to: to.join(', '),
    subject: `${title} — ${when}`,
    text: lines.join('\n'),
    html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:14px;line-height:1.8">${lines.map((l) => `<p style="margin:0 0 6px">${esc(l)}</p>`).join('')}</div>`,
    attachments: [{ filename: `${filename}.xlsx`, content: buffer, contentType: XLSX_TYPE }],
  });
}

module.exports = { parseEmailRecipients, senderName, emailWorkbook, SMTP_MISSING, MAX_RECIPIENTS };
