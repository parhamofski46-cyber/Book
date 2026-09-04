# Built from the repository root, not from backend/, because the image needs the
# collector sources too: the backend packages them into the pre-configured
# download an operator installs.
#
#   docker build -f backend/Dockerfile .
FROM node:22-alpine

WORKDIR /app
COPY backend/package.json ./
COPY backend/src ./src
# add-server.js is part of the install path, not a development extra: without
# it, registering a server inside the container is impossible.
COPY backend/scripts ./scripts
COPY collector ./collector

RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV PULSE_DB=/data/pulse.db \
    PULSE_PORT=8787 \
    PULSE_HOST=0.0.0.0 \
    PULSE_COLLECTOR_DIR=/app/collector
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PULSE_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "src/main.js"]
