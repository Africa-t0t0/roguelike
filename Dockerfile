# --- Etapa 1: construir el cliente ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY packages packages
RUN npm run build -w @roguelike/client

# --- Etapa 2: imagen final (server + shared + client/dist) ---
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
# Solo las dependencias de producción del servidor (incluye tsx: se corre sin compilar).
RUN npm ci -w @roguelike/server --omit=dev
COPY packages/shared packages/shared
COPY packages/server/src packages/server/src
COPY packages/server/tsconfig.json packages/server/
COPY --from=build /app/packages/client/dist packages/client/dist
EXPOSE 2567
CMD ["npm", "start", "-w", "@roguelike/server"]
