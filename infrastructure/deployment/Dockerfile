FROM node:22.23.2-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.base.json .prettierrc.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --no-audit --no-fund
RUN npm run build

FROM build AS production-dependencies
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22.23.2-bookworm-slim AS api
ENV NODE_ENV=production DOTENV_CONFIG_PATH=/dev/null API_HOST=0.0.0.0 API_PORT=3000
WORKDIR /workspace
COPY --from=production-dependencies /workspace/node_modules ./node_modules
COPY package.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY packages/auth/package.json ./packages/auth/package.json
COPY --from=build /workspace/packages/auth/dist ./packages/auth/dist
COPY packages/config/package.json ./packages/config/package.json
COPY --from=build /workspace/packages/config/dist ./packages/config/dist
COPY packages/domain/package.json ./packages/domain/package.json
COPY --from=build /workspace/packages/domain/dist ./packages/domain/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

FROM nginxinc/nginx-unprivileged:1.28.0-alpine AS web
COPY infrastructure/deployment/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

FROM web AS operations
COPY --from=build /workspace/apps/erp-crm-web/dist /usr/share/nginx/html
FROM web AS pos
COPY --from=build /workspace/apps/pos-web/dist /usr/share/nginx/html
FROM web AS recovery
COPY --from=build /workspace/apps/backup-control/dist /usr/share/nginx/html
