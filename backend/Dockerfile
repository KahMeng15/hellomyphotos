FROM node:22-slim

RUN echo "Acquire::Check-Valid-Until \"false\";\nAcquire::Check-Date \"false\";" > /etc/apt/apt.conf.d/10no--check-valid-until && \
    apt-get update -o Acquire::AllowInsecureRepositories=true -o Acquire::AllowDowngradeToInsecureRepositories=true || true

RUN apt-get install -y --allow-unauthenticated --no-install-recommends \
    ffmpeg \
    libva-drm2 \
    libva2 \
    mesa-va-drivers \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev \
    && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY . .
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
