# Cabinet Planner server. Build from the repository root:
#   docker build -f packages/server/Dockerfile -t cabinet-planner-server .
#   docker run -d -p 8787:8787 -v cabinet-planner-data:/data -e ADMIN_EMAILS=you@example.com cabinet-planner-server

FROM node:22-alpine AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/server packages/server
RUN pnpm install --frozen-lockfile --filter @cabinet-planner/server...
RUN pnpm --filter @cabinet-planner/server build

# The bundle is one file without dependencies (SQLite is built into Node 22).
FROM node:22-alpine
WORKDIR /app
COPY --from=build /src/packages/server/dist/server.mjs ./server.mjs
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8787/health || exit 1
CMD ["node", "server.mjs"]
