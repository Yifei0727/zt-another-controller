# zt-another-controller

一个自托管的 ZeroTier 控制器（zerotier-one）管理控制台。后端用 Rust（axum）反向代理宿主机
ZeroTier 控制器的本地 JSON API，前端用 React + TypeScript（液态玻璃风）呈现成员 / 网络管理界面。

> 仓库名 `zt-another-controller`。

## 功能

- 多网络 / 多成员管理：授权、IP 分配、桥接、自动分配开关、增删成员与网络
- 节点在线状态：通过控制器 `/peer` 推导在线 / 中继 / 离线，并标注控制器自身节点
- 管理员会话：基于 HttpOnly Cookie 的登录 / 改密 / 退出
- API Key 颁发：以 `Authorization: Bearer` 方式供外部程序调用 ZeroTier 管理 API
  （仅限 `/api/controller/**`，**不能**用于登录或管理系统自身）
- 搜索、排序、按状态筛选成员

## 架构

```
zt-member-ui/        React + TS + Vite 前端（构建产物被后端 rust-embed 内嵌）
zt-console-backend/  Rust + axum 后端，把前端 dist 编译进二进制，只提供 HTTP
```

后端把对外的 `/api/controller/**` 请求转发到 `ZT_CONTROLLER_URL`（默认
`http://host.docker.internal:9993`），并注入 `X-ZT1-Auth` 令牌（来自 `ZT_TOKEN`
或挂载的 `/var/lib/zerotier-one/authtoken.secret`）。

## 快速开始

### Docker（从源码构建）

```bash
docker build -t zt-console .
docker run -d --name zt-console \
  -p 127.0.0.1:3000:3000 \
  -v zt-console-data:/data \
  -v /var/lib/zerotier-one/authtoken.secret:/var/lib/zerotier-one/authtoken.secret:ro \
  -e ZT_CONTROLLER_URL=http://host.docker.internal:9993 \
  zt-console
```

浏览器打开 `http://<管理机IP>:3000`。首次启动会在日志中打印随机生成的 admin 密码，登录后强制改密。

> 端口务必绑定到管理网 IP（建议 `127.0.0.1`），不要暴露到 `0.0.0.0`。

### Docker Compose

仓库内含 `docker-compose.yml`，用 `ZT_HOST=10.x.x.x docker compose up -d` 把端口绑到指定管理网 IP。

### 预构建镜像

CI 会把镜像推送到 `ghcr.io/yifei0727/zt-another-controller`：

```bash
docker pull ghcr.io/yifei0727/zt-another-controller:latest
```

## 从源码构建

```bash
# 1) 前端
cd zt-member-ui && npm ci && npm run build && cd ..

# 2) 把前端产物放进后端（供 rust-embed 内嵌）
cp -r zt-member-ui/dist zt-console-backend/frontend-dist

# 3) 后端（静态 musl 二进制为例）
cd zt-console-backend
rustup target add x86_64-unknown-linux-musl
cargo build --release --target x86_64-unknown-linux-musl
# 产物：target/x86_64-unknown-linux-musl/release/zt-console-backend
```

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATA_DIR` | `data` | 凭据 / API Key 存储目录（容器内建议 `/data`） |
| `ZT_CONTROLLER_URL` | `http://host.docker.internal:9993` | 宿主机 ZeroTier 控制器地址 |
| `ZT_TOKEN` | 空 | 控制器令牌；为空时读取 `ZT_TOKEN_FILE` |
| `ZT_TOKEN_FILE` | `/var/lib/zerotier-one/authtoken.secret` | 控制器令牌文件（推荐只读挂载进容器） |
| `PORT` | `3000` | 监听端口 |

## 安全说明

- **密码哈希**：采用 PBKDF2-HMAC-SHA256（20 万次迭代 + 每用户随机盐），替代了早期的无盐 SHA256。
- **存储格式**：凭据与 API Key 以 JSON 文件（`users.json` / `apikeys.json`）存储于 `DATA_DIR`，
  采用「临时文件 + rename」原子写以避免崩溃损坏；写入均带 `status / created_at / expires_at / created_by`
  审计字段，API Key 吊销为软删除（置 `disabled` 并写入失效时间）。
  > 评估说明：改用 SQLite（rusqlite 内置）经实测会使二进制体积从 ~2.83MB 增至 ~4.01MB（**+35%**），
  > 超出 10% 阈值，故保留 JSON 方案；其真实安全风险（无盐哈希、整文件写损坏）已通过上述加固消除。
- **Bearer 范围**：API Key 仅用于 `/api/controller/**` 的 ZeroTier 管理，不能访问 `/api/auth/*`。

## CI / 发布

- `.github/workflows/release.yml`：打 `v*` tag（或手动）时交叉编译
  `windows/amd64`、`macos/aarch64`、`linux-musl/{x86_64,aarch64}` 四个二进制，并创建 GitHub Release。
- `.github/workflows/docker.yml`：打 `v*` tag（或手动）时构建镜像并推送到
  `ghcr.io/yifei0727/zt-another-controller`。

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录，返回会话 Cookie |
| POST | `/api/auth/change-password` | 修改密码（需会话） |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/auth/me` | 当前会话信息 |
| GET/POST | `/api/auth/api-keys` | 列出 / 颁发 API Key（需会话） |
| DELETE | `/api/auth/api-keys/{id}` | 吊销 API Key（软删除） |
| ANY | `/api/controller/{*rest}` | 反向代理到 ZeroTier 控制器（会话或 Bearer 均可） |
