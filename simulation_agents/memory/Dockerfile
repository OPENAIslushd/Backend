FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY shared ./shared
COPY contracts ./contracts
COPY memory ./memory
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8080 MEMORY_DB_PATH=/data/memory.sqlite
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=3s --start-period=10s --retries=10 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "memory/server.js"]
