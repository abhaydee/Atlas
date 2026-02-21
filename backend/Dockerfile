FROM node:20-alpine

WORKDIR /app

# Install contracts dependencies + compile first
COPY contracts/package*.json ./contracts/
RUN cd contracts && npm ci

COPY contracts/ ./contracts/
RUN cd contracts && npm run compile

# Install backend dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci

COPY backend/ ./backend/

# Build TypeScript
RUN cd backend && npm run build

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "backend/dist/index.js"]
