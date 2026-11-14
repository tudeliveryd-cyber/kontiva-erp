# KONTIVA ERP · imagen única para la API de empresas y el Panel Master.
# El mismo contenedor ejecuta `node dist/main.js` (ERP) o `node dist/main-master.js` (Master).

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/agente/package.json apps/agente/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build \
 && pnpm --filter @kontiva/api deploy --prod --legacy /out \
 && cp -r apps/web/dist /out/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production WEB_DIST=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.SERVICIO==='master'?3001:3000)+(process.env.SERVICIO==='master'?'/api/master':'/api')+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
