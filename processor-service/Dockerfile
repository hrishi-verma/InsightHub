FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Run as the image's unprivileged "node" user; the code is read-only to it.
USER node

CMD ["node", "src/index.js"]
