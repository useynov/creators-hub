# Build the mini app and the server.
FROM node:22-slim AS build
WORKDIR /app
# better-sqlite3 13.x publishes no prebuilt binaries, so npm ci compiles it with
# node-gyp, which needs Python and a C++ toolchain. Build stage only: the runtime
# image below copies the compiled node_modules and stays compiler-free.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY admin/package.json admin/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Run: one process serves the bot, the API and the mini app.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/hub.db
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/package.json server/
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY --from=build /app/admin/dist admin/dist
COPY --from=build /app/content content
# The database and the media folder (covers, avatars, story copies) live here.
# Mount a persistent disk at /data on your host.
VOLUME /data
EXPOSE 3000
CMD ["node", "server/dist/index.js"]
