# syntax=docker/dockerfile:1
# ============================================================================
# 单文件二进制镜像：Release CI 已交叉编译好 linux/musl 二进制并内嵌前端。
# 本 Dockerfile 根据 TARGETARCH 选择对应二进制，放入 scratch 镜像。
# 支持：linux/amd64、linux/arm64
# ============================================================================

FROM alpine:latest AS selector
ARG TARGETARCH
WORKDIR /bins
COPY dist/ ./
RUN case "$TARGETARCH" in \
      amd64) cp zt-console-linux-musl-x86_64 /zt-console-backend ;; \
      arm64) cp zt-console-linux-musl-aarch64 /zt-console-backend ;; \
      *) echo "Unsupported architecture: $TARGETARCH"; exit 1 ;; \
    esac && chmod +x /zt-console-backend

FROM scratch
WORKDIR /
COPY --from=selector /zt-console-backend /zt-console-backend
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV ZT_CONTROLLER_URL=http://host.docker.internal:9993
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["/zt-console-backend"]
