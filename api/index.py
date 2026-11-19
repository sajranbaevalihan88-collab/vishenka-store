"""Vercel serverless entry point for Vishenka Store."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mangum import Mangum
from app import app

handler = Mangum(app, lifespan="off")
