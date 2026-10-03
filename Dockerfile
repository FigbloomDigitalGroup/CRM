# FIG-595: container image for the FigBloom CRM app.
#
# One image serves two roles, selected by the command passed at `docker run`
# time: the running Next.js server (the default CMD), or the one-off
# deploy-time admin commands (`migrate:deploy`, `db:bootstrap-role`,
# `db:grant-role`) that need the Prisma CLI and `tsx` -- see
# docker/entrypoint.sh and docs/DEPLOYMENT.md. Because of that, this
# deliberately ships the full `node_modules` (including devDependencies)
# rather than Next's trimmed `output: "standalone"` mode, which would drop
# the Prisma CLI and `tsx` that those admin commands need.

FROM node:20-alpine AS base
WORKDIR /app
# Prisma's query engine binary needs OpenSSL; alpine doesn't ship it by default.
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY public ./public
COPY package.json next.config.js ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY docker/entrypoint.sh ./docker/entrypoint.sh
RUN chmod +x docker/entrypoint.sh

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

ENTRYPOINT ["./docker/entrypoint.sh"]
CMD ["npm", "run", "start"]
