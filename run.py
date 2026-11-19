"""Запуск: подготовка базы, сборка React и старт сервера."""
import subprocess
import sys

from config import FRONTEND_DIR, DIST_DIR, HOST, PORT
from db import init_db


def ensure_frontend():
    if (DIST_DIR / "index.html").exists():
        return
    if not (FRONTEND_DIR / "node_modules").exists():
        print("Устанавливаю зависимости React (из локального кэша)…", flush=True)
        subprocess.run(["npm", "install", "--offline"], cwd=FRONTEND_DIR, check=True, shell=True)

    print("Собираю React-приложение…", flush=True)
    subprocess.run(["npm", "run", "build"], cwd=FRONTEND_DIR, check=True, shell=True)


def main():
    print("Проверяю PostgreSQL…", flush=True)
    count = init_db()
    print(f"База готова. Товаров в базе: {count}", flush=True)

    ensure_frontend()

    import uvicorn
    print(f"\nVishenka Store: http://localhost:{PORT}/\n", flush=True)
    uvicorn.run("app:app", host=HOST, port=PORT, log_level="warning")


if __name__ == "__main__":
    sys.exit(main())
