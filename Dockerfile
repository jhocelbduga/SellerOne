FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY services ./services
COPY apps ./apps
RUN npm ci
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
ENV PORT=3100
ENV DATABASE_PATH=/data/sellerone.sqlite
ENV WEB_DIST_DIR=/app/apps/web/dist
WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build /app/services/accounting/package.json ./services/accounting/package.json
COPY --from=build /app/services/customers/package.json ./services/customers/package.json
COPY --from=build /app/services/inventory/package.json ./services/inventory/package.json
COPY --from=build /app/services/orders/package.json ./services/orders/package.json
COPY --from=build /app/services/platform/package.json ./services/platform/package.json
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
RUN npm ci --omit=dev

COPY --from=build /app/services/inventory/dist ./services/inventory/dist
COPY --from=build /app/services/platform/dist ./services/platform/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

VOLUME ["/data"]
EXPOSE 3100
CMD ["node", "services/platform/dist/index.js"]
