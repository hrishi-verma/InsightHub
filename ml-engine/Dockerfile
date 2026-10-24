FROM python:3.12-slim AS build
WORKDIR /build
COPY requirements.txt .
# Wheels only: no compiler needed, and nothing from this stage reaches the final image except the venv.
RUN python -m venv /venv \
 && /venv/bin/pip install --no-cache-dir --only-binary=:all: -r requirements.txt

FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PATH=/venv/bin:$PATH
RUN useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin mluser \
 && mkdir -p /app/models && chown mluser /app/models
WORKDIR /app
COPY --from=build /venv /venv
COPY api.py advanced_ml.py predict.py train_model.py ./
USER mluser
EXPOSE 5000
# --preload creates the placeholder model once, before workers fork. /dev/shm keeps gunicorn's
# heartbeat files off a read-only root filesystem.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", "--workers", "2", "--timeout", "10", "--preload", "--no-control-socket", \
     "--worker-tmp-dir", "/dev/shm", "api:app"]
