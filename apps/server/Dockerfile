# Multi-stage build for the NestJS server within the npm workspace monorepo.
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# --- deps: install workspace dependencies ---
FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

# --- build: compile shared + server ---
FROM deps AS build
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN npm run build --workspace @ai-mafia/shared \
 && npm run prisma:generate --workspace @ai-mafia/server \
 && npm run build --workspace @ai-mafia/server

# --- runtime ---
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/prisma ./apps/server/prisma
WORKDIR /app/apps/server
EXPOSE 4000
CMD ["node", "dist/main.js"]
