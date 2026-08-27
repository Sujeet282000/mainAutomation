# ============================================================================
# Orchestra — AI Service Dockerfile (Part 13)
# Python FastAPI service — non-root, immutable image
# ============================================================================

# ── Base ─────────────────────────────────────────────────────────────────────
FROM python:3.11-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential curl && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY apps/ai/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Production ───────────────────────────────────────────────────────────────
FROM base AS production
RUN useradd --create-home --shell /bin/bash appuser
COPY apps/ai/ apps/ai/
COPY apps/ai/orchestra_ai/ apps/ai/orchestra_ai/
USER appuser
WORKDIR /app/apps/ai
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]

# ── Dev ──────────────────────────────────────────────────────────────────────
FROM base AS dev
COPY apps/ai/ .
CMD ["python", "-m", "uvicorn", "main:app", "--reload", "--port", "8000", "--host", "0.0.0.0"]
