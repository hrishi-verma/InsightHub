FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

# Run as the image's unprivileged "node" user; the app can't write its own code.
USER node

EXPOSE 8000
CMD ["node", "src/index.js"]
