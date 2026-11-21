/* =====================================================================
   Vishenka Store — генератор штрихкодов (EAN-13 + Code 128B),
   нормализация раскладки сканера и звуковые сигналы POS-кассы.
   100% автономно, без внешних библиотек — идеально чёткий SVG для Xprinter.
   ===================================================================== */

const RU_TO_EN = {
  'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't', 'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p', 'х': '[', 'ъ': ']',
  'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g', 'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'ж': ';', 'э': "'",
  'я': 'z', 'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n', 'ь': 'm', 'б': ',', 'ю': '.',
  'Й': 'Q', 'Ц': 'W', 'У': 'E', 'К': 'R', 'Е': 'T', 'Н': 'Y', 'Г': 'U', 'Ш': 'I', 'Щ': 'O', 'З': 'P', 'Х': '{', 'Ъ': '}',
  'Ф': 'A', 'Ы': 'S', 'В': 'D', 'А': 'F', 'П': 'G', 'Р': 'H', 'О': 'J', 'Л': 'K', 'Д': 'L', 'Ж': ':', 'Э': '"',
  'Я': 'Z', 'Ч': 'X', 'С': 'C', 'М': 'V', 'И': 'B', 'Т': 'N', 'Ь': 'M', 'Б': '<', 'Ю': '>',
};

export function normalizeScannedCode(raw) {
  return String(raw || '')
    .trim()
    .split('')
    .map((ch) => RU_TO_EN[ch] || ch)
    .join('');
}

export function ean13CheckDigit(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

export function isValidEan13(code) {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === code[12];
}

export function makeEan13(seedNumber) {
  const n = Math.abs(Number(seedNumber) || Math.floor(Math.random() * 90000 + 10000));
  const base = ('2000000' + String(n).padStart(5, '0')).slice(0, 12);
  return base + ean13CheckDigit(base);
}

export function makeRandomEan13() {
  const rand = String(Math.floor(1000000000 + Math.random() * 8999999999));
  const base = '20' + rand;
  return base + ean13CheckDigit(base);
}

// --------------------- EAN-13 tables ---------------------
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function encodeEan13Bits(code) {
  const first = Number(code[0]);
  const pattern = EAN_PARITY[first];
  let bits = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    bits += pattern[i - 1] === 'L' ? EAN_L[d] : EAN_G[d];
  }
  bits += '01010';
  for (let i = 7; i <= 12; i++) {
    bits += EAN_R[Number(code[i])];
  }
  bits += '101';
  return bits; // 95 modules
}

// --------------------- Code 128B table (ISO/IEC 15417) ---------------------
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

function widthsToBits(widths) {
  let out = '';
  for (let i = 0; i < widths.length; i++) {
    out += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
  }
  return out;
}

function encodeCode128BBits(text) {
  const clean = normalizeScannedCode(text).replace(/[^\x20-\x7E]/g, '') || '000000';
  const codes = [104]; // Start Code B
  let checksum = 104;
  for (let i = 0; i < clean.length; i++) {
    const val = clean.charCodeAt(i) - 32;
    codes.push(val);
    checksum += val * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106); // Stop
  return codes.map((c) => widthsToBits(CODE128_PATTERNS[c])).join('');
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Генерирует чёткий векторный SVG штрихкода (EAN-13 или Code 128B).
 */
export function buildBarcodeSvg(rawValue, options = {}) {
  const value = normalizeScannedCode(rawValue);
  const {
    barHeight = 46,
    moduleWidth = 1.8,
    showText = true,
    fontSize = 11,
  } = options;

  if (!value) return '';

  const isEan = isValidEan13(value);
  const bits = isEan ? encodeEan13Bits(value) : encodeCode128BBits(value);
  const quietLeft = isEan ? 10 : 10;
  const quietRight = isEan ? 7 : 10;
  const totalModules = quietLeft + bits.length + quietRight;
  const svgW = Math.round(totalModules * moduleWidth * 10) / 10;
  const textArea = showText ? fontSize + 5 : 0;
  const svgH = Math.round((barHeight + textArea + 2) * 10) / 10;

  // Группируем смежные 1-цы в один <rect> (с учётом удлинённых ограничителей EAN-13)
  const rects = [];
  const isGuard = (idx) => isEan && (idx < 3 || (idx >= 45 && idx < 50) || idx >= 92);

  let i = 0;
  while (i < bits.length) {
    if (bits[i] === '1') {
      const guard = isGuard(i);
      let run = 1;
      while (i + run < bits.length && bits[i + run] === '1' && isGuard(i + run) === guard) {
        run++;
      }
      const x = ((quietLeft + i) * moduleWidth).toFixed(2);
      const w = (run * moduleWidth).toFixed(2);
      const h = (guard && showText ? barHeight + 4 : barHeight).toFixed(2);
      rects.push(`<rect x="${x}" y="1" width="${w}" height="${h}" fill="#000"/>`);
      i += run;
    } else {
      i++;
    }
  }

  let textSvg = '';
  if (showText) {
    const y = (barHeight + fontSize + 2).toFixed(1);
    if (isEan) {
      const x0 = ((quietLeft - 5) * moduleWidth).toFixed(1);
      const x1 = ((quietLeft + 24) * moduleWidth).toFixed(1);
      const x2 = ((quietLeft + 71) * moduleWidth).toFixed(1);
      textSvg =
        `<text x="${x0}" y="${y}" font-family="'Courier New',monospace" font-size="${fontSize}" font-weight="700" text-anchor="middle" fill="#000">${value[0]}</text>` +
        `<text x="${x1}" y="${y}" font-family="'Courier New',monospace" font-size="${fontSize}" font-weight="700" text-anchor="middle" letter-spacing="1.2" fill="#000">${value.slice(1, 7)}</text>` +
        `<text x="${x2}" y="${y}" font-family="'Courier New',monospace" font-size="${fontSize}" font-weight="700" text-anchor="middle" letter-spacing="1.2" fill="#000">${value.slice(7, 13)}</text>`;
    } else {
      const cx = (svgW / 2).toFixed(1);
      textSvg = `<text x="${cx}" y="${y}" font-family="'Courier New',monospace" font-size="${fontSize}" font-weight="700" text-anchor="middle" letter-spacing="1.5" fill="#000">${escapeXml(value)}</text>`;
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgW} ${svgH}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"><rect width="${svgW}" height="${svgH}" fill="#fff"/>${rects.join('')}${textSvg}</svg>`;
}

// --------------------- POS Web Audio feedback ---------------------
let audioCtx = null;

function beep(freq, durationMs, type = 'sine', volume = 0.14, delayMs = 0) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const start = audioCtx.currentTime + delayMs / 1000;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + durationMs / 1000);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + durationMs / 1000 + 0.01);
  } catch {
    // Игнорируем, если звук заблокирован браузером
  }
}

export function playScanOk(enabled = true) {
  if (!enabled) return;
  beep(1560, 85, 'sine', 0.16, 0);
  beep(2090, 90, 'sine', 0.12, 75);
}

export function playScanError(enabled = true) {
  if (!enabled) return;
  beep(290, 140, 'triangle', 0.18, 0);
  beep(220, 180, 'triangle', 0.16, 150);
}

export function playCashRegister(enabled = true) {
  if (!enabled) return;
  beep(880, 70, 'sine', 0.13, 0);
  beep(1320, 90, 'sine', 0.13, 70);
  beep(1760, 160, 'sine', 0.14, 145);
}
