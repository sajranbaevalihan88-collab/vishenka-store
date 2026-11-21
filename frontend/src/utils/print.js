/* =====================================================================
   Vishenka Store — печать термоэтикеток (Xprinter) и кассовых чеков.
   ===================================================================== */
import { buildBarcodeSvg, makeEan13 } from './barcode';

export const LABEL_PRESETS = {
  '58x40': { id: '58x40', label: '58 × 40 мм (Xprinter стандарт)', w: 58, h: 40, barH: 50, font: 10 },
  '58x30': { id: '58x30', label: '58 × 30 мм (Xprinter компакт)', w: 58, h: 30, barH: 36, font: 9 },
  '40x30': { id: '40x30', label: '40 × 30 мм (средняя бирка)', w: 40, h: 30, barH: 34, font: 8 },
  '30x20': { id: '30x20', label: '30 × 20 мм (малая бирка)', w: 30, h: 20, barH: 24, font: 7 },
  'a4': { id: 'a4', label: 'Лист A4 (сетка 3×7 наклеек)', w: 63, h: 38, barH: 44, font: 10, sheet: true },
};

export const PAYMENT_LABELS = {
  cash: 'Наличные',
  qr: 'QR / Перевод',
  card: 'Карта',
  mixed: 'Смешанная',
};

const fmtMoney = (n) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(n || 0) + ' сом';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function resolveBarcodeValue(product) {
  if (!product) return '';
  const bc = String(product.barcode || '').trim();
  if (bc) return bc;
  if (product.id) return makeEan13(product.id);
  return String(product.code || '').trim();
}

function openPrintWindow(html, title) {
  const win = window.open('', '_blank', 'width=760,height=640');
  if (!win) {
    window.alert('Разрешите всплывающие окна в браузере для печати на Xprinter.');
    return false;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  setTimeout(() => {
    win.focus();
    win.print();
  }, 260);
  return true;
}

/**
 * Печать термоэтикеток со штрихкодом на Xprinter (или A4).
 */
export function printBarcodeLabels(items, opts = {}) {
  const preset = LABEL_PRESETS[opts.size || '58x40'] || LABEL_PRESETS['58x40'];
  const storeName = opts.storeName || 'VISHENKA STORE';
  const showStore = opts.showStore !== false;
  const showPrice = opts.showPrice !== false;
  const showCode = opts.showCode !== false;

  const expanded = [];
  for (const entry of items) {
    const count = Math.max(0, Math.min(200, Number(entry.copies) || 0));
    for (let i = 0; i < count; i++) expanded.push(entry.product);
  }
  if (!expanded.length) return false;

  const isSmall = preset.w <= 32;
  const isMid = preset.w <= 42 && !isSmall;

  const labelsHtml = expanded.map((p) => {
    const codeValue = resolveBarcodeValue(p);
    const svg = buildBarcodeSvg(codeValue, {
      barHeight: preset.barH,
      moduleWidth: isSmall ? 1.45 : 1.9,
      showText: true,
      fontSize: isSmall ? 9 : 11.5,
    });
    const hasMeta = showPrice || (showCode && p.code);
    return `
      <div class="sticker">
        ${showStore ? `<div class="st-brand">${esc(storeName.toUpperCase())}</div>` : ''}
        <div class="st-name">${esc(p.name)}</div>
        ${hasMeta ? `
          <div class="st-meta ${showCode && p.code ? 'both' : 'center'}">
            ${showPrice ? `<span class="st-price">${fmtMoney(p.sale_price)}</span>` : ''}
            ${showCode && p.code ? `<span class="st-code">${esc(p.code)}</span>` : ''}
          </div>
        ` : ''}
        <div class="st-bc">${svg}</div>
      </div>
    `;
  }).join('');

  const pageCss = preset.sheet
    ? `@page { size: A4; margin: 8mm; }
       body { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; padding: 0; }
       .sticker { border: 0.3mm dashed #bbb; height: ${preset.h}mm; page-break-inside: avoid; }`
    : `@page { size: ${preset.w}mm ${preset.h}mm; margin: 0; }
       body { margin: 0; padding: 0; }
       .sticker { width: ${preset.w}mm; height: ${preset.h}mm; page-break-after: always; break-after: page; }
       .sticker:last-child { page-break-after: auto; break-after: auto; }`;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Этикетки Vishenka Store</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; color: #000; font-family: Arial, 'Segoe UI', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  ${pageCss}
  .sticker {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: ${isSmall ? '1.2mm 1.6mm' : isMid ? '1.8mm 2.4mm' : '2.2mm 3mm'};
    overflow: hidden;
    background: #fff;
  }
  .st-brand {
    font-size: ${isSmall ? '5.5pt' : isMid ? '6.5pt' : '7.5pt'};
    font-weight: 800;
    letter-spacing: 1.8px;
    text-align: center;
    border-bottom: 0.25mm solid #000;
    padding-bottom: 0.7mm;
  }
  .st-name {
    font-size: ${isSmall ? '6.5pt' : isMid ? '7.8pt' : '8.8pt'};
    font-weight: 700;
    line-height: 1.15;
    max-height: ${isSmall ? '5mm' : '7.5mm'};
    overflow: hidden;
    text-align: center;
  }
  .st-meta {
    display: flex;
    align-items: baseline;
    gap: 2mm;
  }
  .st-meta.center { justify-content: center; }
  .st-meta.both { justify-content: space-between; }
  .st-price {
    font-size: ${isSmall ? '8pt' : isMid ? '10pt' : '11.5pt'};
    font-weight: 900;
    letter-spacing: -0.3px;
  }
  .st-code {
    font-size: ${isSmall ? '5.5pt' : '7pt'};
    font-weight: 700;
    border: 0.25mm solid #000;
    padding: 0.2mm 1.2mm;
  }
  .st-bc {
    width: 100%;
    height: ${isSmall ? '9.8mm' : isMid ? '14mm' : preset.h <= 30 ? '14mm' : '19.5mm'};
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .st-bc svg { width: 100%; height: 100%; }
  @media screen {
    body { background: #f3eee8; padding: 16px; display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
    .sticker { box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 3px; }
  }
</style>
</head>
<body>${labelsHtml}</body>
</html>`;

  return openPrintWindow(html, 'Этикетки Vishenka Store — Xprinter');
}

export function downloadBarcodeSvg(product) {
  const code = resolveBarcodeValue(product);
  const svg = buildBarcodeSvg(code, { barHeight: 54, moduleWidth: 2, showText: true, fontSize: 12 });
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `barcode-${code}.svg`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * Печать кассового чека на термопринтере Xprinter (58мм / 80мм).
 */
export function printThermalReceipt(receipt, storeSettings = {}) {
  const widthMm = storeSettings.receipt_width === '80mm' ? 80 : 58;
  const storeName = storeSettings.store_name || 'Vishenka Store';
  const phone = storeSettings.store_phone || '';
  const address = storeSettings.store_address || '';
  const payLabel = PAYMENT_LABELS[receipt.payment_method] || receipt.payment_method || 'Наличные';

  const itemsRows = (receipt.items || []).map((it, idx) => `
    <div class="it">
      <div class="it-name">${idx + 1}. ${esc(it.name)}</div>
      <div class="it-line">
        <span>${it.quantity} шт × ${fmtMoney(it.unit_price)}</span>
        <b>${fmtMoney(it.line_total ?? it.quantity * it.unit_price)}</b>
      </div>
      ${Number(it.discount || 0) > 0 ? `<div class="it-disc">Скидка на товар: −${fmtMoney(it.discount)}</div>` : ''}
    </div>
  `).join('');

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Чек ${esc(receipt.receipt_no)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${widthMm}mm;
    padding: 3.5mm 3mm 6mm;
    font-family: 'Courier New', monospace;
    font-size: ${widthMm === 80 ? '10pt' : '8.5pt'};
    color: #000;
    background: #fff;
    line-height: 1.35;
  }
  .c { text-align: center; }
  .brand { font-size: ${widthMm === 80 ? '14pt' : '11.5pt'}; font-weight: 900; letter-spacing: 1.5px; }
  .sub { font-size: 7.5pt; margin-top: 1mm; }
  .hr { border-top: 1px dashed #000; margin: 2.5mm 0; }
  .row { display: flex; justify-content: space-between; gap: 2mm; }
  .it { margin-bottom: 2mm; }
  .it-name { font-weight: 700; word-break: break-word; }
  .it-line { display: flex; justify-content: space-between; padding-left: 2mm; }
  .it-disc { padding-left: 2mm; font-size: 7.5pt; }
  .brand-emblem { width: 12mm; height: 12mm; border-radius: 50%; object-fit: cover; border: 0.4mm solid #000; margin: 0 auto 1.2mm; display: block; }
  .total { font-size: ${widthMm === 80 ? '13pt' : '11pt'}; font-weight: 900; margin: 1.5mm 0; }
  .thanks { text-align: center; margin-top: 3mm; font-size: 8pt; font-weight: 700; }
  @media screen {
    body { margin: 18px auto; box-shadow: 0 8px 28px rgba(0,0,0,.18); }
  }
</style>
</head>
<body>
  <div class="c">
    <img src="${window.location.origin}/logo.jpg" alt="Vishenka Store" class="brand-emblem" onerror="this.style.display='none'" />
    <div class="brand">${esc(storeName.toUpperCase())}</div>
    <div class="sub">Бутик женской одежды</div>
    ${address ? `<div class="sub">${esc(address)}</div>` : ''}
    ${phone ? `<div class="sub">Тел: ${esc(phone)}</div>` : ''}
  </div>
  <div class="hr"></div>
  <div class="row"><span>Чек:</span><b>${esc(receipt.receipt_no || '—')}</b></div>
  <div class="row"><span>Дата:</span><span>${esc(receipt.created_at || receipt.sale_date || '')}</span></div>
  <div class="hr"></div>
  ${itemsRows}
  <div class="hr"></div>
  ${Number(receipt.discount || 0) > 0 ? `
    <div class="row"><span>Подытог:</span><span>${fmtMoney(receipt.subtotal)}</span></div>
    <div class="row"><span>Скидка:</span><span>−${fmtMoney(receipt.discount)}</span></div>
  ` : ''}
  <div class="row total"><span>ИТОГО:</span><span>${fmtMoney(receipt.total)}</span></div>
  <div class="row"><span>Оплата:</span><b>${esc(payLabel)}</b></div>
  ${receipt.payment_method === 'cash' && Number(receipt.cash_received || 0) > 0 ? `
    <div class="row"><span>Получено:</span><span>${fmtMoney(receipt.cash_received)}</span></div>
    <div class="row"><span>Сдача:</span><b>${fmtMoney(receipt.change_amount)}</b></div>
  ` : ''}
  ${receipt.payment_method === 'mixed' ? `
    <div class="row"><span>Наличные:</span><span>${fmtMoney(receipt.cash_part)}</span></div>
    <div class="row"><span>Карта / QR:</span><span>${fmtMoney(receipt.card_part)}</span></div>
  ` : ''}
  ${receipt.note ? `<div class="hr"></div><div class="sub">Примечание: ${esc(receipt.note)}</div>` : ''}
  <div class="hr"></div>
  <div class="thanks">Спасибо за покупку!<br/>Ждём Вас снова в ${esc(storeName)}</div>
</body>
</html>`;

  return openPrintWindow(html, `Чек ${receipt.receipt_no || ''}`);
}
