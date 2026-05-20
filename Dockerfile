FROM node:24-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci --workspaces --include-workspace-root

FROM node:24-alpine AS api-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN npm run db:generate && npm run build -w @multi/api

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
ENV API_PORT=4000

COPY --from=api-builder /app/node_modules ./node_modules
COPY --from=api-builder /app/apps/api/dist ./apps/api/dist
COPY --from=api-builder /app/packages/db/prisma ./packages/db/prisma
COPY --from=api-builder /app/package*.json ./
COPY --from=api-builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=api-builder /app/packages/db/package.json ./packages/db/package.json

EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

FROM node:24-alpine AS web-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ARG NEXT_PUBLIC_EVOLUTION_MANAGER_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_EVOLUTION_MANAGER_URL=$NEXT_PUBLIC_EVOLUTION_MANAGER_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

RUN npm run build -w @multi/web

FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production

COPY --from=web-builder /app/apps/web/.next/standalone ./
COPY --from=web-builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
