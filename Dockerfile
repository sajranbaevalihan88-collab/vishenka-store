FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt uvicorn
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY app.py db.py config.py seed_products.json ./
ENV PORT=8000
EXPOSE 8000
CMD python -m uvicorn app:app --host 0.0.0.0 --port $PORT
