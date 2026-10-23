FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Run as the image's unprivileged "node" user; the code is read-only to it.
USER node

# Node's fetch: alpine has no curl/wget. Calls the host the server binds to (HEALTH_HOST; wildcard
# or unset -> 127.0.0.1; IPv6 literals get brackets).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "let h=process.env.HEALTH_HOST||'';if(h==='0.0.0.0'||h==='::')h='';h=h||'127.0.0.1';if(h.includes(':')&&h[0]!=='[')h='['+h+']';fetch('http://'+h+':'+(process.env.HEALTH_PORT||9100)+'/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "src/index.js"]
