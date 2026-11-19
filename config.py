"""Настройки системы Ademi."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# PostgreSQL
PG_HOST = os.getenv("PG_HOST", "localhost")
PG_PORT = os.getenv("PG_PORT", "5432")
PG_USER = os.getenv("PG_USER", "postgres")
PG_PASSWORD = os.getenv("PG_PASSWORD", "postgres")
DB_NAME = os.getenv("DB_NAME", "ademi")

# В облаке (Vercel) строка подключения приходит через переменную окружения
CLOUD_DSN = os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL")
ADMIN_DSN = None if CLOUD_DSN else f"postgresql://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/postgres"
APP_DSN = CLOUD_DSN or f"postgresql://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{DB_NAME}"

# Файлы
UPLOAD_DIR = BASE_DIR / "uploads"
FRONTEND_DIR = BASE_DIR / "frontend"
DIST_DIR = FRONTEND_DIR / "dist"
SEED_FILE = BASE_DIR / "seed_products.json"

HOST = "0.0.0.0"
PORT = 8000
DEFAULT_PASSWORD = "ademi2025"
MAX_PHOTOS = 10
MAX_PHOTO_BYTES = 10 * 1024 * 1024
