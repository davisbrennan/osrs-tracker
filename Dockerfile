FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ARG GIT_SHA=dev
ENV NEXT_PUBLIC_BUILD_SHA=$GIT_SHA
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# No uploads directory: this product stores no user files, so there is no
# volume to mount and nothing for a restore to bring back beyond the database.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# Standalone output ships its own minimal node_modules for the web server.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# The migration runner and worker need the full dependency tree.
COPY --from=deps  --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/drizzle ./drizzle
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

# The worker runs TypeScript under tsx so it shares the app's own modules
# rather than reimplementing the GE maths. That needs the sources and the
# tsconfig, for the "@/" path alias.
COPY --from=builder --chown=nextjs:nodejs /app/worker.ts ./worker.ts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
# A shim, so `node worker.js` in an older compose file still starts the worker.
COPY --from=builder --chown=nextjs:nodejs /app/worker.js ./worker.js

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
