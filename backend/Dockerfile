FROM node:26-trixie-slim AS builder

ENV DEBIAN_FRONTEND=noninteractive

# We use node:22-trixie-slim as the base image so we get a modern libheif (v1.19+) natively,
# which is required to decode iOS 17 HEIC files.
RUN apt-get update && apt-get upgrade -y zstd libzstd1 2>/dev/null || true \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        ffmpeg \
        libva-drm2 \
        libva2 \
        mesa-va-drivers \
        vainfo \
        g++ \
        libheif1 \
        libheif-examples \
        libheif-plugin-libde265 \
        libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Caesium CLT binary
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "x86_64" ]; then CAESIUM_ARCH="x86_64-unknown-linux-musl"; \
    elif [ "$ARCH" = "aarch64" ]; then CAESIUM_ARCH="aarch64-unknown-linux-musl"; \
    fi && \
    if [ -n "$CAESIUM_ARCH" ]; then \
      curl -sSL "https://github.com/Lymphatus/caesium-clt/releases/download/v1.5.0/caesiumclt-v1.5.0-${CAESIUM_ARCH}.tar.gz" | tar -xz -C /tmp && \
      mv /tmp/caesiumclt-v1.5.0-${CAESIUM_ARCH}/caesiumclt /usr/local/bin/caesiumclt && \
      chmod +x /usr/local/bin/caesiumclt && \
      rm -rf /tmp/caesiumclt-*; \
    fi

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN g++ -O2 -o /usr/local/bin/heic-primary-decode src/utils/heic_primary_decode.cpp -lheif
RUN npx esbuild src/server.ts --bundle --platform=node --format=esm --packages=external --outfile=dist/server.js --sourcemap

FROM node:26-trixie-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get upgrade -y zstd libzstd1 2>/dev/null || true \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        ffmpeg \
        libva-drm2 \
        libva2 \
        mesa-va-drivers \
        vainfo \
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
COPY --from=builder /usr/local/bin/caesiumclt /usr/local/bin/caesiumclt
EXPOSE 3000
CMD ["node", "dist/server.js"]
