// Official quote PDF (A4), built in the browser with pdf-lib from an issued
// quote. Pure: receives the data, returns the bytes. Standard Helvetica is used
// (no font download); text is reduced to the characters it can encode.
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, rgb, StandardFonts } from 'pdf-lib';

export interface QuotePdfLine {
  sku: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
  total: number;
}

export interface QuotePdfData {
  number: string;
  issuedAt: Date;
  validityDays: number;
  company: {
    legalName: string | null;
    taxId: string | null;
    address: string | null;
    phones: string[];
    email: string | null;
    primaryColor: string;
    secondaryColor: string;
    logo?: { bytes: Uint8Array; type: 'png' | 'jpg' } | null;
  };
  seller?: { name: string | null; email: string | null } | null;
  client: {
    name: string;
    company: string | null;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  lines: QuotePdfLine[];
  totals: { gross: number; discount: number; net: number; vatRate: number; vat: number; total: number };
  paymentTerms: string;
  deliveryTerms: string;
  notes: string | null;
  legalFooter: string;
}

// ---- text helpers ------------------------------------------------------------
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACEMENTS: Record<string, string> = { '−': '-', '→': '->', '≥': '>=', '≤': '<=', ' ': ' ', ' ': ' ', '\t': ' ' };

export function toWinAnsi(text: string): string {
  let out = '';
  for (const char of text || '') {
    const code = char.codePointAt(0)!;
    if (REPLACEMENTS[char] !== undefined) out += REPLACEMENTS[char];
    else if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(char) || char === '\n') out += char;
    else if (code > 0xffff || /\p{Extended_Pictographic}/u.test(char)) continue; // emoji: drop
    else out += char.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  }
  return out;
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of toWinAnsi(text).split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) { current = candidate; continue; }
      if (current) lines.push(current);
      // A single word longer than the line is cut into pieces.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
        let cut = rest.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

export const clp = (value: number) => `$${Math.round(value).toLocaleString('es-CL')}`;
const pct = (value: number) => `${Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 })}%`;
const qty = (value: number) => Number(value).toLocaleString('es-CL', { maximumFractionDigits: 2 });
const day = (date: Date) => `${String(date.getDate()).padStart(2, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${date.getFullYear()}`;

function hexColor(hex: string, fallback = '#1A9387') {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? hex : fallback;
  return rgb(parseInt(value.slice(1, 3), 16) / 255, parseInt(value.slice(3, 5), 16) / 255, parseInt(value.slice(5, 7), 16) / 255);
}

// ---- layout ----------------------------------------------------------------
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42; // margin
const INK = rgb(0.13, 0.15, 0.18);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.86, 0.87, 0.89);
const ZEBRA = rgb(0.97, 0.97, 0.98);
const WHITE = rgb(1, 1, 1);

// Columns: code, description, qty, unit price, discount, total.
const COLS = [
  { key: 'sku', label: 'Código', width: 106, align: 'left' as const },
  { key: 'description', label: 'Descripción', width: 0, align: 'left' as const },
  { key: 'qty', label: 'Cant.', width: 38, align: 'right' as const },
  { key: 'unit', label: 'Precio unit.', width: 74, align: 'right' as const },
  { key: 'disc', label: 'Desc.', width: 38, align: 'right' as const },
  { key: 'total', label: 'Total', width: 78, align: 'right' as const },
];
COLS[1].width = PAGE_W - 2 * M - COLS.reduce((sum, col) => sum + col.width, 0);

export async function buildQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(toWinAnsi(`Cotización ${data.number}`));
  pdf.setAuthor(toWinAnsi(data.company.legalName ?? ''));
  pdf.setCreationDate(data.issuedAt);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const primary = hexColor(data.company.primaryColor);
  const secondary = hexColor(data.company.secondaryColor, '#127BA1');

  let logo: PDFImage | null = null;
  if (data.company.logo) {
    try {
      logo = data.company.logo.type === 'png' ? await pdf.embedPng(data.company.logo.bytes) : await pdf.embedJpg(data.company.logo.bytes);
    } catch { logo = null; } // a broken logo never blocks the quote
  }

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - M;

  const text = (value: string, x: number, top: number, size: number, f: PDFFont = font, color = INK) =>
    page.drawText(toWinAnsi(value), { x, y: top - size, size, font: f, color });
  const textRight = (value: string, right: number, top: number, size: number, f: PDFFont = font, color = INK) => {
    const clean = toWinAnsi(value);
    page.drawText(clean, { x: right - f.widthOfTextAtSize(clean, size), y: top - size, size, font: f, color });
  };

  // Header band
  page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: primary });
  y -= 6;

  // Left: logo or company name
  const headerTop = y;
  let leftBottom = headerTop;
  if (logo) {
    const scale = Math.min(160 / logo.width, 54 / logo.height, 1);
    const w = logo.width * scale;
    const h = logo.height * scale;
    page.drawImage(logo, { x: M, y: headerTop - h, width: w, height: h });
    leftBottom = headerTop - h - 8;
    if (data.company.legalName) { text(data.company.legalName, M, leftBottom, 10, bold); leftBottom -= 14; }
  } else if (data.company.legalName) {
    for (const line of wrapText(data.company.legalName, bold, 16, 250)) { text(line, M, leftBottom, 16, bold); leftBottom -= 20; }
  }
  const companyLines = [
    data.company.taxId ? `RUT ${data.company.taxId}` : null,
    data.company.address,
    data.company.phones.filter(Boolean).join(' · ') || null,
    data.company.email,
  ].filter((line): line is string => !!line);
  for (const line of companyLines) { text(line, M, leftBottom, 8.5, font, MUTED); leftBottom -= 12; }

  // Right: document identity
  const right = PAGE_W - M;
  const issued = data.issuedAt;
  const validUntil = new Date(issued.getTime() + data.validityDays * 86_400_000);
  textRight('COTIZACIÓN', right, headerTop, 9, bold, primary);
  textRight(data.number, right, headerTop - 13, 17, bold);
  textRight(`Fecha: ${day(issued)}`, right, headerTop - 36, 9, font, MUTED);
  textRight(`Válida hasta: ${day(validUntil)}`, right, headerTop - 49, 9, font, MUTED);
  y = Math.min(leftBottom, headerTop - 62) - 10;

  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.8, color: RULE });
  y -= 16;

  // Client and seller
  const colW = (PAGE_W - 2 * M - 24) / 2;
  const clientTop = y;
  text('CLIENTE', M, y, 8, bold, secondary);
  let cy = y - 13;
  const clientTitle = data.client.company || data.client.name;
  for (const line of wrapText(clientTitle, bold, 11, colW)) { text(line, M, cy, 11, bold); cy -= 14; }
  const clientLines = [
    data.client.taxId ? `RUT ${data.client.taxId}` : null,
    data.client.company ? `Atención: ${data.client.name}` : null,
    data.client.email,
    data.client.phone,
    data.client.address,
  ].filter((line): line is string => !!line);
  for (const line of clientLines) for (const part of wrapText(line, font, 9, colW)) { text(part, M, cy, 9, font, INK); cy -= 12; }

  let sy = clientTop;
  if (data.seller?.name || data.seller?.email) {
    const sx = M + colW + 24;
    text('EJECUTIVO', sx, sy, 8, bold, secondary);
    sy -= 13;
    if (data.seller.name) { text(data.seller.name, sx, sy, 11, bold); sy -= 14; }
    if (data.seller.email) { text(data.seller.email, sx, sy, 9); sy -= 12; }
  }
  y = Math.min(cy, sy) - 16;

  // Table
  const ROW_PAD = 6;
  const drawTableHeader = () => {
    page.drawRectangle({ x: M, y: y - 20, width: PAGE_W - 2 * M, height: 20, color: primary });
    let x = M;
    for (const col of COLS) {
      if (col.align === 'right') textRight(col.label, x + col.width - ROW_PAD, y - 6, 8.5, bold, WHITE);
      else text(col.label, x + ROW_PAD, y - 6, 8.5, bold, WHITE);
      x += col.width;
    }
    y -= 20;
  };
  const newPage = () => {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    page.drawRectangle({ x: 0, y: PAGE_H - 8, width: PAGE_W, height: 8, color: primary });
    y = PAGE_H - M - 6;
    textRight(`Cotización ${data.number} (continuación)`, right, y, 8.5, font, MUTED);
    y -= 22;
  };
  const FOOTER_SPACE = 40;
  drawTableHeader();

  data.lines.forEach((line, index) => {
    const cells: Record<string, string[]> = {
      sku: wrapText(line.sku ?? '—', bold, 8.5, COLS[0].width - 2 * ROW_PAD),
      description: wrapText(line.description, font, 8.5, COLS[1].width - 2 * ROW_PAD),
      qty: [qty(line.quantity)],
      unit: [clp(line.unitPrice)],
      disc: [line.discountPct > 0 ? pct(line.discountPct) : '—'],
      total: [clp(line.total)],
    };
    const rowLines = Math.max(...Object.values(cells).map(c => c.length));
    const rowH = rowLines * 11 + 2 * ROW_PAD;
    if (y - rowH < M + FOOTER_SPACE) { newPage(); drawTableHeader(); }
    if (index % 2 === 1) page.drawRectangle({ x: M, y: y - rowH, width: PAGE_W - 2 * M, height: rowH, color: ZEBRA });
    let x = M;
    for (const col of COLS) {
      cells[col.key].forEach((part, i) => {
        const top = y - ROW_PAD - i * 11;
        const f = col.key === 'sku' ? bold : font;
        if (col.align === 'right') textRight(part, x + col.width - ROW_PAD, top, 8.5, f);
        else text(part, x + ROW_PAD, top, 8.5, f);
      });
      x += col.width;
    }
    y -= rowH;
  });
  page.drawLine({ start: { x: M, y }, end: { x: right, y }, thickness: 0.8, color: RULE });
  y -= 14;

  // Totals
  const rows: Array<[string, string, boolean]> = [
    ['Subtotal', clp(data.totals.gross), false],
    ...(data.totals.discount > 0 ? [['Descuento', `-${clp(data.totals.discount)}`, false] as [string, string, boolean]] : []),
    ['Neto', clp(data.totals.net), false],
    [`IVA (${pct(data.totals.vatRate)})`, clp(data.totals.vat), false],
    ['Total', clp(data.totals.total), true],
  ];
  const totalsH = rows.length * 16 + 10;
  if (y - totalsH < M + FOOTER_SPACE) newPage();
  const tx = right - 220;
  for (const [label, value, strong] of rows) {
    if (strong) {
      page.drawRectangle({ x: tx, y: y - 22, width: 220, height: 22, color: primary });
      text(label, tx + 10, y - 6, 11, bold, WHITE);
      textRight(value, right - 10, y - 6, 11, bold, WHITE);
      y -= 26;
    } else {
      text(label, tx + 10, y, 9.5, font, MUTED);
      textRight(value, right - 10, y, 9.5, font, INK);
      y -= 16;
    }
  }
  y -= 12;

  // Conditions
  const conditions: Array<[string, string]> = [
    ['Forma de pago', data.paymentTerms],
    ['Plazo de entrega', data.deliveryTerms],
    ['Validez', `${data.validityDays} días (hasta el ${day(validUntil)})`],
    ...(data.notes ? [['Nota', data.notes] as [string, string]] : []),
  ];
  const labelW = 92;
  const valueW = PAGE_W - 2 * M - labelW;
  const conditionLines = conditions.map(([label, value]) => [label, wrapText(value, font, 9, valueW)] as const);
  const conditionsH = 18 + conditionLines.reduce((sum, [, lines]) => sum + lines.length * 12 + 4, 0);
  if (y - conditionsH < M + FOOTER_SPACE) newPage();
  text('CONDICIONES', M, y, 8, bold, secondary);
  y -= 16;
  for (const [label, lines] of conditionLines) {
    text(label, M, y, 9, bold, INK);
    lines.forEach((line, i) => text(line, M + labelW, y - i * 12, 9));
    y -= lines.length * 12 + 4;
  }

  // Legal footer (last page) and page numbers (every page)
  if (data.legalFooter.trim()) {
    const legal = wrapText(data.legalFooter, font, 7.5, PAGE_W - 2 * M);
    const legalH = legal.length * 10;
    if (y - legalH - 14 < M + 16) newPage();
    const top = M + 16 + legalH;
    page.drawLine({ start: { x: M, y: top + 6 }, end: { x: right, y: top + 6 }, thickness: 0.5, color: RULE });
    legal.forEach((line, i) => text(line, M, top - i * 10, 7.5, font, MUTED));
  }
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    const label = toWinAnsi(`${data.number} · Página ${i + 1} de ${pages.length}`);
    p.drawText(label, { x: PAGE_W - M - font.widthOfTextAtSize(label, 7.5), y: M - 14, size: 7.5, font, color: MUTED });
  });

  return pdf.save();
}
