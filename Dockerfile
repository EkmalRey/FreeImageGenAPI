FROM node:20-alpine AS builder

WORKDIR /app

# Copy package metadata
COPY package*.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY shared/package.json shared/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build client and server
RUN npm run build

# Production image
FROM node:20-alpine

WORKDIR /app

# We only need the built files and production dependencies
COPY package*.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY shared/package.json shared/

RUN npm ci --omit=dev

# Copy built server
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/shared ./shared
# Copy built client to where the server expects it
COPY --from=builder /app/client/dist ./client/dist

# Expose the server port
EXPOSE 3002

# Run the server
CMD ["npm", "start", "--workspace=server"]
