FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV DATABASE_URL=sqlite:////data/hightech.db BACKUP_DIR=/data/backups
VOLUME /data
EXPOSE 4000
# One worker runs the background jobs (release of matured earnings + nightly backup).
CMD ["gunicorn", "-w", "1", "--threads", "8", "-b", "0.0.0.0:4000", "wsgi:app"]
