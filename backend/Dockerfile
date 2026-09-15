FROM node:26-trixie-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# We use node:22-trixie-slim as the base image so we get a modern libheif (v1.19+) natively,
# which is required to decode iOS 17 HEIC files.
RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libva-drm2 \
        libva2 \
        g++ \
        libheif1 \
        libheif-examples \
        libheif-plugin-libde265 \
        libheif-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN g++ -O2 -o /usr/local/bin/heic-primary-decode src/utils/heic_primary_decode.cpp -lheif
RUN npx esbuild src/server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js --sourcemap

FROM node:26-trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libva-drm2 \
        libva2 \
        libheif1 \
        libheif-examples \
        libheif-plugin-libde265 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev \
    && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /usr/local/bin/npm /usr/local/bin/npx
COPY --from=builder /app/dist ./dist
COPY --from=builder /usr/local/bin/heic-primary-decode /usr/local/bin/heic-primary-decode
EXPOSE 3000
CMD ["node", "dist/server.js"]
