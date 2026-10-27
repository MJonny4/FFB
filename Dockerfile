FROM oven/bun:1.4.4 AS runtime
WORKDIR /app
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/football/package.json packages/football/package.json
COPY packages/simulation/package.json packages/simulation/package.json
RUN bun install --frozen-lockfile --production
COPY apps/api apps/api
COPY apps/worker apps/worker
COPY packages packages
USER bun
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=8080
EXPOSE 8080
CMD ["bun", "apps/api/src/index.ts"]
