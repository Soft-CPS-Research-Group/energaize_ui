# syntax=docker/dockerfile:1

FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
ARG VITE_AI_TRAINING_ENABLED=false
ENV VITE_AI_TRAINING_ENABLED=$VITE_AI_TRAINING_ENABLED
RUN npm run build

FROM nginx:1.27-alpine
# Override at container startup; one image works with local or server APIs.
ENV AI_TRAINING_API_URL=http://127.0.0.1:8022 \
    COMMUNITY_API_URL=http://193.136.62.78:8017 \
    ACCESS_API_URL=http://193.136.62.78:8018 \
    TELEMETRY_API_URL=http://193.136.62.78:8019 \
    FLEXIBILITY_API_URL=http://193.136.62.78:8020 \
    RUNTIME_API_URL=http://193.136.62.78:8021 \
    JOBS_API_URL=http://193.136.62.78:8011 \
    TRAINING_API_URL=http://193.136.62.78:8000 \
    PREDICTOR_API_URL=http://193.136.62.78:8006 \
    KPI_API_URL=http://193.136.62.78:8007
COPY docker/nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
