# Stage 1: Build
FROM --platform=linux/amd64 node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY . .

ARG VITE_API_ENDPOINT=""
ARG VITE_COGNITO_USER_POOL_ID=""
ARG VITE_COGNITO_CLIENT_ID=""
ARG VITE_AWS_REGION="us-east-1"

ENV VITE_API_ENDPOINT=${VITE_API_ENDPOINT}
ENV VITE_COGNITO_USER_POOL_ID=${VITE_COGNITO_USER_POOL_ID}
ENV VITE_COGNITO_CLIENT_ID=${VITE_COGNITO_CLIENT_ID}
ENV VITE_AWS_REGION=${VITE_AWS_REGION}

RUN npm run build

# Stage 2: Serve
FROM --platform=linux/amd64 nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:80/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
