const ROOT_DIR = require('path').join(__dirname, '..', '..') + '/';
const P = ROOT_DIR + '';
const ExcelJS = require(P + 'node_modules/exceljs');
const { parsePermitsWorkbook } = require(P + 'src/importers/permits-excel.js');
let pass = 0, fail = 0;
const ok = (c, m) => { console.log((c ? '✅ ' : '❌ ') + m); c ? pass++ : fail++; };

(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('PTW');
  ws.addRow(['رقم التصريح', 'التاريخ', 'نوع التصريح', 'القسم', 'الوردية', 'وصف العمل', 'الموقع', 'مسئول التنفيذ', 'مسئول السلامة', 'مدير المنطقة', 'بداية التصريح', 'نهاية التصريح']);
  ws.addRow(['PTW No.', 'Date', 'Type', 'Department', 'Shift', 'Description', 'Location', 'Executive officer', 'Safety supervisor', 'Area Manager', 'Start', 'End']);
  ws.addRow(['101', new Date(Date.UTC(2026, 2, 5)), 'عمل ساخن', 'PVC', 'أ', 'لحام ماسورة', 'الخط 3', 'أحمد علي', 'محمد حسن', 'سيد', '09:00', '11:30']);
  ws.addRow(['102', { formula: 'DATE(2026,3,6)', result: new Date(Date.UTC(2026, 2, 6)) }, 'عمل على ارتفاع', 'MB', 'ب', { richText: [{ text: 'تركيب ' }, { font: { bold: true }, text: 'سقالة' }] }, 'المخزن', 'كريم', '', '', '10:00', '12:00']);
  ws.addRow(['103', null, 'عام', 'MB', 'ب', 'تنظيف', 'المخزن', 'كريم', '', '', '13:00', '14:00']);
  const buf = await wb.xlsx.writeBuffer();
  const { importedPermits, skippedRows } = await parsePermitsWorkbook(Buffer.from(buf), []);
  ok(importedPermits.length === 3, `اتستورد 3 تصاريح بالظبط (${importedPermits.length}) — صف العناوين الإنجليزي اتخطى (متخطى: ${skippedRows})`);
  ok(!importedPermits.some(p => /department|location|executive/i.test(p.department + p.location + p.workerName)), 'مفيش تصريح اسمه "Department/Location"');
  const p2 = importedPermits.find(p => p.previousPermitNo === '102');
  ok(p2 && p2.description === 'تركيب سقالة', `الخلية المنسقة اتقرت نص صح: "${p2 && p2.description}"`);
  ok(p2 && p2.date === '2026-03-06', `التاريخ بالمعادلة اتقرى صح (${p2 && p2.date})`);
  const p3 = importedPermits.find(p => p.previousPermitNo === '103');
  ok(p3 && p3.date === '2026-03-06', `الصف اللي مالوش تاريخ خد تاريخ الصف اللي قبله (${p3 && p3.date})`);
  const p1 = importedPermits.find(p => p.previousPermitNo === '101');
  ok(p1 && p1.typeKey === 'hot' && p1.timeFrom === '09:00' && p1.timeTo === '11:30', 'النوع والوقت مظبوطين');

  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet('S');
  ws2.addRow(['رقم التصريح', 'التاريخ', 'وصف العمل']);
  ws2.addRow(['201', 'مش تاريخ', 'شغل']);
  const r2 = await parsePermitsWorkbook(Buffer.from(await wb2.xlsx.writeBuffer()), []);
  const today = new Date().toISOString().slice(0, 10);
  ok(!r2.importedPermits.some(p => p.date === today), `صف من غير تاريخ صالح ما بياخدش تاريخ النهارده (${r2.importedPermits.length} مستورد، ${r2.skippedRows} متخطى)`);

  console.log(`\nالنتيجة: ${pass} نجح، ${fail} فشل`);
})().catch(e => { console.error('💥', e); process.exit(1); });
