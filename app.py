"""Vishenka Store — API на FastAPI + PostgreSQL (POS-касса, штрихкоды, витрина)."""
import base64
import json
import secrets
import time
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from fastapi import FastAPI, Request, HTTPException, Depends
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from config import UPLOAD_DIR, DIST_DIR, MAX_PHOTOS, MAX_PHOTO_BYTES, SEED_FILE
from db import get_conn, init_db, make_ean13, backfill_barcodes

app = FastAPI(title="Vishenka Store API")

_initialized = False


def ensure_initialized():
    global _initialized
    if not _initialized:
        try:
            init_db()
            _initialized = True
        except Exception as exc:
            print("init_db deferred:", exc)


@app.on_event("startup")
def startup():
    ensure_initialized()


SESSIONS: dict[str, float] = {}
SESSION_TTL = 60 * 60 * 12

DEFAULT_STORE_SETTINGS = {
    "store_name": "Vishenka Store",
    "store_phone": "",
    "store_address": "",
    "qr_bank_name": "MBank / O!Деньги / Элсом",
    "qr_account": "",
    "label_size": "58x40",
    "receipt_width": "58mm",
    "auto_print_receipt": False,
    "sound_enabled": True,
}

# Раскладка RU -> EN на случай если сканер отсканировал латинский код в русской раскладке
_RU_TO_EN = str.maketrans(
    "йцукенгшщзхъфывапролджэячсмитьбюЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧСМИТЬБЮ",
    "qwertyuiop[]asdfghjkl;'zxcvbnm,.QWERTYUIOP{}ASDFGHJKL:\"ZXCVBNM<>",
)


def normalize_barcode(raw: str) -> str:
    return (raw or "").strip().translate(_RU_TO_EN)


# ---------------------------------------------------------------- модели
class LoginIn(BaseModel):
    password: str


class ProductIn(BaseModel):
    name: str
    code: str = ""
    barcode: str = ""
    category: str = "Прочие"
    purchase_price: float = 0
    sale_price: float = 0
    quantity: int = 0
    status: str = "draft"


class SaleIn(BaseModel):
    product_id: int
    quantity: int
    date: str | None = None
    payment_method: str = "cash"
    discount: float = 0
    note: str = ""


class CheckoutItemIn(BaseModel):
    product_id: int
    quantity: int
    unit_price: float | None = None
    discount: float = 0


class CheckoutIn(BaseModel):
    items: list[CheckoutItemIn]
    payment_method: str = "cash"  # cash | qr | card | mixed
    discount_type: str = "none"   # none | percent | amount
    discount_value: float = 0
    cash_received: float = 0
    cash_part: float = 0
    card_part: float = 0
    note: str = ""
    date: str | None = None


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


class StatusIn(BaseModel):
    status: str


class StoreSettingsIn(BaseModel):
    store_name: str = "Vishenka Store"
    store_phone: str = ""
    store_address: str = ""
    qr_bank_name: str = "MBank / O!Деньги / Элсом"
    qr_account: str = ""
    label_size: str = "58x40"
    receipt_width: str = "58mm"
    auto_print_receipt: bool = False
    sound_enabled: bool = True


# ---------------------------------------------------------------- helpers
def require_auth(request: Request):
    ensure_initialized()
    header = request.headers.get("Authorization", "")
    token = header[7:] if header.startswith("Bearer ") else ""
    expires = SESSIONS.get(token)
    if not expires or expires < time.time():
        raise HTTPException(401, "Требуется вход")
    return token


def get_setting(cur, key, default=""):
    cur.execute("SELECT value FROM settings WHERE key = %s", (key,))
    row = cur.fetchone()
    return row["value"] if row else default


def read_store_settings(cur) -> dict:
    raw = get_setting(cur, "store_settings", "")
    result = dict(DEFAULT_STORE_SETTINGS)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                result.update(parsed)
        except Exception:
            pass
    return result


def photos_for(cur, product_id):
    cur.execute("SELECT id FROM photos WHERE product_id = %s ORDER BY position, id", (product_id,))
    return [{"id": p["id"], "url": "/uploads/" + str(p["id"])} for p in cur.fetchall()]


def product_out(row, photos=None):
    buy = float(row["purchase_price"] or 0)
    sell = float(row["sale_price"] or 0)
    qty = int(row["quantity"] or 0)
    keys = row.keys()
    return {
        "id": row["id"],
        "name": row["name"],
        "code": row["code"] if "code" in keys else "",
        "barcode": row["barcode"] if "barcode" in keys else "",
        "category": row["category"],
        "purchase_price": buy,
        "sale_price": sell,
        "quantity": qty,
        "markup": round((sell / buy - 1) * 100, 1) if buy > 0 else 0,
        "purchase_total": round(buy * qty, 2),
        "sale_total": round(sell * qty, 2),
        "status": row["status"],
        "created_at": str(row["created_at"]),
        "photos": photos if photos is not None else [],
    }


def sale_out(s):
    q = int(s["quantity"] or 0)
    price = float(s["unit_price"] or 0)
    cost = float(s["unit_cost"] or 0)
    disc = float(s.get("discount") or 0)
    line_rev = max(0.0, round(q * price - disc, 2))
    line_cost = round(q * cost, 2)
    return {
        "id": s["id"],
        "product_id": s["product_id"],
        "product_name": s["product_name"],
        "quantity": q,
        "unit_price": price,
        "unit_cost": cost,
        "discount": disc,
        "line_total": line_rev,
        "profit": round(line_rev - line_cost, 2),
        "sale_date": str(s["sale_date"]),
        "receipt_no": s.get("receipt_no") or "",
        "payment_method": s.get("payment_method") or "cash",
        "cash_received": float(s.get("cash_received") or 0),
        "change_amount": float(s.get("change_amount") or 0),
        "cash_part": float(s.get("cash_part") or 0),
        "card_part": float(s.get("card_part") or 0),
        "note": s.get("note") or "",
        "created_at": str(s["created_at"]),
    }


def build_reports(sales):
    months = {}
    for s in sales:
        d = s["sale_date"]
        key = d.strftime("%Y-%m") if hasattr(d, "strftime") else str(d)[:7]
        r = months.setdefault(key, {
            "month": key, "sold_pieces": 0, "revenue": 0.0,
            "cost": 0.0, "profit": 0.0, "discount": 0.0,
            "deals": 0, "_receipts": set(), "by": {},
        })
        q = int(s["quantity"] or 0)
        price = float(s["unit_price"] or 0)
        cost = float(s["unit_cost"] or 0)
        disc = float(s.get("discount") or 0)
        line_rev = max(0.0, q * price - disc)
        r["sold_pieces"] += q
        r["revenue"] += line_rev
        r["cost"] += q * cost
        r["profit"] += line_rev - q * cost
        r["discount"] += disc
        rno = s.get("receipt_no") or f"single-{s['id']}"
        r["_receipts"].add(rno)
        r["by"][s["product_name"]] = r["by"].get(s["product_name"], 0) + q

    result = []
    for r in sorted(months.values(), key=lambda x: x["month"], reverse=True):
        best = sorted(r.pop("by").items(), key=lambda x: x[1], reverse=True)
        r["deals"] = len(r.pop("_receipts"))
        r["revenue"] = round(r["revenue"], 2)
        r["cost"] = round(r["cost"], 2)
        r["profit"] = round(r["profit"], 2)
        r["discount"] = round(r["discount"], 2)
        r["best_seller"] = best[0][0] if best else None
        r["best_seller_qty"] = best[0][1] if best else 0
        result.append(r)
    return result


def next_receipt_no(cur, sale_date: str) -> str:
    ymd = sale_date.replace("-", "")
    prefix = f"VS-{ymd}-"
    cur.execute(
        "SELECT COUNT(DISTINCT receipt_no) AS n FROM sales WHERE receipt_no LIKE %s",
        (prefix + "%",),
    )
    seq = int(cur.fetchone()["n"] or 0) + 1
    candidate = f"{prefix}{seq:04d}"
    while True:
        cur.execute("SELECT 1 FROM sales WHERE receipt_no = %s LIMIT 1", (candidate,))
        if not cur.fetchone():
            return candidate
        seq += 1
        candidate = f"{prefix}{seq:04d}"


# ---------------------------------------------------------------- PUBLIC
def seed_catalog():
    """Данные из seed_products.json — запасной режим, если база недоступна."""
    seed = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    return [{
        "id": i + 1,
        "name": p["name"],
        "code": "",
        "barcode": make_ean13(i + 1),
        "category": p["category"],
        "purchase_price": p["purchase_price"],
        "sale_price": p["sale_price"],
        "quantity": p["quantity"],
        "markup": round((p["sale_price"] / p["purchase_price"] - 1) * 100, 1) if p["purchase_price"] else 0,
        "purchase_total": p["purchase_price"] * p["quantity"],
        "sale_total": p["sale_price"] * p["quantity"],
        "status": "published",
        "created_at": "",
        "photos": [],
    } for i, p in enumerate(seed.get("products", []))]


@app.get("/api/catalog")
def catalog():
    ensure_initialized()
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                backfill_barcodes(cur)
                cur.execute("SELECT * FROM products WHERE status = 'published' ORDER BY id DESC")
                rows = cur.fetchall()
                return {"products": [product_out(r, photos_for(cur, r["id"])) for r in rows]}
    except Exception as exc:
        print("catalog fallback:", exc)
        return {"products": seed_catalog()}


@app.get("/api/meta")
def meta():
    ensure_initialized()
    store_name = "Vishenka Store"
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                categories = json.loads(get_setting(cur, "categories", "[]"))
                st = read_store_settings(cur)
                store_name = st.get("store_name") or store_name
    except Exception:
        seed = json.loads(SEED_FILE.read_text(encoding="utf-8"))
        categories = seed.get("categories", [])
    return {"categories": categories, "currency": "сом", "store_name": store_name, "api_version": 2}


@app.post("/api/login")
def login(data: LoginIn):
    ensure_initialized()
    with get_conn() as conn:
        with conn.cursor() as cur:
            password = get_setting(cur, "password", "ademi2025")
    if data.password != password:
        raise HTTPException(401, "Неверный пароль")
    token = secrets.token_hex(24)
    SESSIONS[token] = time.time() + SESSION_TTL
    return {"token": token}


# ---------------------------------------------------------------- PRODUCTS (auth)
@app.get("/api/products")
def products(request: Request, q: str = "", category: str = "", _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            backfill_barcodes(cur)
            where, args = [], []
            if q:
                where.append("(name ILIKE %s OR code ILIKE %s OR barcode ILIKE %s OR category ILIKE %s)")
                args += [f"%{q}%"] * 4
            if category:
                where.append("category = %s")
                args.append(category)
            sql = "SELECT * FROM products"
            if where:
                sql += " WHERE " + " AND ".join(where)
            sql += " ORDER BY id DESC"
            cur.execute(sql, args)
            return {"products": [product_out(r, photos_for(cur, r["id"])) for r in cur.fetchall()]}


@app.get("/api/products/lookup")
def lookup_product(code: str, request: Request, _=Depends(require_auth)):
    """Мгновенный поиск товара по отсканированному штрихкоду или артикулу."""
    raw = (code or "").strip()
    norm = normalize_barcode(raw)
    if not raw:
        raise HTTPException(400, "Пустой штрихкод")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT * FROM products
                   WHERE LOWER(barcode) = LOWER(%s)
                      OR LOWER(barcode) = LOWER(%s)
                      OR LOWER(code) = LOWER(%s)
                      OR LOWER(code) = LOWER(%s)
                   ORDER BY CASE WHEN LOWER(barcode) = LOWER(%s) THEN 0 ELSE 1 END, id DESC
                   LIMIT 1""",
                (raw, norm, raw, norm, norm),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, f"Товар со штрихкодом «{norm or raw}» не найден")
            return {"product": product_out(row, photos_for(cur, row["id"]))}


@app.post("/api/products/generate-barcodes")
def generate_missing_barcodes(request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            updated = backfill_barcodes(cur)
    return {"updated": updated}


@app.post("/api/products")
def create_product(data: ProductIn, request: Request, _=Depends(require_auth)):
    if not data.name.strip():
        raise HTTPException(400, "Введите название")
    barcode = normalize_barcode(data.barcode)
    with get_conn() as conn:
        with conn.cursor() as cur:
            if barcode:
                cur.execute("SELECT name FROM products WHERE LOWER(barcode) = LOWER(%s)", (barcode,))
                dup = cur.fetchone()
                if dup:
                    raise HTTPException(400, f"Штрихкод {barcode} уже закреплён за «{dup['name']}»")
            cur.execute(
                """INSERT INTO products(name, code, barcode, category, purchase_price, sale_price, quantity, status)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *""",
                (data.name.strip(), data.code.strip(), barcode, data.category.strip() or "Прочие",
                 data.purchase_price, data.sale_price, data.quantity, data.status),
            )
            row = cur.fetchone()
            if not barcode:
                auto_bc = make_ean13(row["id"])
                cur.execute("UPDATE products SET barcode = %s WHERE id = %s RETURNING *", (auto_bc, row["id"]))
                row = cur.fetchone()
            return {"product": product_out(row, [])}


@app.put("/api/products/{pid}")
def update_product(pid: int, data: ProductIn, request: Request, _=Depends(require_auth)):
    barcode = normalize_barcode(data.barcode)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id, barcode FROM products WHERE id = %s", (pid,))
            existing = cur.fetchone()
            if not existing:
                raise HTTPException(404, "Товар не найден")
            if not barcode:
                barcode = existing["barcode"] or make_ean13(pid)
            else:
                cur.execute(
                    "SELECT name FROM products WHERE LOWER(barcode) = LOWER(%s) AND id <> %s",
                    (barcode, pid),
                )
                dup = cur.fetchone()
                if dup:
                    raise HTTPException(400, f"Штрихкод {barcode} уже закреплён за «{dup['name']}»")
            cur.execute(
                """UPDATE products SET name=%s, code=%s, barcode=%s, category=%s, purchase_price=%s,
                   sale_price=%s, quantity=%s, status=%s WHERE id=%s RETURNING *""",
                (data.name.strip(), data.code.strip(), barcode, data.category.strip() or "Прочие",
                 data.purchase_price, data.sale_price, data.quantity, data.status, pid),
            )
            return {"product": product_out(cur.fetchone(), photos_for(cur, pid))}


@app.post("/api/products/{pid}/status")
def set_status(pid: int, data: StatusIn, request: Request, _=Depends(require_auth)):
    if data.status not in ("draft", "review", "published"):
        raise HTTPException(400, "Неизвестный статус")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE products SET status=%s WHERE id=%s RETURNING *", (data.status, pid))
            row = cur.fetchone()
            if not row:
                raise HTTPException(404, "Товар не найден")
            return {"product": product_out(row, photos_for(cur, pid))}


@app.delete("/api/products/{pid}")
def delete_product(pid: int, request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM products WHERE id = %s", (pid,))
    return {"ok": True}


# ---------------------------------------------------------------- PHOTOS
@app.post("/api/products/{pid}/photos")
async def upload_photo(pid: int, request: Request, name: str = "photo.jpg", _=Depends(require_auth)):
    data = await request.body()
    if not data:
        raise HTTPException(400, "Пустой файл")
    if len(data) > MAX_PHOTO_BYTES:
        raise HTTPException(400, "Файл больше 10 МБ")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM products WHERE id = %s", (pid,))
            if not cur.fetchone():
                raise HTTPException(404, "Товар не найден")
            cur.execute("SELECT COUNT(*) AS n FROM photos WHERE product_id = %s", (pid,))
            if cur.fetchone()["n"] >= MAX_PHOTOS:
                raise HTTPException(400, f"Максимум {MAX_PHOTOS} фото на товар")

            ext = Path(name).suffix.lower()
            if ext not in (".jpg", ".jpeg", ".png", ".webp", ".gif"):
                ext = ".jpg"
            filename = f"{uuid.uuid4().hex}{ext}"
            types = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
                     ".webp": "image/webp", ".gif": "image/gif"}
            content_type = types.get(ext, "image/jpeg")
            cur.execute(
                "INSERT INTO photos(product_id, filename, content_type, data, position) "
                "VALUES (%s,%s,%s,%s,(SELECT COALESCE(MAX(position),0)+1 FROM photos WHERE product_id=%s)) "
                "RETURNING id",
                (pid, filename, content_type, data, pid),
            )
            photo_id = cur.fetchone()["id"]
            return {"id": photo_id, "url": "/uploads/" + str(photo_id)}


@app.delete("/api/products/{pid}/photos/{photo_id}")
def delete_photo(pid: int, photo_id: int, request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM photos WHERE id=%s AND product_id=%s", (photo_id, pid))
            if not cur.fetchone():
                raise HTTPException(404, "Фото не найдено")
            cur.execute("DELETE FROM photos WHERE id=%s", (photo_id,))
    return {"ok": True}


# ---------------------------------------------------------------- SALES & POS CHECKOUT
@app.get("/api/sales")
def sales(request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM sales ORDER BY sale_date DESC, id DESC")
            return {"sales": [sale_out(s) for s in cur.fetchall()]}


@app.post("/api/sales")
def create_sale(data: SaleIn, request: Request, _=Depends(require_auth)):
    if data.payment_method not in ("cash", "qr", "card", "mixed"):
        raise HTTPException(400, "Неизвестный способ оплаты")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products WHERE id = %s FOR UPDATE", (data.product_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(404, "Товар не найден")
            q = int(data.quantity)
            if q <= 0:
                raise HTTPException(400, "Укажите количество больше нуля")
            if q > int(p["quantity"] or 0):
                raise HTTPException(400, f"Недостаточно товара (доступно {p['quantity']} шт)")
            sale_date = data.date if data.date and len(data.date) == 10 else time.strftime("%Y-%m-%d")
            rno = next_receipt_no(cur, sale_date)
            disc = max(0.0, min(float(data.discount or 0), q * float(p["sale_price"] or 0)))
            cur.execute(
                """INSERT INTO sales(
                       product_id, product_name, quantity, unit_price, unit_cost, sale_date,
                       receipt_no, payment_method, discount, note
                   ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                (p["id"], p["name"], q, p["sale_price"], p["purchase_price"], sale_date,
                 rno, data.payment_method, disc, data.note.strip()),
            )
            sid = cur.fetchone()["id"]
            cur.execute("UPDATE products SET quantity = quantity - %s WHERE id = %s", (q, p["id"]))
    return {"id": sid, "receipt_no": rno}


@app.post("/api/checkout")
def checkout(data: CheckoutIn, request: Request, _=Depends(require_auth)):
    """Оформление чека на кассе (POS): 1 или несколько товаров со сканера + оплата."""
    if not data.items:
        raise HTTPException(400, "Чек пуст — отсканируйте или выберите товар")
    if data.payment_method not in ("cash", "qr", "card", "mixed"):
        raise HTTPException(400, "Неизвестный способ оплаты")

    # Группируем одинаковые product_id на случай дублей (сохраняем индивидуальную скидку по товару)
    merged: dict[int, dict] = {}
    for item in data.items:
        q = int(item.quantity or 0)
        if q <= 0:
            raise HTTPException(400, "Количество товара должно быть больше нуля")
        item_disc_in = max(0.0, float(item.discount or 0))
        if item.product_id in merged:
            merged[item.product_id]["quantity"] += q
            merged[item.product_id]["discount"] = round(merged[item.product_id]["discount"] + item_disc_in, 2)
        else:
            merged[item.product_id] = {
                "product_id": item.product_id,
                "quantity": q,
                "unit_price": item.unit_price,
                "discount": round(item_disc_in, 2),
            }

    sale_date = data.date if data.date and len(data.date) == 10 else time.strftime("%Y-%m-%d")

    with get_conn() as conn:
        with conn.cursor() as cur:
            resolved = []
            subtotal = 0.0
            item_discounts_sum = 0.0
            for entry in merged.values():
                cur.execute("SELECT * FROM products WHERE id = %s FOR UPDATE", (entry["product_id"],))
                p = cur.fetchone()
                if not p:
                    raise HTTPException(404, f"Товар #{entry['product_id']} не найден")
                avail = int(p["quantity"] or 0)
                if entry["quantity"] > avail:
                    raise HTTPException(
                        400,
                        f"Недостаточно «{p['name']}» на складе (доступно {avail} шт, в чеке {entry['quantity']} шт)",
                    )
                unit_price = float(entry["unit_price"]) if entry["unit_price"] is not None else float(p["sale_price"] or 0)
                unit_cost = float(p["purchase_price"] or 0)
                line_gross = round(unit_price * entry["quantity"], 2)
                own_disc = round(max(0.0, min(line_gross, float(entry["discount"] or 0))), 2)
                line_after_own = round(max(0.0, line_gross - own_disc), 2)
                subtotal += line_gross
                item_discounts_sum += own_disc
                resolved.append({
                    "product": p,
                    "quantity": entry["quantity"],
                    "unit_price": unit_price,
                    "unit_cost": unit_cost,
                    "line_gross": line_gross,
                    "own_discount": own_disc,
                    "line_after_own": line_after_own,
                })

            subtotal = round(subtotal, 2)
            item_discounts_sum = round(item_discounts_sum, 2)
            after_item_discounts = round(max(0.0, subtotal - item_discounts_sum), 2)

            extra_discount = 0.0
            if data.discount_type == "percent":
                pct = max(0.0, min(100.0, float(data.discount_value or 0)))
                extra_discount = round(after_item_discounts * pct / 100.0, 2)
            elif data.discount_type == "amount":
                extra_discount = round(max(0.0, min(after_item_discounts, float(data.discount_value or 0))), 2)

            discount_total = round(min(subtotal, item_discounts_sum + extra_discount), 2)
            final_total = max(0.0, round(subtotal - discount_total, 2))

            cash_received = 0.0
            change_amount = 0.0
            cash_part = 0.0
            card_part = 0.0
            if data.payment_method == "cash":
                cash_received = float(data.cash_received or 0)
                if cash_received <= 0:
                    cash_received = final_total
                elif cash_received + 0.01 < final_total:
                    raise HTTPException(400, f"Получено меньше суммы чека ({final_total:.0f} сом)")
                change_amount = round(max(0.0, cash_received - final_total), 2)
                cash_part = final_total
            elif data.payment_method == "mixed":
                cash_part = round(max(0.0, float(data.cash_part or 0)), 2)
                card_part = round(max(0.0, float(data.card_part or 0)), 2)
                if abs((cash_part + card_part) - final_total) > 1.0:
                    card_part = round(max(0.0, final_total - cash_part), 2)
                cash_received = cash_part
            else:
                card_part = final_total

            receipt_no = next_receipt_no(cur, sale_date)
            remaining_extra = extra_discount
            receipt_items = []
            sale_ids = []

            for idx, r in enumerate(resolved):
                if extra_discount > 0 and after_item_discounts > 0:
                    if idx == len(resolved) - 1:
                        share_extra = round(max(0.0, remaining_extra), 2)
                    else:
                        share_extra = round(extra_discount * (r["line_after_own"] / after_item_discounts), 2)
                        remaining_extra = round(remaining_extra - share_extra, 2)
                else:
                    share_extra = 0.0
                item_disc = round(min(r["line_gross"], r["own_discount"] + share_extra), 2)

                p = r["product"]
                cur.execute(
                    """INSERT INTO sales(
                           product_id, product_name, quantity, unit_price, unit_cost, sale_date,
                           receipt_no, payment_method, discount, cash_received, change_amount,
                           cash_part, card_part, note
                       ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        p["id"], p["name"], r["quantity"], r["unit_price"], r["unit_cost"], sale_date,
                        receipt_no, data.payment_method, item_disc,
                        cash_received if idx == 0 else 0,
                        change_amount if idx == 0 else 0,
                        cash_part if idx == 0 else 0,
                        card_part if idx == 0 else 0,
                        data.note.strip(),
                    ),
                )
                sale_ids.append(cur.fetchone()["id"])
                cur.execute("UPDATE products SET quantity = quantity - %s WHERE id = %s", (r["quantity"], p["id"]))
                receipt_items.append({
                    "product_id": p["id"],
                    "name": p["name"],
                    "code": p["code"] or "",
                    "barcode": p["barcode"] or "",
                    "quantity": r["quantity"],
                    "unit_price": r["unit_price"],
                    "discount": item_disc,
                    "line_total": round(max(0.0, r["line_gross"] - item_disc), 2),
                })

    return {
        "receipt": {
            "receipt_no": receipt_no,
            "sale_date": sale_date,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "items": receipt_items,
            "subtotal": subtotal,
            "discount": discount_total,
            "total": final_total,
            "payment_method": data.payment_method,
            "cash_received": cash_received,
            "change_amount": change_amount,
            "cash_part": cash_part,
            "card_part": card_part,
            "note": data.note.strip(),
            "sale_ids": sale_ids,
        }
    }


@app.delete("/api/sales/{sid}")
def delete_sale(sid: int, request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM sales WHERE id = %s", (sid,))
            s = cur.fetchone()
            if not s:
                raise HTTPException(404, "Продажа не найдена")
            if s["product_id"]:
                cur.execute("UPDATE products SET quantity = quantity + %s WHERE id = %s",
                            (s["quantity"], s["product_id"]))
            cur.execute("DELETE FROM sales WHERE id = %s", (sid,))
    return {"ok": True}


@app.delete("/api/receipts/{receipt_no}")
def delete_receipt(receipt_no: str, request: Request, _=Depends(require_auth)):
    """Отмена целого чека с возвратом всех товаров на склад."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM sales WHERE receipt_no = %s", (receipt_no,))
            rows = cur.fetchall()
            if not rows:
                raise HTTPException(404, "Чек не найден")
            for s in rows:
                if s["product_id"]:
                    cur.execute("UPDATE products SET quantity = quantity + %s WHERE id = %s",
                                (s["quantity"], s["product_id"]))
            cur.execute("DELETE FROM sales WHERE receipt_no = %s", (receipt_no,))
    return {"ok": True, "returned_items": len(rows)}


# ---------------------------------------------------------------- SETTINGS
@app.get("/api/store-settings")
def get_store_settings(request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            return {"settings": read_store_settings(cur)}


@app.post("/api/store-settings")
def save_store_settings(data: StoreSettingsIn, request: Request, _=Depends(require_auth)):
    payload = data.model_dump()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO settings(key, value) VALUES ('store_settings', %s) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (json.dumps(payload, ensure_ascii=False),),
            )
    return {"settings": payload}


# ---------------------------------------------------------------- ANALYTICS
@app.get("/api/reports")
def reports(request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM sales")
            return {"reports": build_reports(cur.fetchall())}


@app.get("/api/dashboard")
def dashboard(request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products")
            products = cur.fetchall()
            cur.execute("SELECT * FROM sales")
            sales = cur.fetchall()

    stock = sum(int(p["quantity"] or 0) for p in products)
    stock_cost = sum(int(p["quantity"] or 0) * float(p["purchase_price"] or 0) for p in products)
    stock_sale = sum(int(p["quantity"] or 0) * float(p["sale_price"] or 0) for p in products)
    reports_data = build_reports(sales)
    now_month = time.strftime("%Y-%m")
    current = next((r for r in reports_data if r["month"] == now_month),
                   {"month": now_month, "sold_pieces": 0, "revenue": 0, "cost": 0,
                    "profit": 0, "deals": 0})
    low = sorted([p for p in products if int(p["quantity"] or 0) <= 3],
                 key=lambda x: int(x["quantity"] or 0))[:6]
    recent = sorted(sales, key=lambda s: (str(s["sale_date"]), s["id"]), reverse=True)[:8]
    return {
        "total_products": len(products),
        "published": sum(1 for p in products if p["status"] == "published"),
        "drafts": sum(1 for p in products if p["status"] != "published"),
        "stock": stock,
        "stock_cost": round(stock_cost, 2),
        "stock_sale": round(stock_sale, 2),
        "current": current,
        "low_stock": [{"id": p["id"], "name": p["name"], "quantity": p["quantity"]} for p in low],
        "recent_sales": [sale_out(s) for s in recent],
        "months": reports_data[:8],
    }


# ---------------------------------------------------------------- DATA
@app.get("/api/backup")
def backup(request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM products")
            products = [dict(p) | {"created_at": str(p["created_at"])} for p in cur.fetchall()]
            cur.execute("SELECT * FROM sales")
            sales = [dict(s) | {"sale_date": str(s["sale_date"]),
                                "created_at": str(s["created_at"])} for s in cur.fetchall()]
            cur.execute("SELECT key, value FROM settings")
            settings = {s["key"]: s["value"] for s in cur.fetchall()}
            cur.execute("SELECT id, product_id, filename, content_type, position, data FROM photos")
            photos = [{
                "id": p["id"], "product_id": p["product_id"], "filename": p["filename"],
                "content_type": p["content_type"], "position": p["position"],
                "data": base64.b64encode(bytes(p["data"])).decode("ascii") if p["data"] else "",
            } for p in cur.fetchall()]
    return {"products": products, "sales": sales, "settings": settings, "photos": photos}


@app.post("/api/restore")
async def restore(request: Request, _=Depends(require_auth)):
    data = await request.json()
    if not isinstance(data.get("products"), list) or not isinstance(data.get("sales"), list):
        raise HTTPException(400, "Неверный формат файла")
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM photos")
            cur.execute("DELETE FROM sales")
            cur.execute("DELETE FROM products")
            for p in data["products"]:
                cur.execute(
                    """INSERT INTO products(id, name, code, barcode, category, purchase_price, sale_price,
                       quantity, status, created_at) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (p.get("id"), p.get("name", ""), p.get("code", ""), p.get("barcode", ""),
                     p.get("category", "Прочие"), p.get("purchase_price", 0),
                     p.get("sale_price", 0), p.get("quantity", 0),
                     p.get("status", "draft"), p.get("created_at")),
                )
            for ph in data.get("photos", []):
                cur.execute(
                    """INSERT INTO photos(id, product_id, filename, content_type, position, data)
                       VALUES (%s,%s,%s,%s,%s,%s)""",
                    (ph.get("id"), ph.get("product_id"), ph.get("filename", "photo.jpg"),
                     ph.get("content_type", "image/jpeg"), ph.get("position", 0),
                     base64.b64decode(ph.get("data", "")) if ph.get("data") else None),
                )
            for s in data["sales"]:
                cur.execute(
                    """INSERT INTO sales(
                           id, product_id, product_name, quantity, unit_price, unit_cost, sale_date,
                           receipt_no, payment_method, discount, cash_received, change_amount,
                           cash_part, card_part, note, created_at
                       ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                    (s.get("id"), s.get("product_id"), s.get("product_name", ""),
                     s.get("quantity", 0), s.get("unit_price", 0), s.get("unit_cost", 0),
                     s.get("sale_date"), s.get("receipt_no", ""), s.get("payment_method", "cash"),
                     s.get("discount", 0), s.get("cash_received", 0), s.get("change_amount", 0),
                     s.get("cash_part", 0), s.get("card_part", 0), s.get("note", ""),
                     s.get("created_at")),
                )
            for key, value in (data.get("settings") or {}).items():
                cur.execute("INSERT INTO settings(key,value) VALUES (%s,%s) "
                            "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
            # Синхронизируем sequences и заполняем недостающие штрихкоды
            cur.execute("SELECT setval(pg_get_serial_sequence('products', 'id'), COALESCE((SELECT MAX(id) FROM products), 1))")
            cur.execute("SELECT setval(pg_get_serial_sequence('sales', 'id'), COALESCE((SELECT MAX(id) FROM sales), 1))")
            cur.execute("SELECT setval(pg_get_serial_sequence('photos', 'id'), COALESCE((SELECT MAX(id) FROM photos), 1))")
            backfill_barcodes(cur)
    return {"ok": True}


@app.post("/api/change-password")
def change_password(data: PasswordIn, request: Request, _=Depends(require_auth)):
    with get_conn() as conn:
        with conn.cursor() as cur:
            current = get_setting(cur, "password", "ademi2025")
            if data.old_password != current:
                raise HTTPException(400, "Старый пароль неверный")
            if len(data.new_password.strip()) < 4:
                raise HTTPException(400, "Минимум 4 символа")
            cur.execute("UPDATE settings SET value=%s WHERE key='password'", (data.new_password.strip(),))
    return {"ok": True}


@app.post("/api/logout")
def logout(request: Request, _=Depends(require_auth)):
    header = request.headers.get("Authorization", "")
    SESSIONS.pop(header[7:], None)
    return {"ok": True}


@app.get("/api/stats")
def stats(request: Request, _=Depends(require_auth)):
    """Статистика за сегодня, вчера, неделю, месяц и всё время (+ разбивка по способам оплаты)."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM sales")
            sales = cur.fetchall()

    today = date.today()
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=6)
    month_start = today.replace(day=1)

    periods = {
        "today": lambda d: d == today,
        "yesterday": lambda d: d == yesterday,
        "week": lambda d: week_start <= d <= today,
        "month": lambda d: month_start <= d <= today,
        "all": lambda d: True,
    }

    result = {}
    for key, match in periods.items():
        sold = revenue = cost = 0.0
        receipts_set = set()
        by_pay = {"cash": 0.0, "qr": 0.0, "card": 0.0, "mixed": 0.0}
        for s in sales:
            d = s["sale_date"]
            if isinstance(d, str):
                d = date.fromisoformat(d[:10])
            if not match(d):
                continue
            q = int(s["quantity"] or 0)
            disc = float(s.get("discount") or 0)
            line_rev = max(0.0, q * float(s["unit_price"] or 0) - disc)
            sold += q
            revenue += line_rev
            cost += q * float(s["unit_cost"] or 0)
            rno = s.get("receipt_no") or f"single-{s['id']}"
            receipts_set.add(rno)
            pm = s.get("payment_method") or "cash"
            by_pay[pm] = by_pay.get(pm, 0.0) + line_rev
        result[key] = {
            "sold": int(sold),
            "deals": len(receipts_set),
            "revenue": round(revenue, 2),
            "cost": round(cost, 2),
            "profit": round(revenue - cost, 2),
            "by_payment": {k: round(v, 2) for k, v in by_pay.items()},
        }
    return result


# ---------------------------------------------------------------- STATIC
@app.get("/uploads/{photo_id}")
def get_photo(photo_id: int):
    ensure_initialized()
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT data, content_type FROM photos WHERE id = %s", (photo_id,))
            row = cur.fetchone()
    if not row or not row["data"]:
        raise HTTPException(404, "Фото не найдено")
    return Response(content=bytes(row["data"]), media_type=row["content_type"] or "image/jpeg")


if DIST_DIR.exists():
    assets = DIST_DIR / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        # Сначала отдаём реальные статические файлы из dist (например /logo.jpg, /favicon.ico)
        if full_path:
            candidate = (DIST_DIR / full_path).resolve()
            if DIST_DIR.resolve() in candidate.parents and candidate.is_file():
                return FileResponse(candidate)
        return FileResponse(DIST_DIR / "index.html")
else:
    @app.get("/")
    def root():
        return {"status": "ok", "message": "Vishenka Store API"}
