# ZeroTier 控制台 · 成员与网络管理（iOS 风格重设计）— 设计稿

> 本文件是设计与实现的**单一事实源（single source of truth）**。代码位于 `src/`，本稿描述当前实际行为与视觉，后续改动须同步更新此处，避免设计与实现漂移。
> 阶段：一 = Web 三档适配（已完成）；二 = 原生 App（Android 构建 / Apple 仅规划，未实现）。
> 已接入 Rust 单体后端（`../zt-console-backend/`，axum）：前端以静态资源嵌入二进制，鉴权改为**服务端会话（HttpOnly cookie）**；成员/网络数据已切换为**真实接口**——经 `/api/controller/**` 反向代理到宿主机 ZeroTier 控制器（`fetchNetworks` / `fetchMembers` / `fetchPeers` 拉取，`saveMember` / `saveNetwork` / `createNetworkApi` / `deleteNetworkApi` / `deleteMemberApi` 写回），前端已无任何 mock 数据（见第 5、7 节）。

---

## 1. 设计语言

### 1.1 轻量液态玻璃（Liquid Glass，轻量版）
不采用 Apple 真·液态玻璃的逐元素 SVG `feDisplacementMap` 折射（性能贵）。以三层纯 CSS 还原观感：

1. `backdrop-filter: blur() saturate()` —— 通透感
2. 对角高光渐变 + 1px 白边 + 内阴影高光 —— 玻璃光泽
3. 大圆角

整体环境光**压暗约 8%**（让点亮区更跳），**被点亮区域单独加强约 16%**（水珠高光）。

| 令牌 | 定义（`src/index.css` `@layer components`） |
|---|---|
| `.app-bg` | 渐变壁纸：左上蓝 radial(0.16) + 右上粉 radial(0.14) + `linear-gradient(160deg,#dbdfeb,#dfdfe3 45%,#e9dbe1)`。玻璃需背后有内容才看得出折射。 |
| `.glass` | `blur(22px) saturate(180%)`，白底 alpha 0.40–0.50，白边 `rgba(255,255,255,.5)`，内高光 + 下落阴影。用于顶栏/侧栏/底部 Tab/下拉。 |
| `.glass-strong` | `blur(30px) saturate(200%)`，白底 alpha 0.62，白边 `.65`，更强阴影。用于弹窗/详情抽屉。 |

### 1.2 设计令牌（颜色，`tailwind.config.js`）
| 名称 | 值 | 用途 |
|---|---|---|
| `sysblue` | `#007AFF` | 系统蓝，主操作/选中/链接 |
| `sysgreen` | `#34C759` | 在线状态 / 成功 |
| `sysorange` | `#FF9500` | 中继·待分配 / 警告 |
| `sysgray` | `#8E8E93` | 次要文字 / 未选中 |
| `grouped` | `#F2F2F7` | 分组背景（分段控件底、输入框底） |
| `separator` | `#E5E5EA` | 分隔线 / 卡片描边 |
| `card` | `#FFFFFF` | 内容卡片（**不透明白底**，保证可读性） |
| 字体 | `-apple-system / SF Pro / PingFang SC` | 系统字体栈 |

### 1.3 状态色（成员在线状态，`statusColor`）
- 在线 `#34C759` · 中继 `#FF9500` · 离线 `#C7C7CC`

### 1.4 “点亮区”水珠高光（`LiquidHighlight` 组件）
白色径向渐变：`radial-gradient(120% 108% at 50% 26%, rgba(255,255,255,1), rgba(255,255,255,.49) 46%, transparent 78%)` + `blur(4px)`，`-inset-1` 略溢出。统一套在所有“被点亮”区域：
- 底部 TabBar 当前项（如【成员】）
- 成员页分段控件当前段（未认证 / 已认证）
- 排序当前档
- 网络切换下拉当前网络项

---

## 2. 多端布局（三档自适应）

断点：`md` = 768px（iPad 起），`lg` = 1024px（macOS/桌面 起）。手机为默认（< md）。

| 设备档 | 宽度 | 布局 | 成员列表 | 详情 | 网络切换 | 底部 Tab |
|---|---|---|---|---|---|---|
| iOS 小屏（手机） | < md | 单栏 + 底部悬浮胶囊 TabBar | 卡片列表（`lg:hidden`） | 底部上滑抽屉（`md:hidden`） | 点击顶部网络名 | 显示 |
| iPadOS 中屏 | md–<lg | **左右分栏 master-detail**（`md:flex-row`） | 卡片列表 | 右侧常驻栏（`hidden md:flex`，宽 320px） | 点击顶部网络名 | 显示（浮于底部中部） |
| macOS 大屏 Web | ≥ lg | **三栏 + 表格** | 表格（`hidden lg:block`） | 右侧常驻栏（宽 260px） | 顶部网络名 **或** 左侧玻璃侧栏 | 隐藏（`lg:hidden`） |

- 根容器：`min-h-screen app-bg flex flex-col md:flex-row`
- 左侧玻璃**侧栏**（`Sidebar`）：`hidden lg:flex`，宽 200px，列出网络 + 控制器状态，点网络即切换。
- 主区（`main`）：`flex-1`。成员页顶部 `sticky top-0 z-10 glass` 吸顶玻璃条（标题 + 网络切换 + 分段 + 排序）。
- 详情栏：手机用 `md:hidden` 底部抽屉；iPad/macOS 用 `hidden md:flex` 常驻右栏（底部留 `md:pb-24 lg:pb-4` 以避开悬浮 Tab，且 `overflow-y-auto`）。
- 底部 TabBar：`lg:hidden` 固定悬浮，`left-1/2 -translate-x-1/2 w-[min(420px,calc(100%-32px))]` 居中胶囊，圆角 `rounded-2xl` + 强阴影，图标在上文字在下，选中态系统蓝 + 水珠高光，含 `env(safe-area-inset-bottom)` 安全区。

---

## 3. 页面与交互

### 3.1 登录门（全站前置，`LoginGate`）
- 未登录不渲染任何控制台内容，仅显示全屏 `.app-bg` + 居中 `.glass-strong` 卡片（锁图标、标题、用户名/密码输入框、登录按钮）。
- 凭据由**后端**校验（`/api/auth/login`，HttpOnly cookie 会话）；错误显示红字“用户名或密码不正确”。
- 首次启动后端随机生成管理员密码（打印到 `docker logs`，仅一次），登录后被强制要求改密（`ChangePasswordSheet forced`）。
- 登录态由后端会话维持；挂载时 `/api/auth/me` 恢复；`logout()` 清会话退回登录门。

### 3.2 成员管理（核心）
- **分段筛选**：未认证 / 已认证（默认“已认证”）。未认证 = 刚加入、尚未授权的终端。
- **未命名处理**：刚加入未授权时尚无昵称 → 显示 ZT 地址（`displayName` 回退 `m.id`），并标注“未命名”。
- **已认证内部分组**：待分配 IP（有授权无 IP）/ 已分配 IP（有 IP）。默认按 **IP 排序**（`sortKey='ip'`），可切换按名称/状态/版本/最近活跃。
- **表格必须跟随分段**：`MemberTable` 的数据源由 `authFilter` 决定——「已认证」传 `[...pending, ...assigned]`，「未认证」传 `unauthList`。早期版本固定传「已认证」两分组，导致未认证标签下计数非 0 而表格空白。
- **空态**：任何分组为空时给出明确文案（未认证：“当前没有待认证的终端”；已分配 IP 为空：“暂无已分配 IP 的终端”），避免“有计数无内容”的错觉。
- **已认证表格分组标题**：大屏表格在同时存在两类成员时插入「待分配 IP」「已分配 IP」分组标题行（与卡片视图一致）。
- **版本列**：macOS 三栏表格与卡片副标题均显示各成员当前上线的 ZeroTier 客户端版本（来自 `/peer` 的 `version`）；离线或未上报时显示“—”。
- **自动轮询**：成员列表每 15s 自动 `reloadMembers`（含 `/peer` 状态），新节点加入「未认证」分组、上下线变化无需手动刷新即呈现（`App.tsx` 内 `setInterval`）。
- **网络 ID 可复制**：成员页头部与网络卡片均显示当前网络 ID（`NetworkIdChip` / `NetworkCard` 内「复制」按钮），一键复制发给客户端用于加入。`copyText()` 兼容非 HTTPS 部署（回退 `execCommand`）。
- **改名入口**：详情内“名称”行为右对齐输入框，可即时编辑（`onRename`）。
- **IP 分配**：
  - 网络 IPv4 分配 = 自动 时，成员开关“自动分配 IP”可用；关=手工填写。
  - 手工分配为主（符合用户习惯，默认 `autoAssign=false`）：IP 输入框 + 失焦校验（格式 / 是否被占用 / **是否在本网络 IP 池内** `ipInPool`）。
  - 网络 IPv4 分配 = 关闭（`v4AssignMode==='none'`，如“实验室”网络）时：成员“自动分配 IP”开关 **灰显禁用** + 提示“网络已关闭自动分配，请在网络设置中开启 IPv4 分配”；IP 输入框 placeholder 变“手工填写”；底部“自动分配 IP”按钮隐藏。
- **从属关系贯穿**：详情显示“所属网络”（名 + 私有/公开标签）与“IP 池”上下文，成员与网络关系在 UI 上始终可见。

### 3.3 网络管理（`NetworkCard` + `NetworkConfig`）
- 列表：名称、私有/公开标签、已授权/总数、管理成员、删除。
- 配置弹窗（玻璃）：名称、私有网络开关、IPv4 分配（**自动 / 关闭** 两档，RFC4193 不在此行）、IPv6 分配（6PLANE / RFC4193 / 自动 / 关闭）、IP 分配池（增删）、路由（CIDR + 网关）、启用 DNS（搜索域 + 服务器列表）、删除网络。
- 新建网络：`newNetworkDraft()` 生成草稿并立即进入配置。

### 3.4 设置（`Settings`）
- 当前管理员（admin）、控制器地址、版本、默认自动分配 IP 开关。
- **修改密码**（`ChangePasswordSheet`）：当前密码 / 新密码（≥6 位）/ 确认新密码；校验当前密码正确、两次一致；成功显示绿勾“密码已更新”并自动关闭。改后新密码生效。
- 退出登录：红色按钮，退回登录门。

---

## 4. 数据模型（刻意对齐 ztncui，便于后续接真实接口）

`src/lib.ts` 中的类型即 ztncui API 形态的映射：
- `Member` ↔ `GET/POST /controller/network/:nwid/member/:id`（name / authorized / ipAssignments / bridge）
- `Network` ↔ `GET/POST /controller/network/:nwid`（private / v4AssignMode / v6AssignMode / ipPool / routes / dns）
- 关键函数：`memberGroup`（unauth/pending/assigned）、`ipInPool`、`nextFreeIp`、`isValidIp`、`ipInUse`、`poolText`、`countByNetwork`。

---

## 5. 真实对接映射
| 现原型（本地态） | 真实接口 / 现状 |
|---|---|
| `login()` 比对本地 creds | ✅ 已实现：后端 `/api/auth/login` 校验 `data/admin.json`，签发 HttpOnly cookie 会话；前端不再持有凭据 |
| `changePassword()` 改本地 | ✅ 已实现：后端 `/api/auth/change-password` 改写 `admin.json` 并使旧会话失效 |
| `rename / assignManual / toggleAuth / toggleBridge` | ✅ 已实现：前端 `saveMember` `POST /api/controller/network/:nwid/member/:id`（后端反向代理到 ZT 控制器，受会话保护） |
| 网络配置各项 | ✅ 已实现：前端 `saveNetwork` `POST /api/controller/network/:nwid`；新建 `createNetworkApi`、删除 `deleteNetworkApi` / `deleteMemberApi` 均已接好 |
| `MOCK_*` 数据 | ✅ 已实现：前端 `lib.ts` 经 `GET /api/controller/network`、`/api/controller/network/:nwid/member`、`/api/controller/peer` 拉取真实数据并派生在线状态，**已彻底移除 mock 数据与 `USE_MOCK` 开关** |

> 控制器代理：后端 `proxy.rs` 将 `/api/controller/<path>` 转发到环境变量 `ZT_CONTROLLER_URL`（默认 `http://host.docker.internal:9993`），并注入 `X-ZT1-Auth: <ZT_TOKEN>`。前端取数层已全面走真实接口（`apiFetch`）。

---

## 6. 已知约定 / 注意
- **首次启动随机密码 + 强制改密**：`DATA_DIR/admin.json` 不存在时，后端随机生成 16 位初始密码（仅含无歧义字符），哈希写入 `admin.json` 并标记 `must_change:true`，**把明文密码打印到控制台 / `docker logs` 一次**（横幅提示）。登录成功后前端读取 `must_change` 立即弹出不可取消的「修改密码」覆盖层，改完才解锁。改密后 `must_change:false` 持久化；`admin.json` 已存在（含旧文件无此字段，默认 false）不再打印横幅、不再强制改密。若初始密码遗失，删除 `admin.json` 重启即可重新生成。
- 会话为内存态（改密时仅失效**其他**会话，保留当前会话以免改密后被踢出）；重启后端需重新登录；凭据存于挂载卷 `DATA_DIR=/data`。
- 玻璃效果依赖 `backdrop-filter`，需现代浏览器；环境压暗仅作用于背景与玻璃，内容卡片保持纯白。
- 删空所有网络属退化态（当前不特殊处理），真实对接后由后端约束。
- 后端监听 `0.0.0.0:${PORT:-3000}`；仅需 HTTP（静态托管 + 反向代理），无外部依赖。

---

## 7. 部署架构（Docker + Rust 单体 + 最小镜像）

### 7.1 整体形态
- **单体二进制**：Rust（axum）服务，把前端 `dist/` 通过 `rust-embed` **编译进二进制**，无需额外静态文件。
- **最小镜像**：`x86_64-unknown-linux-musl` 完全静态链接 + `strip` + `opt-level="z"` + `lto`，最终 `FROM scratch` 只放一个二进制。
- **主机 ZT 服务映射进容器**：容器通过 `ZT_CONTROLLER_URL` 指向宿主机 ZeroTier 控制器（OneMQ/ztncui 的本地 JSON API，通常 `:9993`）。Docker 部署时用 `--network=host` 或 `host.docker.internal` + 端口映射，使容器能访问宿主 ZT 控制器。
- **密钥读取**：不配置 `ZT_TOKEN` 时，后端自动读取 `ZT_TOKEN_FILE`（默认 `/var/lib/zerotier-one/authtoken.secret`）——即把宿主机的 `authtoken.secret` 以只读挂载进容器即可，**密钥不进任何 env / compose 文件**。`ZT_TOKEN` env 优先级高于文件。

### 7.2 目录
```
zt-console-backend/        # Rust 单体
  Cargo.toml  src/{main,auth,proxy,static_files}.rs
  Dockerfile             # 仅 FROM scratch，塞入「构建机原生 musl 交叉编译」产出的静态二进制
  build.sh               # 编排：构建前端 + 同步 dist + cargo build
zt-member-ui/             # 前端（同上）
```

### 7.3 环境变量
| 变量 | 默认 | 说明 |
|---|---|---|
| `ZT_CONTROLLER_URL` | `http://host.docker.internal:9993` | 容器内可达的 ZT 控制器地址 |
| `ZT_TOKEN` | 空（优先级最高） | 控制器 `X-ZT1-Auth` token（env 注入方式） |
| `ZT_TOKEN_FILE` | `/var/lib/zerotier-one/authtoken.secret` | 未设 `ZT_TOKEN` 时读取的密钥文件路径（挂载宿主 secret 文件） |
| `DATA_DIR` | `data` | 管理员凭据持久化目录（容器内建议挂卷 `/data`） |
| `PORT` | `3000` | 监听端口（容器内外均为 3000） |

### 7.4 构建（本网络环境：原生 musl 交叉编译 + scratch）
> 背景：构建机所在网络拉不到 Docker Hub（connection reset），且 ghcr.io 的
> cross-rs 目标镜像只含 C 交叉工具链、不含 cargo。目标部署机为 **x86_64**，
> 故采用「构建机原生交叉编译静态二进制 + FROM scratch」零基础镜像拉取的方案。

# 1) 构建机（wsl）准备 Rust + musl 工具链
rustup target add x86_64-unknown-linux-musl
apt-get install -y musl-tools            # 提供 x86_64-linux-musl-gcc 链接器
# 2) 前端产物放到 crate 内，供 rust-embed 编译期嵌入
cp -r zt-member-ui/dist zt-console-backend/frontend-dist
# 3) 交叉编译完全静态的 musl 二进制（rustls-tls，无 OpenSSL 依赖）
cd zt-console-backend
cargo build --release --target x86_64-unknown-linux-musl
# 4) 打镜像：Dockerfile 仅 FROM scratch 塞入二进制，不拉任何基础镜像
cd <构建上下文根>                       # 含 zt-console-backend/ 与 zt-member-ui/
docker build -f zt-console-backend/Dockerfile -t zt-console:latest .

# 运行（容器内 PORT=3000；宿主用 -p 绑指定 IP，切勿 0.0.0.0）
docker run -d --name zt-console --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e ZT_CONTROLLER_URL=http://host.docker.internal:9993 \
  -e PORT=3000 \
  --add-host host.docker.internal:host-gateway \
  -v zt-console-data:/data \
  -v /var/lib/zerotier-one/authtoken.secret:/var/lib/zerotier-one/authtoken.secret:ro \
  zt-console:latest
```
> 若构建机可直连 Docker Hub，也可改用 messense/rust-musl-cross:x86_64-musl 作 builder
> 阶段（Dockerfile 顶部注释含切换说明）；本方案与之产物一致，仅构建路径不同。

### 7.5 部署到目标机（docker save / load 中转）
构建机与目标机网络隔离时，用「构建机 docker save → 目标机 docker load」搬运镜像
（Mac 等可达两端的机器做管道中转）。已落地示例：构建机 `wsl` → 目标机 `ubuntu@10.88.8.1`。
```bash
# 构建机导出镜像，经中转机管道到目标机加载
ssh wsl 'docker save zt-console:latest' | \
  ssh ubuntu@10.88.8.1 'docker load'
# 目标机用 compose（预构建镜像版）拉起，端口由 ZT_HOST 驱动（默认 127.0.0.1）
# 部署 compose 文件见 ~/zt-console/docker-compose.yml（仅引用已加载镜像，无 build 段）
# 首次随机密码见 `docker logs zt-console`（仅 admin.json 不存在的那次）；改名后不再打印
cd ~/zt-console && ZT_HOST=127.0.0.1 docker compose up -d
# 暴露到管理网：ZT_HOST=10.x.x.x docker compose up -d   （切勿 0.0.0.0）
```
> 端口：目标机 `10.88.8.1` 原 3000 被自带 ztncui 占用，已停掉并禁用 `ztncui.service` 收回 3000，
> 现由 `ZT_HOST`（默认 `127.0.0.1`）驱动绑定，容器内部 3000。如需对外暴露改绑管理网 IP，切勿 `0.0.0.0`。
> 端口映射务必绑定指定 IP（`127.0.0.1` 或管理网 IP），**不要**用 `0.0.0.0:3000:3000`。
> 密钥文件须先存在于宿主 `/var/lib/zerotier-one/authtoken.secret`（ZeroTier 安装后默认即有）。
> 数据卷 `zt-console-data`（external: true）复用，改名 / must_change 状态跨重启保留。
>
> 工作区根 `docker-compose.yml`（含 `build` 段 + `ZT_HOST` 绑定）适用于「同一宿主既能构建又能运行」的环境，
> 需先按 7.4 的 1~3 步产出 `target/.../zt-console-backend` 二进制，再 `docker compose up -d --build`。
> 目标机走的是「预构建镜像」版 compose（无 build 段，引用已 load 的 `zt-console:latest`），二者 `ZT_HOST` 语义一致。
