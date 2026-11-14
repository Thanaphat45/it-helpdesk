# One image: NestJS API that also serves the Angular build.
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npx ng build

FROM node:24-alpine AS api
WORKDIR /api
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npx nest build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production WEB_DIST=/app/public
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY --from=api /api/package.json ./
COPY --from=web /web/dist/web/browser ./public
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
