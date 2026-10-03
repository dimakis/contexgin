FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild better-sqlite3

COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
RUN npm run build && npm prune --omit=dev --ignore-scripts

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules/ node_modules/

COPY --from=build /app/dist/ dist/

RUN addgroup --system contexgin && adduser --system --ingroup contexgin contexgin
USER contexgin

ENV NODE_ENV=production
EXPOSE 4195

ENTRYPOINT ["node", "dist/cli.js", "serve"]
CMD ["/workspace", "--host", "0.0.0.0", "--port", "4195"]
