# Build stage
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Vite inlines these at build time; provide defaults so the build works without CI vars.
ARG PUBLIC_TURNSTILE_SITEKEY=1x00000000000000000000AA
ARG VITE_API_URL=
ARG PUBLIC_APP_DOMAIN=http://localhost:8000
ENV PUBLIC_TURNSTILE_SITEKEY=$PUBLIC_TURNSTILE_SITEKEY
ENV VITE_API_URL=$VITE_API_URL
ENV PUBLIC_APP_DOMAIN=$PUBLIC_APP_DOMAIN
RUN npm run build

# Run stage — devDependencies are bundled into the build by Rollup,
# so only runtime `dependencies` need to be installed here.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev \
    && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder /app/build build/
EXPOSE 3000
CMD ["node", "build"]
