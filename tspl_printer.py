"""Прямая печать термоэтикеток TSPL на Xprinter XP-365B (и др. Xprinter/TSC) без диалога браузера.

Генерирует идеально ровную 203-DPI монохромную этикетку (кириллица + чёткий EAN-13 / Code 128B)
и отправляет напрямую в Windows Spooler (RAW TSPL) — без поворота на 90°, без about:blank и без сползания по зазору.
"""
from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from typing import Any

if sys.platform == "win32":
    from ctypes import wintypes
else:
    wintypes = None  # type: ignore[assignment]

DPI_DOTS_PER_MM = 8  # 203 DPI ≈ 8 точек/мм

LABEL_SIZES_MM: dict[str, tuple[int, int]] = {
    "58x40": (58, 40),
    "58x30": (58, 30),
    "40x30": (40, 30),
    "30x20": (30, 20),
}

# --------------------- EAN-13 ---------------------
_EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"]
_EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"]
_EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"]
_EAN_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"]

# --------------------- Code 128B ---------------------
_C128 = [
    "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
    "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
    "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
    "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
    "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
    "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
    "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
    "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
    "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
    "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
    "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
]


def _is_valid_ean13(code: str) -> bool:
    if len(code) != 13 or not code.isdigit():
        return False
    s = sum(int(code[i]) * (1 if i % 2 == 0 else 3) for i in range(12))
    return str((10 - (s % 10)) % 10) == code[12]


def _encode_ean13(code: str) -> str:
    pat = _EAN_PARITY[int(code[0])]
    bits = ["101"]
    for i in range(1, 7):
        d = int(code[i])
        bits.append(_EAN_L[d] if pat[i - 1] == "L" else _EAN_G[d])
    bits.append("01010")
    for i in range(7, 13):
        bits.append(_EAN_R[int(code[i])])
    bits.append("101")
    return "".join(bits)


def _encode_code128b(text: str) -> str:
    clean = "".join(ch for ch in (text or "").strip() if 32 <= ord(ch) <= 126) or "000000"
    codes = [104]
    chk = 104
    for i, ch in enumerate(clean):
        v = ord(ch) - 32
        codes.append(v)
        chk += v * (i + 1)
    codes.append(chk % 103)
    codes.append(106)
    bits = []
    for c in codes:
        for j, w in enumerate(_C128[c]):
            bits.append(("1" if j % 2 == 0 else "0") * int(w))
    return "".join(bits)


def _load_font(size: int, bold: bool = False):
    from PIL import ImageFont

    candidates = (
        [
            r"C:\Windows\Fonts\arialbd.ttf",
            r"C:\Windows\Fonts\segoeuib.ttf",
            r"C:\Windows\Fonts\calibrib.ttf",
            r"C:\Windows\Fonts\tahomabd.ttf",
        ]
        if bold
        else [
            r"C:\Windows\Fonts\arial.ttf",
            r"C:\Windows\Fonts\segoeui.ttf",
            r"C:\Windows\Fonts\calibri.ttf",
            r"C:\Windows\Fonts\tahoma.ttf",
        ]
    )
    for fp in candidates:
        if Path(fp).exists():
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                pass
    return ImageFont.load_default()


def _fmt_money(amount: Any) -> str:
    try:
        n = int(round(float(amount or 0)))
    except Exception:
        n = 0
    return f"{n:,}".replace(",", " ") + " сом"


def _wrap_text(draw, text: str, font, max_width: int, max_lines: int = 2) -> list[str]:
    words = (text or "").strip().split()
    if not words:
        return [""]
    lines: list[str] = []
    cur = words[0]
    for w in words[1:]:
        test = f"{cur} {w}"
        if draw.textlength(test, font=font) <= max_width:
            cur = test
        else:
            lines.append(cur)
            cur = w
            if len(lines) >= max_lines - 1:
                break
    remaining = words[len(" ".join(lines + [cur]).split()):]
    if remaining:
        cur = cur + " " + " ".join(remaining)
    lines.append(cur)
    # Подрезаем последнюю строку, если она шире max_width
    out = []
    for ln in lines[:max_lines]:
        while len(ln) > 3 and draw.textlength(ln, font=font) > max_width:
            ln = ln[:-2] + "…"
        out.append(ln)
    return out


def render_label_image(
    *,
    name: str,
    price: Any,
    barcode: str,
    code: str = "",
    store_name: str = "VISHENKA STORE",
    size: str = "58x40",
    show_store: bool = True,
    show_price: bool = True,
    show_code: bool = True,
):
    """Рендерит идеально чёткую 1-битную этикетку (203 DPI) для Xprinter."""
    from PIL import Image, ImageDraw

    w_mm, h_mm = LABEL_SIZES_MM.get(size, (58, 40))
    # Ширина в пикселях строго кратна 8 (требование TSPL BITMAP)
    W = ((w_mm * DPI_DOTS_PER_MM) // 8) * 8
    H = h_mm * DPI_DOTS_PER_MM

    img = Image.new("1", (W, H), 1)  # 1 = белая бумага, 0 = чёрная печать
    draw = ImageDraw.Draw(img)

    pad_x = max(12, int(W * 0.045))
    # Небольшой верхний отступ + безопасный нижний запас (~10 мм на 58×40),
    # чтобы с учётом аппаратного смещения датчика зазора XP-365B штрихкод и цифры
    # гарантированно ложились целиком на ОДНУ наклейку и никогда не упирались в зазор.
    pad_y = max(4, int(H * 0.015))
    bottom_safe = max(14, int(H * 0.24)) if h_mm >= 35 else max(10, int(H * 0.14))
    inner_w = W - 2 * pad_x
    scale = W / 464.0  # 1.0 для 58мм, ~0.69 для 40мм, ~0.52 для 30мм
    h_scale = H / 320.0

    y = pad_y

    # 1. Шапка магазина + аккуратная линия
    if show_store and store_name.strip():
        f_brand = _load_font(max(12, int(18 * scale)), bold=True)
        b_txt = store_name.strip().upper()
        bw = draw.textlength(b_txt, font=f_brand)
        draw.text(((W - bw) / 2, y), b_txt, font=f_brand, fill=0)
        y += int(21 * scale) + 2
        draw.line([(pad_x, y), (W - pad_x, y)], fill=0, width=2)
        y += max(4, int(5 * h_scale))

    # 2. Название товара (1–2 строки по центру)
    f_name_sz = max(13, int(21 * min(scale, h_scale + 0.15)))
    f_name = _load_font(f_name_sz, bold=True)
    name_lines = _wrap_text(draw, name or "Товар", f_name, inner_w, max_lines=2 if h_mm >= 30 else 1)
    line_step = int(f_name_sz * 1.12)
    for ln in name_lines:
        lw = draw.textlength(ln, font=f_name)
        draw.text(((W - lw) / 2, y), ln, font=f_name, fill=0)
        y += line_step
    y += max(2, int(4 * h_scale))

    # 3. Цена и артикул
    has_code = show_code and bool((code or "").strip())
    if show_price or has_code:
        f_price = _load_font(max(16, int(31 * min(scale, h_scale + 0.12))), bold=True)
        f_art = _load_font(max(11, int(16 * scale)), bold=True)
        price_txt = _fmt_money(price) if show_price else ""
        art_txt = (code or "").strip()[:14] if has_code else ""

        if price_txt and art_txt:
            draw.text((pad_x, y), price_txt, font=f_price, fill=0)
            aw = draw.textlength(art_txt, font=f_art)
            bx2 = W - pad_x
            bx1 = bx2 - aw - 12
            by1 = y + 3
            by2 = by1 + int(16 * scale) + 7
            draw.rectangle([bx1, by1, bx2, by2], outline=0, width=2)
            draw.text((bx1 + 6, by1 + 2), art_txt, font=f_art, fill=0)
            y += int(33 * min(scale, h_scale + 0.12)) + 3
        elif price_txt:
            pw = draw.textlength(price_txt, font=f_price)
            draw.text(((W - pw) / 2, y), price_txt, font=f_price, fill=0)
            y += int(33 * min(scale, h_scale + 0.12)) + 3
        elif art_txt:
            aw = draw.textlength(art_txt, font=f_art)
            draw.text(((W - aw) / 2, y), art_txt, font=f_art, fill=0)
            y += int(20 * scale) + 3

    # 4. Штрихкод EAN-13 или Code 128B (компактно сразу под ценой, с запасом до нижнего зазора)
    bc_val = (barcode or "").strip()
    is_ean = _is_valid_ean13(bc_val)
    bits = _encode_ean13(bc_val) if is_ean else _encode_code128b(bc_val)

    f_bc_sz = max(12, int(19 * scale))
    f_bc = _load_font(f_bc_sz, bold=True)
    digits_h = f_bc_sz + 4
    bar_y = y + max(5, int(8 * h_scale))
    avail_h = H - bottom_safe - bar_y - digits_h
    bar_h = max(32, min(int(88 * h_scale), avail_h))

    # Подбираем целую ширину модуля (минимум 2 dots на XP-365B чтобы сканер читал мгновенно!)
    usable_bc_w = inner_w - (int(20 * scale) if is_ean else 8)
    mod_w = max(1, min(4, usable_bc_w // max(1, len(bits))))
    if is_ean and mod_w < 2 and W >= 240:
        mod_w = 2
    total_bc_w = len(bits) * mod_w
    start_x = (W - total_bc_w) // 2
    if is_ean:
        # Оставляем место слева для первой цифры EAN-13
        start_x = max(pad_x + int(16 * scale), start_x + int(5 * scale))

    def _is_guard(idx: int) -> bool:
        return is_ean and (idx < 3 or (45 <= idx < 50) or idx >= 92)

    for idx, bit in enumerate(bits):
        if bit == "1":
            x1 = start_x + idx * mod_w
            x2 = x1 + mod_w - 1
            extra = 5 if _is_guard(idx) else 0
            draw.rectangle([x1, bar_y, x2, bar_y + bar_h + extra], fill=0)

    # Цифры под штрихкодом
    txt_y = bar_y + bar_h + 2
    if is_ean:
        d0 = bc_val[0]
        g1 = bc_val[1:7]
        g2 = bc_val[7:13]
        d0_w = draw.textlength(d0, font=f_bc)
        draw.text((start_x - d0_w - max(4, mod_w * 2), txt_y), d0, font=f_bc, fill=0)
        cx1 = start_x + int(24 * mod_w)
        cx2 = start_x + int(71 * mod_w)
        draw.text((cx1 - draw.textlength(g1, font=f_bc) / 2, txt_y), g1, font=f_bc, fill=0)
        draw.text((cx2 - draw.textlength(g2, font=f_bc) / 2, txt_y), g2, font=f_bc, fill=0)
    else:
        tw = draw.textlength(bc_val, font=f_bc)
        draw.text(((W - tw) / 2, txt_y), bc_val, font=f_bc, fill=0)

    return img, w_mm, h_mm


def build_tspl_for_label(
    img,
    w_mm: int,
    h_mm: int,
    copies: int = 1,
    gap_mm: int = 2,
    density: int = 10,
    direction: int = 1,
) -> bytes:
    """Формирует бинарный TSPL-пакет с растром 1-bit для Xprinter XP-365B."""
    mono = img.convert("1")
    w_px, h_px = mono.size
    width_bytes = w_px // 8
    raw_bitmap = mono.tobytes()
    dir_val = 0 if int(direction) == 0 else 1
    header = (
        f"SIZE {w_mm} mm,{h_mm} mm\r\n"
        f"GAP {gap_mm} mm,0 mm\r\n"
        f"DIRECTION {dir_val},0\r\n"
        f"REFERENCE 0,0\r\n"
        f"OFFSET 0 mm\r\n"
        f"DENSITY {max(1, min(15, int(density)))}\r\n"
        f"SPEED 4\r\n"
        f"CLS\r\n"
        f"BITMAP 0,0,{width_bytes},{h_px},0,"
    ).encode("ascii")
    footer = f"\r\nPRINT {max(1, min(200, int(copies)))},1\r\n".encode("ascii")
    return header + raw_bitmap + footer


# --------------------- Windows Spooler RAW API (ctypes) ---------------------
if sys.platform == "win32" and wintypes is not None:
    class _DOC_INFO_1W(ctypes.Structure):
        _fields_ = [
            ("pDocName", wintypes.LPWSTR),
            ("pOutputFile", wintypes.LPWSTR),
            ("pDatatype", wintypes.LPWSTR),
        ]

    class _PRINTER_INFO_4W(ctypes.Structure):
        _fields_ = [
            ("pPrinterName", wintypes.LPWSTR),
            ("pServerName", wintypes.LPWSTR),
            ("Attributes", wintypes.DWORD),
        ]


def list_windows_printers() -> dict[str, Any]:
    if sys.platform != "win32":
        return {"available": False, "printers": [], "default_printer": ""}
    try:
        winspool = ctypes.WinDLL("winspool.drv", use_last_error=True)
        PRINTER_ENUM_LOCAL = 0x00000002
        PRINTER_ENUM_CONNECTIONS = 0x00000004
        flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS
        needed = wintypes.DWORD(0)
        returned = wintypes.DWORD(0)
        winspool.EnumPrintersW(flags, None, 4, None, 0, ctypes.byref(needed), ctypes.byref(returned))
        if needed.value == 0:
            return {"available": True, "printers": [], "default_printer": ""}
        buf = (ctypes.c_byte * needed.value)()
        ok = winspool.EnumPrintersW(flags, None, 4, buf, needed.value, ctypes.byref(needed), ctypes.byref(returned))
        if not ok:
            return {"available": True, "printers": [], "default_printer": ""}
        arr = ctypes.cast(buf, ctypes.POINTER(_PRINTER_INFO_4W))
        names = [arr[i].pPrinterName for i in range(returned.value) if arr[i].pPrinterName]
        # Автовыбор Xprinter / термопринтера
        preferred = ""
        for kw in ("xp-365", "xprinter", "4barcode", "xp-", "tsc", "thermal", "label", "pos"):
            hit = next((n for n in names if kw in n.lower()), "")
            if hit:
                preferred = hit
                break
        return {"available": True, "printers": names, "default_printer": preferred or (names[0] if names else "")}
    except Exception:
        return {"available": False, "printers": [], "default_printer": ""}


def send_raw_to_printer(printer_name: str, raw_bytes: bytes, doc_name: str = "Vishenka Label") -> int:
    if sys.platform != "win32":
        raise RuntimeError("Прямая печать доступна только при локальном запуске на Windows")
    winspool = ctypes.WinDLL("winspool.drv", use_last_error=True)
    winspool.OpenPrinterW.argtypes = [wintypes.LPWSTR, ctypes.POINTER(wintypes.HANDLE), ctypes.c_void_p]
    winspool.OpenPrinterW.restype = wintypes.BOOL
    winspool.StartDocPrinterW.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(_DOC_INFO_1W)]
    winspool.StartDocPrinterW.restype = wintypes.DWORD
    winspool.StartPagePrinter.argtypes = [wintypes.HANDLE]
    winspool.StartPagePrinter.restype = wintypes.BOOL
    winspool.WritePrinter.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD)]
    winspool.WritePrinter.restype = wintypes.BOOL
    winspool.EndPagePrinter.argtypes = [wintypes.HANDLE]
    winspool.EndDocPrinter.argtypes = [wintypes.HANDLE]
    winspool.ClosePrinter.argtypes = [wintypes.HANDLE]

    h_printer = wintypes.HANDLE()
    if not winspool.OpenPrinterW(printer_name, ctypes.byref(h_printer), None):
        raise RuntimeError(f"Не удалось открыть принтер «{printer_name}» (код {ctypes.get_last_error()})")
    try:
        doc = _DOC_INFO_1W(pDocName=doc_name, pOutputFile=None, pDatatype="RAW")
        if not winspool.StartDocPrinterW(h_printer, 1, ctypes.byref(doc)):
            raise RuntimeError(f"Ошибка StartDocPrinter (код {ctypes.get_last_error()})")
        try:
            winspool.StartPagePrinter(h_printer)
            written = wintypes.DWORD(0)
            ok = winspool.WritePrinter(h_printer, raw_bytes, len(raw_bytes), ctypes.byref(written))
            winspool.EndPagePrinter(h_printer)
            if not ok:
                raise RuntimeError(f"Ошибка записи на принтер (код {ctypes.get_last_error()})")
            return int(written.value)
        finally:
            winspool.EndDocPrinter(h_printer)
    finally:
        winspool.ClosePrinter(h_printer)


def calibrate_printer_gap(printer_name: str, size: str = "58x40") -> int:
    """Отправляет команду автокалибровки датчика зазора ленты (GAPDETECT) на Xprinter XP-365B."""
    w_mm, h_mm = LABEL_SIZES_MM.get(size, (58, 40))
    cmd = f"SIZE {w_mm} mm,{h_mm} mm\r\nGAP 2 mm,0 mm\r\nGAPDETECT\r\n".encode("ascii")
    return send_raw_to_printer(printer_name, cmd, doc_name="Vishenka Calibrate")
