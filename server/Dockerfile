# Orb Arena game server image (linux/amd64). Build from the repo root:
#   docker build --platform linux/amd64 -f server/Dockerfile -t registry.edgegap.com/<project>/orb-arena:<tag> .
# Only the server and the shared rules go into the image: the browser client is served elsewhere.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=7777
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY client/rules.js ./client/rules.js
# The Edgegap app version maps this port as "gameport", protocol WS, TLS Upgrade on.
EXPOSE 7777/tcp
USER node
# Node is PID 1, so it receives Edgegap's SIGTERM directly.
CMD ["node", "server/main.js"]
