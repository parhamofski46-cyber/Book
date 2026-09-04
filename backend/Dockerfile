# The whole backend is standard-library Node, so there is nothing to install
# and nothing to build -- the image is the runtime plus the source.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src

RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV PULSE_DB=/data/pulse.db \
    PULSE_PORT=8787 \
    PULSE_HOST=0.0.0.0
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PULSE_PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--no-warnings", "src/main.js"]
