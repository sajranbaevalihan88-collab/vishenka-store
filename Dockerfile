FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git libpq5 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=frontend /app/frontend/dist ./frontend/dist
COPY app.py db.py config.py seed_products.json ./
RUN git init -q && git add -A && git -c user.name=x -c user.email=x@x.com commit -qm init
ENV PORT=8000
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
