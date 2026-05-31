# FlowNet AI backend — Python 3.9 with CPU-only TF + Torch.
# Optimized build: keep image size down, avoid GPU bits we don't use.
FROM python:3.9-slim

# System libs TF/Torch/Neo4j/Supabase need at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    libpq-dev \
    libgomp1 \
    libgl1 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps first — Docker caches this layer if requirements don't change
COPY requirements.docker.txt .

# Force CPU-only versions of the heavy ML libs. Saves ~1.4 GB.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir \
         \
        torch==2.2.2 \
    && pip install --no-cache-dir tensorflow==2.19.0 \
    && pip install --no-cache-dir -r requirements.docker.txt

# Copy application code + model files
COPY app/ ./app/
COPY ml/ ./ml/

# Fly.io health check & port
EXPOSE 8000
ENV PORT=8000
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Use uvicorn directly; gunicorn adds memory we don't need at this scale
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]