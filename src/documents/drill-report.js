'use strict';

const fs = require('fs');
const { Document: DocxDocument, Packer: DocxPacker, Paragraph: DocxParagraph, TextRun: DocxTextRun, AlignmentType: DocxAlign, ImageRun: DocxImageRun } = require('docx');
const { COMPANY_LOGO_PATH } = require('../services/excel');

const DEFAULT_DRILL_REPORT_PURPOSE =
  'تطبيقاً لخطط السلامة وفى سياق جهود الشركة الهادفة الى الحفاظ على سلامة كافة العاملين، تم اجراء هذه ' +
  'التجربة للتأكد من مدى فاعلية خطط الطوارئ المتبعة فى الشركة، اضافة الى قياس مدى جاهزية العاملين بالشركة ' +
  'للتعامل فى مثل هذه الظروف الطارئة، مع تدريب كافة العاملين فى الشركة على التصرف الصحيح والاستجابة السريعة ' +
  'خلال الطوارئ، فيما يضمن الامن والسلامة لكافة العاملين.';

function defaultDrillReport() {
  return {
    scenario: '',
    purpose: DEFAULT_DRILL_REPORT_PURPOSE,
    narrativeSteps: [],
    resultIntro: '',
    resultPoints: [
      'جاهزية العاملين للتعامل مع الحالات الطارئة.',
      'الاستجابة السريعة للعاملين بدون اى تهاون.',
      'قيام كل مسئول بمهامه جيداً حسب تخصصه.',
      'قيام اعضاء قسم السلامة بمهامهم بصورة جيدة.',
      'التزام العاملين بتعليمات وتوجيهات السيفتى بسرعة وبدون استعلاء.'
    ],
    positives: [],
    negatives: [],
    improvements: [],
    thanksNote: 'هذا ونتقدم بخالص الشكر والامتنان للسادة الزملاء لحسن تعاونهم وسرعة الاستجابة للحالات الطارئة.',
    responsibleTitle: 'مسئول البيئة والسلامة',
    responsibleName: '',
    signatureDate: '',
    formCode: 'SE-03-F1',
    formVersion: 'VER.NO.:3',
    formDate: 'VER. DATE :1/5/2015',
    updatedAt: null,
    updatedBy: null
  };
}

/** Official drill report (form SE-03-F1) as a Word document. */
async function buildDrillReportDocx(drill, report) {
  const FONT = 'Arial';
  const children = [];

  const plain = (text, opts = {}) => new DocxParagraph({
    alignment: DocxAlign.JUSTIFIED,
    bidirectional: true,
    spacing: { after: 120 },
    children: [ new DocxTextRun({ text: text || '', font: FONT, size: 24, bold: true, rightToLeft: true, ...opts }) ]
  });
  const bullet = (text) => new DocxParagraph({
    alignment: DocxAlign.JUSTIFIED,
    bidirectional: true,
    spacing: { after: 80 },
    children: [ new DocxTextRun({ text: `-   ${text}`, font: FONT, size: 22, rightToLeft: true }) ]
  });
  const header = (text) => new DocxParagraph({
    alignment: DocxAlign.RIGHT,
    bidirectional: true,
    spacing: { before: 200, after: 100 },
    children: [ new DocxTextRun({ text, font: FONT, size: 26, bold: true, underline: {}, rightToLeft: true }) ]
  });
  const blank = () => new DocxParagraph({ text: '' });

  try {
    if (fs.existsSync(COMPANY_LOGO_PATH)) {
      children.push(new DocxParagraph({
        alignment: DocxAlign.CENTER,
        spacing: { after: 120 },
        children: [ new DocxImageRun({
          data: fs.readFileSync(COMPANY_LOGO_PATH),
          transformation: { width: 150, height: 71 },
          type: 'png',
        }) ],
      }));
    }
  } catch (e) {  }

  children.push(new DocxParagraph({
    alignment: DocxAlign.CENTER,
    bidirectional: true,
    spacing: { after: 200 },
    children: [ new DocxTextRun({ text: 'تقرير تجربة طوارئ', font: FONT, size: 32, bold: true, rightToLeft: true }) ]
  }));
  if (drill.title) children.push(plain(drill.title, { bold: false, size: 22 }));
  children.push(blank());

  children.push(header('الغرض من التجربة:'));
  children.push(plain(report.purpose));
  if (report.scenario) {
    children.push(plain(`-  تم اجراء التجربة تجربة طوارئ وهمية ( ${report.scenario} )`));
  }
  children.push(plain('لقياس مدى وعى العاملين فى التعامل مع حالات الطوارئ'));
  children.push(blank());

  const dateLine = `تاريخ التجربة: ${drill.date || ''}        وقت التجربة: ${drill.startTime || ''}${drill.endTime ? (' - ' + drill.endTime) : ''}`;
  children.push(plain(dateLine));
  if (drill.location) children.push(plain(`مكان التجربة: ${drill.location}`));
  children.push(blank());

  children.push(plain('- تم إجراء التجربة كالأتى:'));
  (report.narrativeSteps || []).forEach(step => { if (step) children.push(bullet(step)); });
  children.push(blank());

  children.push(header('نتيجة التجربة'));
  if (report.resultIntro) children.push(plain(report.resultIntro, { bold: false }));
  (report.resultPoints || []).forEach(pt => { if (pt) children.push(bullet(pt)); });
  children.push(blank());

  children.push(header('الإيجابيات'));
  if ((report.positives || []).filter(Boolean).length) {
    report.positives.forEach(pt => { if (pt) children.push(bullet(pt)); });
  } else {
    children.push(plain('ـــــــــــــــــــــــــــــــــــــــــــــــ', { bold: false }));
  }
  children.push(blank());

  children.push(header('السلبيات'));
  if ((report.negatives || []).filter(Boolean).length) {
    report.negatives.forEach(pt => { if (pt) children.push(bullet(pt)); });
  } else {
    children.push(plain('ـــــــــــــــــــــــــــــــــــــــــــــــ', { bold: false }));
  }
  children.push(blank());

  children.push(header('نقاط للتحسين:-'));
  (report.improvements || []).forEach(pt => { if (pt) children.push(bullet(pt)); });
  children.push(blank());

  if (report.thanksNote) {
    children.push(plain(report.thanksNote, { bold: false }));
    children.push(blank());
  }

  children.push(plain(report.responsibleTitle || 'مسئول البيئة والسلامة'));
  children.push(plain(`الاسم: ${report.responsibleName || ''}`));
  children.push(plain(`التاريخ / التوقيع: ${report.signatureDate || drill.date || ''}`));
  children.push(blank());

  children.push(new DocxParagraph({
    alignment: DocxAlign.CENTER,
    children: [ new DocxTextRun({
      text: `${report.formCode || 'SE-03-F1'}     ${report.formVersion || 'VER.NO.:3'}     ${report.formDate || 'VER. DATE :1/5/2015'}`,
      size: 18, font: FONT
    }) ]
  }));

  const doc = new DocxDocument({ sections: [ { properties: {}, children } ] });
  return DocxPacker.toBuffer(doc);
}

module.exports = { defaultDrillReport, buildDrillReportDocx };
