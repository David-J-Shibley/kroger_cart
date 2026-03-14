# Kroger Cart — run the app in Docker
# Build: docker build -t kroger-cart .
# Run:   docker run -p 8000:8000 kroger-cart

FROM node:20-alpine

WORKDIR /app

# Install dependencies (include devDependencies for tsx and tsc)
COPY package.json package-lock.json* ./
RUN npm ci

# Copy source and config
COPY server.ts kroger-cart.ts tsconfig.client.json ./
COPY kroger-cart.html kroger-cart.css kroger-oauth-callback.html ./

# Build client JS (produces dist/kroger-cart.js)
RUN npm run build:client

EXPOSE 8000

ENV NODE_ENV=production
CMD ["npm", "start"]
