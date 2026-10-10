ARG SERVICE_NAME

FROM node:24-alpine AS build

WORKDIR /app
COPY . .
RUN npm ci

ARG SERVICE_NAME
RUN npm run build --workspace @sellerone/${SERVICE_NAME}-service

FROM node:24-alpine
ARG SERVICE_NAME
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/services/${SERVICE_NAME}/dist ./dist
CMD ["node", "dist/index.js"]
