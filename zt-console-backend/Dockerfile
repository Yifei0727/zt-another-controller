# ============================================================================
# 构建流程（本环境无法直接拉 Docker Hub，故采用「原生 musl 交叉编译 + scratch」）：
#   1) 构建机（wsl）安装工具链：
#        rustup target add x86_64-unknown-linux-musl
#        apt-get install -y musl-tools          # 提供 x86_64-linux-musl-gcc
#   2) 把前端产物放到 crate 内，供 rust-embed 编译期嵌入：
#        cp -r zt-member-ui/dist zt-console-backend/frontend-dist
#   3) 交叉编译出完全静态的 musl 二进制：
#        cd zt-console-backend && cargo build --release --target x86_64-unknown-linux-musl
#   4) 本 Dockerfile 只把产物塞进 FROM scratch，无需拉取任何基础镜像。
# 若构建机可直连 Docker Hub，也可改用 messense/rust-musl-cross 作为 builder 阶段。
# ============================================================================
FROM scratch
WORKDIR /
COPY zt-console-backend/target/x86_64-unknown-linux-musl/release/zt-console-backend /zt-console-backend
VOLUME ["/data"]
ENV DATA_DIR=/data
ENV ZT_CONTROLLER_URL=http://host.docker.internal:9993
# 密钥默认从 /var/lib/zerotier-one/authtoken.secret 读取（路径见 main.rs），
# 把宿主该文件以只读挂载进容器即可，无需 ZT_TOKEN env。
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["/zt-console-backend"]
