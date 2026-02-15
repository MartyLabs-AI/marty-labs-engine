FROM node:20-slim

WORKDIR /app

# Copy package files
COPY package.json ./
RUN npm install --production=false

# Copy source
COPY . .

# Build frontend
RUN npm run build

# Prune dev dependencies
RUN npm prune --production

# Create memory directory
RUN mkdir -p /app/server/memory/data

EXPOSE 10000

ENV MEMORY_PATH=/app/server/memory/data

CMD ["node", "server/index.js"]
