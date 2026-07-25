FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY server ./server
COPY tsconfig*.json ./
RUN npm run build:api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
ENV DEV_MEMORY_MODE=false
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/server-dist ./server-dist
COPY server/db/migrations ./server-dist/db/migrations
RUN mkdir -p /app/.runtime-uploads && chown -R node:node /app/.runtime-uploads
USER node
EXPOSE 3001
CMD ["sh", "-c", "node server-dist/db/migrate.js && if [ \"$SEED_DEMO_DATA\" = \"true\" ]; then node server-dist/db/seed.js; fi && exec node server-dist/index.js"]
