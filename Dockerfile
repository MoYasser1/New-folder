FROM node:24-alpine AS build
WORKDIR /app
ARG VITE_API_URL=
ARG VITE_PAYMENT_MODE=provider
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_PAYMENT_MODE=$VITE_PAYMENT_MODE
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/health || exit 1
