# Kroger Cart — run the app in Docker
# Build: docker build -t kroger-cart .
# Run:   docker run -p 8000:8000 --env-file .env kroger-cart

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY server.ts tsconfig.json tsconfig.client.json ./
COPY server ./server/
COPY client ./client/
COPY index.html landing.html icon.png kroger-cart.css api-host-bootstrap.js kroger-oauth-callback.html auth.html auth-callback.html feedback.html terms.html admin.html robots.txt deploy-config.json ./

RUN npm run build:client

EXPOSE 8000

ENV NODE_ENV=production
CMD ["npm", "start"]
