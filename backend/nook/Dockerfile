FROM node:24-bookworm-slim AS build
WORKDIR /app/backend/nook
COPY backend/nook/package.json backend/nook/package-lock.json ./
RUN npm ci --ignore-scripts
COPY backend/nook/src ./src
COPY src/main/sidequest/provider.ts src/main/sidequest/provider-protocol.ts /app/src/main/sidequest/
COPY src/main/sidequest/life-team/network.ts /app/src/main/sidequest/life-team/
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 NOOK_DATABASE=/data/nook.db
WORKDIR /app
COPY backend/nook/package.json backend/nook/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/backend/nook/dist/server.mjs ./dist/server.mjs
EXPOSE 8080
CMD ["node", "dist/server.mjs"]
