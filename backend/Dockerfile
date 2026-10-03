FROM python:3.11.16-slim-bookworm@sha256:a36c24f9cbdf4fd0f52d67f0823eeac19c2028c637cecc392d97f980d4fec56b

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --create-home --uid 10001 journal
COPY --chown=journal:journal . .
USER journal
EXPOSE 7777
CMD ["gunicorn", "--bind", "0.0.0.0:7777", "--workers", "2", "--timeout", "120", "--access-logfile", "-", "app:app"]
