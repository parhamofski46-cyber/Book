FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Dependencies first: this layer is cached until pyproject.toml changes, so
# editing code rebuilds in seconds rather than reinstalling everything.
COPY pyproject.toml README.md ./
COPY app ./app
RUN pip install --no-cache-dir -e .

COPY alembic.ini ./
COPY migrations ./migrations

# Run as a non-root user; nothing here needs privileges.
RUN useradd --create-home --uid 1000 bot && chown -R bot:bot /app
USER bot

# Migrate, then start. Doing it here means a deploy can never run new code
# against an old schema.
CMD ["sh", "-c", "alembic upgrade head && python -m app.bot.main"]
