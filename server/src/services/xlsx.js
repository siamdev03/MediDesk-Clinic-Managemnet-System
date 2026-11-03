// Feature 23: Excel (.xlsx) export helpers.
import ExcelJS from 'exceljs';

const looksNumeric = (v) => /^-?\d+(\.\d+)?$/.test(v) && !/^0\d/.test(v) && v.replace('-', '').replace('.', '').length < 12;

export function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// sheets: [{ name, rows: [[header...], [..], ...] }]
export async function workbookBuffer(sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MediDesk';
  for (const sh of sheets) {
    const ws = wb.addWorksheet(String(sh.name).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet1');
    sh.rows.forEach((r, i) => {
      ws.addRow(r.map((v) => (i > 0 && typeof v === 'string' && looksNumeric(v) ? Number(v) : v)));
    });
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (sh.rows[0]?.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sh.rows[0].length } };
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell({ includeEmpty: false }, (c) => { max = Math.max(max, Math.min(48, String(c.value ?? '').length + 2)); });
      col.width = max;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}