# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# web/modules is a symlink to ../modules: module UIs (modules/*/ui) are part of the web bundle.
COPY modules/ /src/modules/
RUN npm run build

FROM rust:1.99-bookworm AS server
WORKDIR /src
# Build dependencies first so source edits do not rebuild them.
COPY Cargo.toml Cargo.lock ./
COPY server/Cargo.toml server/Cargo.toml
RUN mkdir -p server/src && echo "fn main() {}" > server/src/main.rs && touch server/src/lib.rs \
 && cargo build --release -p dashboard && rm -rf server/src
COPY server/ server/
RUN touch server/src/main.rs server/src/lib.rs && cargo build --release -p dashboard

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server /src/target/release/dashboard /app/dashboard
COPY --from=web /src/web/dist /app/web/dist
COPY modules/ /app/modules/
COPY application.lua /app/application.lua
ENV PORT=5000 STATIC_DIR=/app/web/dist MODULES_DIR=/app/modules APPLICATION_FILE=/app/application.lua
EXPOSE 5000
CMD ["/app/dashboard"]
