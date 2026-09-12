FROM node:22-alpine

RUN apk update && apk add --no-cache \
    ffmpeg \
    libheif-tools \
    libva \
    mesa-va-gallium

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev \
    && rm -rf /root/.npm /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY . .
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "src/server.ts"]
