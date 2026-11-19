"""Создание базы PostgreSQL, таблиц и первичное заполнение."""
import json
import psycopg2
from psycopg2.extras import RealDictCursor

from config import ADMIN_DSN, APP_DSN, DB_NAME, UPLOAD_DIR, SEED_FILE, DEFAULT_PASSWORD


def ensure_database():
    # В облаке база уже создана провайдером — создаём только таблицы
    if not ADMIN_DSN:
        return
    conn = psycopg2.connect(ADMIN_DSN)
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
            if not cur.fetchone():
                cur.execute(f'CREATE DATABASE "{DB_NAME}"')
    finally:
        conn.close()


def get_conn():
    return psycopg2.connect(APP_DSN, cursor_factory=RealDictCursor)


SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'Прочие',
    purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    sale_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE products ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS photos (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'image/jpeg',
    data BYTEA,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE photos ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'image/jpeg';
ALTER TABLE photos ADD COLUMN IF NOT EXISTS data BYTEA;
CREATE TABLE IF NOT EXISTS sales (
    id SERIAL PRIMARY KEY,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(12,2) NOT NULL,
    unit_cost NUMERIC(12,2) NOT NULL,
    sale_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def init_db():
    ensure_database()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
            cur.execute("SELECT COUNT(*) AS n FROM products")
            count = cur.fetchone()["n"]

            cur.execute("SELECT 1 FROM settings WHERE key = 'password'")
            if not cur.fetchone():
                cur.execute("INSERT INTO settings(key, value) VALUES ('password', %s)", (DEFAULT_PASSWORD,))

            if count == 0 and SEED_FILE.exists():
                seed = json.loads(SEED_FILE.read_text(encoding="utf-8"))
                cur.execute(
                    "INSERT INTO settings(key, value) VALUES ('categories', %s) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (json.dumps(seed.get("categories", []), ensure_ascii=False),),
                )
                for p in seed.get("products", []):
                    cur.execute(
                        """INSERT INTO products(name, category, purchase_price, sale_price, quantity, status)
                           VALUES (%s, %s, %s, %s, %s, 'published')""",
                        (p["name"], p["category"], p["purchase_price"], p["sale_price"], p["quantity"]),
                    )
    return count
