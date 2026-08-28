# syntax=docker/dockerfile:1
# ============================================================================
# 多阶段构建，用于发布到 ghcr.io/yifei0727/zt-another-controller
#   Stage 1  frontend : 构建 React 前端 (zt-member-ui) -> dist
#   Stage 2  backend  : 编译静态 musl 后端 (zt-console-backend)，rust-embed 内嵌前端
#   Stage 3  runtime  : 极简 scratch 镜像
# 也可在本地直接 `docker build -t zt-console .` 从源码构建。
# ============================================================================

FROM node:20-slim AS frontend
WORKDIR /build/zm
COPY zt-member-ui/package.json zt-member-ui/package-lock.json* ./
RUN npm ci
COPY zt-member-ui/ ./
RUN npm run build && cp -r dist /frontend-dist

FROM rust:1-slim AS backend
RUN apt-get update \
    && apt-get install -y --no-install-recommends musl-tools \
    && rm -rf /var/lib/apt/lists/* \
    && rustup target add x86_64-unknown-linux-musl
WORKDIR /build/be
COPY zt-console-backend/ ./
COPY --from=frontend /frontend-dist ./frontend-dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    cargo build --release --target x86_64-unknown-linux-musl

FROM scratch
WORKDIR /
COPY --from=backend /build/be/target/x86_64-unknown-linux-musl/release/zt-console-backend /zt-console-backend
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV ZT_CONTROLLER_URL=http://host.docker.internal:9993
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["/zt-console-backend"]
