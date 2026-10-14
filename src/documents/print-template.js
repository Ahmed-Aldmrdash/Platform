'use strict';

// Shared A4 print layout (header, logo, tables, signature boxes) and RTL-safe formatting helpers.

const BRAND_RED = '#E2001A';
const BRAND_DARK = '#8A0E1F';

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad2 = n => String(n).padStart(2, '0');
function localDate(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function localDateTime(v) {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) return v.trim();
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d)) return String(v);
  return `${localDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const LTR_RUN_RE = /\(?[A-Za-z0-9][A-Za-z0-9 .,:;%/\-+&#_'()]*[A-Za-z0-9%)]|[A-Za-z0-9]/g;
function bidi(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  const count = (x, ch) => x.split(ch).length - 1;
  let out = '';
  let last = 0;
  let m;
  LTR_RUN_RE.lastIndex = 0;
  while ((m = LTR_RUN_RE.exec(s))) {
    let run = m[0];
    let start = m.index;
    while (run.startsWith('(') && count(run, '(') > count(run, ')')) { run = run.slice(1); start++; }
    while (run.endsWith(')') && count(run, ')') > count(run, '(')) run = run.slice(0, -1);
    run = run.replace(/[\s.,:;-]+$/, '');
    if (!run || !/[A-Za-z0-9]/.test(run) || start < last) continue;
    if (!/[A-Za-z()\s\-/:%]/.test(run)) continue;
    const cls = run.length <= 24 ? 'ltr nw' : 'ltr';
    out += esc(s.slice(last, start)) + `<span class="${cls}" dir="ltr">` + esc(run) + '</span>';
    last = start + run.length;
  }
  return out + esc(s.slice(last));
}

function val(v) {
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  if (!s) return '<span class="muted">—</span>';
  return '<bdi>' + bidi(s).replace(/\n/g, '<br>') + '</bdi>';
}
function valPlain(v) {
  const s = (v === null || v === undefined) ? '' : String(v).trim();
  if (!s) return '<span class="muted">—</span>';
  return '<bdi>' + esc(s) + '</bdi>';
}

const TONES = {
  success: { fg: '#15803D', bg: '#F0FDF4', bd: '#86EFAC' },
  warning: { fg: '#B45309', bg: '#FFFBEB', bd: '#FCD34D' },
  danger: { fg: '#B91C1C', bg: '#FEF2F2', bd: '#FCA5A5' },
  info: { fg: '#1D4ED8', bg: '#EFF6FF', bd: '#93C5FD' },
  neutral: { fg: '#374151', bg: '#F9FAFB', bd: '#D1D5DB' },
};

const CSS = `
@page { size: A4; margin: 13mm 11mm 15mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
  color: #1F2937; font-size: 11pt; line-height: 1.55;
  background: #E5E7EB; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.sheet { background: #fff; width: 210mm; max-width: 100%; margin: 14px auto; padding: 13mm 11mm 12mm; box-shadow: 0 4px 24px rgba(0,0,0,.10); }
.toolbar { position: sticky; top: 0; z-index: 5; background: #111827; color: #fff; padding: 10px 14px; text-align: center; }
.toolbar button { font: inherit; font-weight: 700; border: 0; border-radius: 8px; padding: 8px 18px; margin: 0 4px; cursor: pointer; }
.toolbar .primary { background: ${BRAND_RED}; color: #fff; }
.toolbar .pdf { background: #fff; color: #111827; }
.toolbar .ghost { background: #374151; color: #fff; }
.toolbar button:disabled { opacity: .6; cursor: progress; }
.toolbar .hint { display: block; font-size: 9pt; opacity: .75; margin-top: 4px; }
/* حفظ PDF مباشر: الورقة بتتصوّر بمقاس A4 ثابت (794px) مهما كان عرض الشاشة */
body.pdf-capture .sheet { position: absolute !important; left: 0 !important; top: 0 !important; width: 794px !important; max-width: none !important; margin: 0 !important; box-shadow: none !important; zoom: 1 !important; }
.pdf-busy { position: fixed; inset: 0; z-index: 50; display: none; align-items: flex-start; justify-content: center; padding-top: 120px; background: rgba(255,255,255,.97); color: #111827; font-weight: 800; font-size: 13pt; text-align: center; }
@media print {
  body { background: #fff; }
  .sheet { width: auto; max-width: none; margin: 0; padding: 0; box-shadow: none; zoom: 1 !important; }
  .no-print { display: none !important; }
}
table { border-collapse: collapse; }
.ltr { direction: ltr; unicode-bidi: isolate; }
.ltr.nw { white-space: nowrap; }
.hdr { width: 100%; border-bottom: 3px solid ${BRAND_RED}; margin-bottom: 10px; }
.hdr td { vertical-align: middle; padding-bottom: 7px; }
.co { font-weight: 800; font-size: 13.5pt; color: #111827; }
.co-sub { color: #6B7280; font-size: 9.5pt; }
.logo { height: 15mm; display: block; }
.title-tbl { width: 100%; margin: 4px 0 10px; }
.title-tbl td { vertical-align: top; }
h1 { font-size: 17pt; margin: 0; color: ${BRAND_DARK}; line-height: 1.3; }
.doc-sub { color: #4B5563; font-size: 10pt; margin-top: 2px; }
.doc-no { direction: ltr; unicode-bidi: isolate; text-align: right; font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; color: #374151; }
.status { display: inline-block; border: 1.5px solid; border-radius: 7px; padding: 4px 12px; font-weight: 800; font-size: 10.5pt; white-space: nowrap; }
.meta { width: 100%; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 6px; margin-bottom: 10px; }
.meta td { padding: 5px 9px; font-size: 9.5pt; color: #374151; }
.meta b { color: #111827; }
.section { margin: 11px 0 0; }
.section h2 { font-size: 11.5pt; margin: 0 0 6px; padding: 5px 9px; background: #F3F4F6; border-right: 4px solid ${BRAND_RED}; color: #111827; break-after: avoid; page-break-after: avoid; }
.kv { width: 100%; table-layout: fixed; }
.kv th, .kv td { border: 1px solid #E5E7EB; padding: 5px 8px; vertical-align: top; text-align: right; word-wrap: break-word; overflow-wrap: anywhere; }
.kv th { width: 17%; background: #FAFAFA; color: #4B5563; font-weight: 600; font-size: 9.5pt; }
.kv td { width: 33%; font-weight: 700; font-size: 10.5pt; }
.kv tr, .data tr { break-inside: avoid; page-break-inside: avoid; }
.data { width: 100%; font-size: 9.5pt; }
.data thead { display: table-header-group; }
.data th { background: #1F2937; color: #fff; padding: 5px 7px; text-align: right; font-weight: 700; border: 1px solid #1F2937; }
.data td { border: 1px solid #E5E7EB; padding: 4px 7px; vertical-align: top; text-align: right; overflow-wrap: anywhere; }
.data tbody tr:nth-child(even) td { background: #FAFAFA; }
.data .num { text-align: center; direction: ltr; unicode-bidi: isolate; white-space: nowrap; }
.text { margin: 0; padding: 6px 9px; border: 1px solid #E5E7EB; border-radius: 6px; background: #fff; white-space: pre-wrap; }
/* النقطة جزء من السطر نفسه (مش list-style) عشان تفضل جنب الكلام في الطباعة وفي "حفظ PDF" */
.bullets { margin: 0; padding: 0 6px 0 0; list-style: none; }
.bullets li { margin: 2px 0; padding-right: 14px; text-indent: -14px; }
.dot { display: inline-block; width: 14px; text-indent: 0; color: #6B7280; }
.note { margin: 0 0 6px; color: #4B5563; font-size: 9.5pt; }
.sig { width: 100%; table-layout: fixed; margin-top: 4px; }
.sig td { border: 1px solid #D1D5DB; height: 25mm; vertical-align: top; padding: 6px 8px; font-size: 9.5pt; }
.sig .role { font-weight: 800; color: #111827; }
.sig .who { color: #374151; margin-top: 2px; }
.sig .line { margin-top: 11mm; border-top: 1px dashed #9CA3AF; padding-top: 2px; color: #9CA3AF; font-size: 8pt; }
.ftr { width: 100%; margin-top: 14px; border-top: 1px solid #E5E7EB; }
.ftr td { padding-top: 6px; font-size: 8.5pt; color: #6B7280; vertical-align: bottom; }
.qr { width: 24mm; height: 24mm; display: block; }
.muted { color: #9CA3AF; font-weight: 400; }
.good { color: #15803D; font-weight: 800; }
.bad { color: #B91C1C; font-weight: 800; }
.warn { color: #B45309; font-weight: 800; }
.kpis { width: 100%; table-layout: fixed; margin: 2px 0; }
.kpis td { border: 1px solid #E5E7EB; padding: 7px; text-align: center; vertical-align: top; }
.kpis .k-val { font-size: 15pt; font-weight: 800; color: #111827; direction: ltr; unicode-bidi: isolate; }
.kpis .k-lbl { font-size: 8.5pt; color: #6B7280; }
.kpis td.k-empty { border: 0; }
`;

const PDF_SCRIPT = `(function () {
  var LIBS = [
    ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'],
    ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js']
  ];
  function load(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('lib: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function busy(text) {
    var o = document.getElementById('pdfBusy');
    if (!o) { o = document.createElement('div'); o.id = 'pdfBusy'; o.className = 'pdf-busy no-print'; document.body.appendChild(o); }
    o.textContent = text || '';
    o.style.display = text ? 'flex' : 'none';
  }
  function fileName(n) {
    return String(n || 'مستند').replace(/[\\\\/:*?"<>|]+/g, '-').replace(/\\s+/g, ' ').trim().slice(0, 120) + '.pdf';
  }
  var running = false;
  window.hsePrintSavePdf = async function (opts) {
    opts = opts || {};
    if (running) return null;
    running = true;
    var btn = document.getElementById('pdfBtn');
    var body = document.body, sheet = document.querySelector('.sheet');
    var oldScroll = window.scrollY, oldMinH = body.style.minHeight, failed = false;
    function progress(t) { if (btn) btn.textContent = t; if (!opts.silent) busy(t); if (opts.onProgress) opts.onProgress(t); }
    if (btn) btn.disabled = true;
    try {
      progress('جاري تجهيز ملف الـ PDF…');
      for (var l = 0; l < LIBS.length; l++) {
        var ready = LIBS[l][0] === 'jspdf' ? (window.jspdf && window.jspdf.jsPDF) : window.html2canvas;
        if (!ready) await load(LIBS[l][1]);
      }
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      body.style.minHeight = Math.ceil(body.getBoundingClientRect().height) + 'px';
      window.scrollTo(0, 0);
      body.classList.add('pdf-capture');
      var W = sheet.offsetWidth;
      var pxPerMm = W / 210, TOP = 10 * pxPerMm, BOTTOM = 10 * pxPerMm, PAGE = 297 * pxPerMm;
      var base = 0, cands = [], H = 0;
      function measure() {
        base = sheet.getBoundingClientRect().top;
        cands = [];
        sheet.querySelectorAll('.section, tr, li, p, .sig, img, .kpis, .hdr, .title-tbl, .meta, .ftr').forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (el.classList.contains('section')) cands.push(Math.round(r.top - base));
          cands.push(Math.round(r.bottom - base));
        });
        H = Math.ceil(sheet.scrollHeight);
        cands = cands.filter(function (y) { return y > 0 && y <= H; }).sort(function (a, b) { return a - b; });
        if (cands.length) H = Math.min(H, cands[cands.length - 1] + 12);
      }
      // لو الصفحة الجديدة بتبدأ في نص جدول: عنوان الجدول بيتكرر في أولها (زي الطباعة)
      function repeatHeaderAt(y) {
        var rows = sheet.querySelectorAll('table.data > tbody > tr');
        for (var r = 0; r < rows.length; r++) {
          var t = Math.round(rows[r].getBoundingClientRect().top - base);
          if (Math.abs(t - y) <= 2) {
            if (!rows[r].previousElementSibling) return false;
            var head = rows[r].parentNode.parentNode.querySelector('thead tr');
            if (!head) return false;
            var clone = head.cloneNode(true);
            clone.className = 'pdf-head-repeat';
            rows[r].parentNode.insertBefore(clone, rows[r]);
            return true;
          }
          if (t > y + 2) return false;
        }
        return false;
      }
      measure();
      // تقسيم الصفحات: أبعد حد (آخر صف/قسم) يدخل في الصفحة
      var pages = [], start = 0, first = true;
      while (start < H - 2) {
        var top = first ? 0 : TOP, avail = PAGE - top - BOTTOM, maxEnd = start + avail, end = Math.min(H, maxEnd);
        if (maxEnd < H) {
          for (var i = cands.length - 1; i >= 0; i--) {
            if (cands[i] <= maxEnd && cands[i] > start + avail * 0.35) { end = cands[i]; break; }
          }
        }
        pages.push({ s: start, e: end, top: top });
        if (end < H && repeatHeaderAt(end)) measure();
        start = end; first = false;
      }
      // الصفحات بتتصوّر على مجموعات عشان الصورة ما تكبرش عن حد الذاكرة (آيفون ~16 ميجا بكسل)
      var scale = 2, small = Math.min(screen.width, screen.height) < 820;
      var maxChunk = Math.floor((small ? 12e6 : 32e6) / (W * scale * scale));
      var chunks = [], cur = null;
      pages.forEach(function (p) {
        if (!cur || p.e - cur.s > maxChunk) { cur = { s: p.s, e: p.e, pages: [] }; chunks.push(cur); }
        cur.e = p.e; cur.pages.push(p);
      });
      var pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
      var done = 0;
      for (var c = 0; c < chunks.length; c++) {
        var ch = chunks[c];
        var canvas = await window.html2canvas(sheet, {
          scale: scale, backgroundColor: '#ffffff', logging: false, useCORS: true,
          x: 0, y: ch.s, width: W, height: ch.e - ch.s,
          windowWidth: W, windowHeight: Math.ceil(sheet.scrollHeight), scrollX: 0, scrollY: 0
        });
        for (var k = 0; k < ch.pages.length; k++) {
          var p = ch.pages[k];
          var sh = Math.max(1, Math.round((p.e - p.s) * scale));
          var pc = document.createElement('canvas');
          pc.width = canvas.width; pc.height = sh;
          var ctx = pc.getContext('2d');
          ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, pc.width, sh);
          ctx.drawImage(canvas, 0, Math.round((p.s - ch.s) * scale), canvas.width, sh, 0, 0, pc.width, sh);
          if (done) pdf.addPage();
          pdf.addImage(pc.toDataURL('image/jpeg', 0.92), 'JPEG', 0, p.top / pxPerMm, 210, (p.e - p.s) / pxPerMm, undefined, 'FAST');
          pc.width = pc.height = 0;
          done++;
          progress('جاري تجهيز ملف الـ PDF… (' + done + ' من ' + pages.length + ')');
        }
        canvas.width = canvas.height = 0;
      }
      var name = fileName(opts.fileName || body.getAttribute('data-pdf-name') || document.title);
      if (opts.returnBlob) return { blob: pdf.output('blob'), pages: pages.length, name: name };
      pdf.save(name);
      return { pages: pages.length, name: name };
    } catch (e) {
      failed = true;
      console.error('[pdf]', e);
      if (!opts.silent) {
        busy('تعذّر تجهيز ملف الـ PDF — جرّب تاني، أو استخدم زرار الطباعة واختار Save as PDF');
        setTimeout(function () { busy(''); }, 4500);
      }
      throw e;
    } finally {
      Array.prototype.forEach.call(document.querySelectorAll('.pdf-head-repeat'), function (el) { el.parentNode.removeChild(el); });
      body.classList.remove('pdf-capture');
      body.style.minHeight = oldMinH;
      window.scrollTo(0, oldScroll);
      window.dispatchEvent(new Event('resize'));
      if (btn) { btn.disabled = false; btn.textContent = '📄 حفظ PDF'; }
      if (!failed && !opts.silent) busy('');
      running = false;
    }
  };
})();`;

function renderGrid(rows) {
  const pairs = (rows || []).filter(r => r && r[0]);
  const out = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const a = pairs[i];
    const b = pairs[i + 1];
    if (a[2] === 'wide' || (b && b[2] === 'wide')) {
      out.push(`<tr><th>${bidi(a[0])}</th><td colspan="3">${val(a[1])}</td></tr>`);
      if (b) { i -= 1; }
      continue;
    }
    out.push(`<tr><th>${bidi(a[0])}</th><td>${val(a[1])}</td>${b ? `<th>${bidi(b[0])}</th><td>${val(b[1])}</td>` : '<th></th><td></td>'}</tr>`);
  }
  return `<table class="kv">${out.join('')}</table>`;
}

function renderTable(columns, rows, opts = {}) {
  if (!rows || !rows.length) return `<p class="note">${bidi(opts.empty || 'لا توجد بيانات في الفترة دي.')}</p>`;
  const numCols = new Set(opts.numeric || []);
  const head = columns.map(c => `<th>${bidi(c)}</th>`).join('');
  const body = rows.map(r => `<tr>${r.map((cell, i) => {
    if (cell && typeof cell === 'object' && cell.html) return `<td class="${numCols.has(i) ? 'num' : ''}">${cell.html}</td>`;
    return `<td class="${numCols.has(i) ? 'num' : ''}">${numCols.has(i) ? valPlain(cell) : val(cell)}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function renderKpis(items) {
  const list = items || [];
  const perRow = list.length <= 6 ? Math.max(1, list.length) : 4;
  const rows = [];
  for (let i = 0; i < list.length; i += perRow) {
    const chunk = list.slice(i, i + perRow);
    const cells = chunk.map(k => `<td><div class="k-val">${esc(k.value)}</div><div class="k-lbl">${bidi(k.label)}</div></td>`);
    while (cells.length < perRow) cells.push('<td class="k-empty"></td>');
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  return `<table class="kpis">${rows.join('')}</table>`;
}

function renderSignatures(slots) {
  const cells = (slots || []).map(s => `<td><div class="role">${bidi(s.role)}</div><div class="who">${val(s.name)}</div>${s.date ? `<div class="who">${val(s.date)}</div>` : ''}<div class="line">التوقيع</div></td>`).join('');
  return `<table class="sig"><tr>${cells}</tr></table>`;
}

function renderSection(s) {
  if (!s) return '';
  let body = '';
  switch (s.kind) {
    case 'grid': body = renderGrid(s.rows); break;
    case 'table': body = renderTable(s.columns, s.rows, s); break;
    case 'kpis': body = renderKpis(s.items); break;
    case 'text': body = s.text ? `<p class="text">${bidi(s.text)}</p>` : `<p class="note">—</p>`; break;
    case 'bullets': body = (s.items && s.items.length)
      ? `<ul class="bullets">${s.items.map(it => `<li>${typeof it === 'object' && it.html ? it.html : `<span class="dot">•</span>${bidi(it)}`}</li>`).join('')}</ul>`
      : `<p class="note">${bidi(s.empty || '—')}</p>`; break;
    case 'signatures': body = renderSignatures(s.slots); break;
    case 'html': body = s.html || ''; break;
    default: body = '';
  }
  const note = s.note ? `<p class="note">${bidi(s.note)}</p>` : '';
  return `<div class="section">${s.title ? `<h2>${bidi(s.title)}</h2>` : ''}${note}${body}</div>`;
}

function renderPrintDocument(o) {
  const opts = o || {};
  const tone = TONES[(opts.status && opts.status.tone) || 'neutral'] || TONES.neutral;
  const logo = opts.logoSrc || '/icons/elsewedy-logo-print.png';
  const generated = opts.generatedAt || new Date();
  const genText = localDateTime(generated);

  const statusHtml = opts.status && opts.status.label
    ? `<span class="status" style="color:${tone.fg};background:${tone.bg};border-color:${tone.bd}">${bidi(opts.status.label)}</span>`
    : '';

  const metaRows = (opts.meta || []).filter(m => m && m[0]);
  const metaHtml = metaRows.length
    ? `<table class="meta"><tr>${metaRows.map(([k, v]) => `<td>${bidi(k)}: <b>${val(v)}</b></td>`).join('')}</tr></table>`
    : '';

  const qrHtml = opts.qrDataUrl
    ? `<td style="width:26mm;text-align:left"><img class="qr" src="${opts.qrDataUrl}" alt="QR"><div style="font-size:7.5pt">${esc(opts.qrCaption || 'امسح للتحقق')}</div></td>`
    : '';

  const toolbar = opts.forEmail ? '' : `
<div class="toolbar no-print">
  <button class="primary" type="button" onclick="window.print()">🖨️ طباعة</button>
  <button class="pdf" type="button" id="pdfBtn" onclick="hsePrintSavePdf().catch(function(){})">📄 حفظ PDF</button>
  <button class="ghost" type="button" onclick="if(window.opener||history.length<2){window.close()}else{history.back()}">إغلاق</button>
  <span class="hint">"حفظ PDF" بينزّل الملف على جهازك على طول — و"طباعة" للورق</span>
</div>`;
  const pdfName = [opts.docTitle || opts.title || 'مستند', opts.pdfNameExtra, opts.docNumber].filter(Boolean).join(' - ');

  const autoPrint = (!opts.forEmail && opts.autoPrint)
    ? `<script>window.addEventListener('load',function(){setTimeout(function(){window.print();},350);});</script>`
    : '';
  const fitScript = opts.forEmail ? '' : `<script>(function(){var F=820;function fit(){var s=document.querySelector('.sheet');if(!s)return;var w=document.documentElement.clientWidth;if(w&&w<F){s.style.zoom=String(Math.max(0.3,w/F));s.style.maxWidth='none';}else{s.style.zoom='';s.style.maxWidth='';}}fit();window.addEventListener('resize',fit);})();</script>`;

  const fonts = opts.forEmail ? '' : `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">`;

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(opts.docTitle || opts.title || 'مستند')}${opts.docNumber ? ' — ' + esc(opts.docNumber) : ''}</title>
${fonts}
<style>${CSS}</style>
</head>
<body data-pdf-name="${esc(pdfName)}">
${toolbar}
<div class="sheet">
  <table class="hdr"><tr>
    <td>
      <div class="co">السويدي للبوليمرات — Elsewedy Polymers</div>
      <div class="co-sub">منصة السلامة والصحة المهنية والبيئة (HSE)</div>
    </td>
    <td style="text-align:left;width:40mm"><img class="logo" src="${esc(logo)}" alt="Elsewedy Polymers"></td>
  </tr></table>

  <table class="title-tbl"><tr>
    <td>
      <h1>${bidi(opts.title || '')}</h1>
      ${opts.subtitle ? `<div class="doc-sub">${bidi(opts.subtitle)}</div>` : ''}
      ${opts.docNumber ? `<div class="doc-no">${esc(opts.docNumber)}</div>` : ''}
    </td>
    <td style="text-align:left;width:45mm">${statusHtml}</td>
  </tr></table>

  ${metaHtml}
  ${(opts.sections || []).map(renderSection).join('\n')}

  <table class="ftr"><tr>
    <td>
      ${opts.footerNote ? `<div>${bidi(opts.footerNote)}</div>` : ''}
      <div>مستند صادر آليًا من منصة HSE — السويدي للبوليمرات · تاريخ الإصدار: <bdi>${esc(genText)}</bdi>${opts.docNumber ? ` · <bdi>${esc(opts.docNumber)}</bdi>` : ''}</div>
    </td>
    ${qrHtml}
  </tr></table>
</div>
${fitScript}
${opts.forEmail ? '' : `<script>${PDF_SCRIPT}</script>`}
${autoPrint}
</body>
</html>`;
}

module.exports = { renderPrintDocument, esc, bidi, val, TONES, localDate, localDateTime };
