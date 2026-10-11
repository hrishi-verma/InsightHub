FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Inlined into the browser bundle at build time; next.config.js refuses to build without it.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production
# next.config.js validates this again when the server starts.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY --from=build --chown=node:node /app/package.json /app/next.config.js /app/proxy.js ./
COPY --from=build --chown=node:node /app/lib ./lib
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next

USER node
EXPOSE 3000

CMD ["npx", "next", "start", "-p", "3000"]
