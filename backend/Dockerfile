FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get update && apt-get install -y \
    nodejs \
    ffmpeg \
    libheif-examples \
    libva-drm2 \
    libva2 \
    mesa-va-drivers \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev \
    && rm -rf /root/.npm
COPY . .
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
