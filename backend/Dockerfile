FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY backend/ ./
COPY frontend/ /app/frontend/
USER node
EXPOSE 8787
CMD ["node","src/server.js"]
