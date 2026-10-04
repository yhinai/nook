# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY tsconfig.json ./
COPY src ./src
RUN npx mastra build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production MASTRA_HOST=0.0.0.0 PORT=4111 TWIN_OUTPUT_DIR=/data
# .mastra/output is self-contained: the bundled server plus its own node_modules.
COPY --from=build /app/.mastra/output ./
EXPOSE 4111
CMD ["node", "index.mjs"]
