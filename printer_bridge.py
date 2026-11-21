"""Локальный мост прямой TSPL-печати для Vishenka Store (работает с Render, Vercel и localhost).

Слушает только 127.0.0.1:18181 и отдаёт CORS + Private Network Access заголовки,
чтобы даже сайт на Render (https://...onrender.com) мог печатать напрямую в Xprinter XP-365B
ровно 58x40 мм, без окна печати браузера, без поворота и без «about:blank».
"""
from __future__ import annotations

import importlib
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import tspl_printer

BRIDGE_HOST = "127.0.0.1"
BRIDGE_PORT = 18181


class _BridgeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        return

    def _send_cors_headers(self) -> None:
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "86400")

    def _send_json(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 5 * 1024 * 1024:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/status", "/printers", "/api/printers", "/api/local-printer/status"):
            info = tspl_printer.list_windows_printers()
            info["bridge"] = "vishenka-tspl"
            info["port"] = BRIDGE_PORT
            self._send_json(200, info)
            return
        self._send_json(404, {"detail": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        try:
            data = self._read_json()
        except Exception:
            self._send_json(400, {"detail": "Неверный JSON"})
            return

        if path in ("/print/labels", "/api/print/labels", "/api/local-printer/labels"):
            tp = importlib.reload(tspl_printer)
            info = tp.list_windows_printers()
            if not info.get("available"):
                self._send_json(400, {"detail": "Прямая печать доступна только на Windows"})
                return
            pname = str(data.get("printer_name") or "").strip() or info.get("default_printer") or ""
            if not pname:
                self._send_json(400, {"detail": "Принтер Xprinter не найден в Windows"})
                return

            items = data.get("items") or []
            valid = [it for it in items if int(it.get("copies") or 0) > 0]
            if not valid:
                self._send_json(400, {"detail": "Нет этикеток для печати"})
                return

            size = str(data.get("size") or "58x40")
            store_name = str(data.get("store_name") or "Vishenka Store")
            show_store = bool(data.get("show_store", True))
            show_price = bool(data.get("show_price", True))
            show_code = bool(data.get("show_code", True))
            gap_mm = max(1, min(6, int(data.get("gap_mm") or 2)))
            density = max(1, min(15, int(data.get("density") or 10)))
            direction = 0 if int(data.get("direction", 1)) == 0 else 1

            chunks: list[bytes] = []
            total_copies = 0
            try:
                for it in valid:
                    copies = max(1, min(200, int(it.get("copies") or 1)))
                    img, w_mm, h_mm = tp.render_label_image(
                        name=str(it.get("name") or "Товар"),
                        price=it.get("price", 0),
                        barcode=str(it.get("barcode") or ""),
                        code=str(it.get("code") or ""),
                        store_name=store_name,
                        size=size,
                        show_store=show_store,
                        show_price=show_price,
                        show_code=show_code,
                    )
                    chunks.append(
                        tp.build_tspl_for_label(
                            img,
                            w_mm,
                            h_mm,
                            copies=copies,
                            gap_mm=gap_mm,
                            density=density,
                            direction=direction,
                        )
                    )
                    total_copies += copies
                written = tp.send_raw_to_printer(pname, b"".join(chunks), doc_name="Vishenka Store Labels")
            except Exception as exc:
                self._send_json(500, {"detail": f"Ошибка печати на {pname}: {exc}"})
                return

            self._send_json(200, {"ok": True, "printer": pname, "labels_printed": total_copies, "bytes": written})
            return

        if path in ("/print/calibrate", "/api/print/calibrate", "/api/local-printer/calibrate"):
            tp = importlib.reload(tspl_printer)
            info = tp.list_windows_printers()
            pname = str(data.get("printer_name") or "").strip() or info.get("default_printer") or ""
            if not pname:
                self._send_json(400, {"detail": "Принтер Xprinter не найден"})
                return
            try:
                tp.calibrate_printer_gap(pname, size=str(data.get("size") or "58x40"))
            except Exception as exc:
                self._send_json(500, {"detail": f"Ошибка калибровки {pname}: {exc}"})
                return
            self._send_json(200, {"ok": True, "printer": pname})
            return

        self._send_json(404, {"detail": "Not found"})


def main() -> int:
    server = ThreadingHTTPServer((BRIDGE_HOST, BRIDGE_PORT), _BridgeHandler)
    print(f"Vishenka Xprinter Bridge listening on http://{BRIDGE_HOST}:{BRIDGE_PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
