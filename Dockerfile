FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force

COPY --from=build /app/dist/ dist/

ENV NODE_ENV=production
EXPOSE 4195

ENTRYPOINT ["node", "dist/cli.js", "serve"]
CMD ["--port", "4195"]
