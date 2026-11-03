// Feature 4: PDF documents (invoice, prescription, lab report) built with pdfkit.
// Standard PDF fonts cannot draw Bengali or the ৳ sign. Point PDF_FONT=/path/NotoSansBengali-Regular.ttf at a
// Unicode TTF to print Bengali text; without it, ৳ becomes "Tk" and unsupported characters become "?".
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { M } from '../config/registry.js';
import { getSettings } from '../config/settings.js';
import { HttpError, ymd } from '../utils/helpers.js';

const FONT = process.env.PDF_FONT && fs.existsSync(process.env.PDF_FONT) ? process.env.PDF_FONT : null;
const T = (v) => {
  const s = v === undefined || v === null ? '' : String(v);
  return FONT ? s : s.replace(/৳/g, 'Tk ').replace(/[^\x00-\xFF]/g, '?');
};
const money = (s, n) => `${T(s.currency)}${(Number(n) || 0).toFixed(2)}`;

function build(draw) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    if (FONT) doc.registerFont('U', FONT);
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(draw(doc)).then(() => doc.end()).catch(reject);
  });
}
const font = (doc, bold) => doc.font(FONT ? 'U' : bold ? 'Helvetica-Bold' : 'Helvetica');

async function header(doc, s, title, code) {
  font(doc, true).fontSize(17).fillColor('#0f766e').text(T(s.clinicName), 40, 40);
  font(doc).fontSize(9).fillColor('#555').text(T([s.address, s.phone, s.email].filter(Boolean).join('  |  ')));
  doc.moveTo(40, doc.y + 6).lineTo(555, doc.y + 6).strokeColor('#0f766e').lineWidth(1.2).stroke();
  doc.moveDown(1);
  font(doc, true).fontSize(14).fillColor('#111').text(T(title), { continued: !!code });
  if (code) font(doc).fontSize(11).fillColor('#555').text(`   ${T(code)}`);
  doc.moveDown(0.4);
}
function kv(doc, pairs) {
  font(doc).fontSize(10).fillColor('#222');
  pairs.filter(([, v]) => v).forEach(([k, v]) => { font(doc, true).text(`${T(k)}: `, { continued: true }); font(doc).text(T(v)); });
  doc.moveDown(0.6);
}
function table(doc, cols, rows) {
  const x0 = 40; const w = 515;
  const sum = cols.reduce((a, c) => a + c.w, 0);
  const scale = w / sum;
  const line = (cells, bold) => {
    if (doc.y > 750) doc.addPage();
    const y = doc.y; let x = x0; let h = 14;
    cells.forEach((cell, i) => {
      const cw = cols[i].w * scale;
      font(doc, bold).fontSize(9).fillColor(bold ? '#fff' : '#222');
      const th = doc.heightOfString(T(cell), { width: cw - 6 });
      h = Math.max(h, th + 6);
    });
    if (bold) doc.rect(x0, y - 2, w, h).fill('#0f766e');
    cells.forEach((cell, i) => {
      const cw = cols[i].w * scale;
      font(doc, bold).fontSize(9).fillColor(bold ? '#fff' : '#222').text(T(cell), x + 3, y + 1, { width: cw - 6, align: cols[i].right ? 'right' : 'left' });
      x += cw;
    });
    doc.y = y + h;
    if (!bold) doc.moveTo(x0, doc.y - 1).lineTo(x0 + w, doc.y - 1).strokeColor('#ddd').lineWidth(0.5).stroke();
  };
  line(cols.map((c) => c.h), true);
  rows.forEach((r) => line(r, false));
  doc.moveDown(0.6);
}
const footer = (doc, s) => { font(doc).fontSize(8).fillColor('#777').text(T(s.invoiceFooter || ''), 40, 790, { width: 515, align: 'center' }); };

export async function invoicePdf(id) {
  const inv = await M('invoices').findOne({ _id: id, deleted: { $ne: true } }).populate('patient', 'name code phone address').lean();
  if (!inv) throw new HttpError(404, 'Invoice not found');
  const s = await getSettings();
  const pays = await M('payments').find({ invoice: id, status: 'Received', deleted: { $ne: true } }).sort({ date: 1 }).lean();
  return build(async (doc) => {
    await header(doc, s, 'INVOICE', inv.code);
    kv(doc, [['Patient', `${inv.patient?.name || ''} (${inv.patient?.code || ''})`], ['Phone', inv.patient?.phone], ['Date', ymd(inv.invoiceDate)], ['Due', ymd(inv.dueDate)], ['Status', inv.status]]);
    table(doc, [{ h: 'Description', w: 5 }, { h: 'Qty', w: 1, right: true }, { h: 'Unit price', w: 2, right: true }, { h: 'Amount', w: 2, right: true }],
      inv.items.map((i) => [i.description, i.quantity, money(s, i.unitPrice), money(s, (i.quantity || 0) * (i.unitPrice || 0))]));
    font(doc).fontSize(10).fillColor('#222');
    [['Subtotal', inv.subtotal], ['Discount', inv.discount], [`Tax (${inv.taxRate || 0}%)`, inv.tax], ['Total', inv.total], ['Paid', inv.paid]].forEach(([k, v]) => doc.text(`${T(k)}: ${money(s, v)}`, { align: 'right' }));
    font(doc, true).fontSize(12).text(`Balance due: ${money(s, inv.balance)}`, { align: 'right' });
    if (pays.length) { doc.moveDown(); font(doc, true).fontSize(10).text('Payments received'); table(doc, [{ h: 'Date', w: 2 }, { h: 'Method', w: 2 }, { h: 'Reference', w: 3 }, { h: 'Amount', w: 2, right: true }], pays.map((p) => [ymd(p.date), p.method, p.reference || '', money(s, p.amount)])); }
    footer(doc, s);
  });
}

export async function prescriptionPdf(id) {
  const rx = await M('prescriptions').findOne({ _id: id, deleted: { $ne: true } }).populate('patient', 'name code gender age dob phone allergies').populate('doctor', 'name specialization qualification').lean();
  if (!rx) throw new HttpError(404, 'Prescription not found');
  const s = await getSettings();
  return build(async (doc) => {
    await header(doc, s, 'PRESCRIPTION', rx.code);
    kv(doc, [['Patient', `${rx.patient?.name || ''} (${rx.patient?.code || ''})`], ['Gender / Age', [rx.patient?.gender, rx.patient?.age].filter(Boolean).join(' / ')], ['Allergies', (rx.patient?.allergies || []).join(', ')],
      ['Doctor', `Dr. ${rx.doctor?.name || ''}${rx.doctor?.qualification ? `, ${rx.doctor.qualification}` : ''}`], ['Date', ymd(rx.date)], ['Diagnosis', rx.diagnosis]]);
    font(doc, true).fontSize(22).fillColor('#0f766e').text('Rx', { continued: false });
    table(doc, [{ h: '#', w: 0.6 }, { h: 'Medicine', w: 4 }, { h: 'Dosage', w: 1.6 }, { h: 'Frequency', w: 1.6 }, { h: 'Duration', w: 1.6 }, { h: 'Instructions', w: 2 }],
      rx.items.map((i, n) => [n + 1, i.medicineName, i.dosage || '', i.frequency || '', i.duration || '', i.instructions || '']));
    if (rx.advice) { font(doc, true).fontSize(10).fillColor('#222').text('Advice'); font(doc).text(T(rx.advice)); doc.moveDown(); }
    if (rx.followUpDate) kv(doc, [['Follow-up', ymd(rx.followUpDate)]]);
    footer(doc, s);
  });
}

export async function labReportPdf(id) {
  const o = await M('labOrders').findOne({ _id: id, deleted: { $ne: true } }).populate('patient', 'name code gender age phone').populate('doctor', 'name').populate('items.test', 'name').lean();
  if (!o) throw new HttpError(404, 'Lab order not found');
  const s = await getSettings();
  return build(async (doc) => {
    await header(doc, s, 'LABORATORY REPORT', o.code);
    kv(doc, [['Patient', `${o.patient?.name || ''} (${o.patient?.code || ''})`], ['Gender / Age', [o.patient?.gender, o.patient?.age].filter(Boolean).join(' / ')], ['Referred by', o.doctor ? `Dr. ${o.doctor.name}` : ''], ['Ordered', ymd(o.orderDate)], ['Status', o.status]]);
    table(doc, [{ h: 'Test', w: 3 }, { h: 'Result', w: 1.6 }, { h: 'Unit', w: 1.2 }, { h: 'Normal range', w: 2 }, { h: 'Flag', w: 1.2 }],
      o.items.map((i) => [i.test?.name || '', i.result || '—', i.unit || '', i.normalRange || '', i.flag || '']));
    footer(doc, s);
  });
}

export const PDF_BUILDERS = { invoices: invoicePdf, prescriptions: prescriptionPdf, labOrders: labReportPdf };