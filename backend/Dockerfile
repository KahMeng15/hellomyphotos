FROM node:22-slim

ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
      arm64) url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz" ;; \
      *)     url="https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" ;; \
    esac; \
    apt-get update \
      && apt-get upgrade -y \
      && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
      && rm -rf /var/lib/apt/lists/* \
      && curl -fsSL "$url" -o /tmp/ffmpeg.tar.xz \
      && tar -xJf /tmp/ffmpeg.tar.xz -C /tmp \
      && cp /tmp/ffmpeg-*-static/ffmpeg /usr/local/bin/ffmpeg \
      && rm -rf /tmp/ffmpeg*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev \
    && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY . .
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
