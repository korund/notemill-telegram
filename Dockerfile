FROM node:24-alpine AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.release.json ./
COPY src/ src/
RUN npx tsc -p tsconfig.release.json

FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist/ dist/

EXPOSE 8080
CMD ["node", "dist/bin/server.js"]
