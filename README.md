# atoll-web

Atoll 的独立 React + Vite 浏览器客户端。它不由 server 托管，也不使用工作区、频道消息 REST 接口或其他 UI 专用旁路。

## 客户端契约

客户端只使用三张面：

- 身份 HTTP：`POST /api/identity/register`、`login`、`logout`
- WebSocket：`GET /ws`，帧信封版本 `v: 2`
- 只读观察：`GET /obs/space/*` 与 `GET /obs/channel/{id}/*`

连接打开后第一帧是且只能是 `attach { since }`。历史回放和实时消息都来自下行 `feed`；写消息、审批和频道管理糖衣分别使用 `submit`、`resolve` 等 v2 上行帧。人发给 agent 的文本请求使用 `human.text`。每个频道的最大 `feed.seq` 与已读位置保存在浏览器 `localStorage`。

## 本地启动

要求 Node.js 22+。先启动监听 `8832` 的 Atoll server，然后：

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址。开发服务器会把 `/api`、`/ws` 和 `/obs` 代理到 `http://localhost:8832`。

如 server 使用其他地址：

```bash
ATOLL_SERVER_URL=http://127.0.0.1:9000 npm run dev
```

`ATOLL_SERVER_URL` 只用于 Vite 开发代理，不会进入浏览器 bundle；浏览器始终使用同源路径和 cookie 鉴权。

## 用 mock 跑通

本地 mock 默认监听 `127.0.0.1:8832`，不需要 Atoll server。安装依赖后开两个终端：

```bash
# 终端一
npm run mock

# 终端二
npm run dev
```

打开 Vite 地址，以 `root@atoll.local` / `root` 登录。可用 `ATOLL_ROOT_PASSWORD` 改 mock 密码；测试或并行启动时可用 `ATOLL_MOCK_PORT` 改端口，并把同一地址传给 Vite 的 `ATOLL_SERVER_URL`。

逐条对照 spec §7.2：

1. 登录后频道栏先出现根频道 `c0`，再从它展开出 `lobby`（频道 id 是 `c0.lobby`）。
2. 切到 `c0`，可看到 27 条预置账目折叠成历史回合、系统事件和一张待审批卡；连接状态最终为 open。
3. 输入 `@steward 只回复 PONG` 并从补全菜单选中 steward：回合依次入账 queued、processing、工具 started/ended，终态为 `PONG`。正文包含 `fail` 时终态改为 failed。
4. 浏览器另开同源地址 `/mock/drop`：mock 主动断开所有 WebSocket；壳显示 reconnecting，随后用最新 `since` 恢复且不重复历史。
5. 名册含 root（第一次发送回显后识别为“我”）、steward、system、registrar、svcactor。打开 `/mock/introduce` 会新增 agent 并推 `system.actor.registered`，名册在事件后刷新。
6. 直接批准预置审批，或先打开 `/mock/approve?channel=c0` 推一张新审批卡；批准/拒绝后卡片进入终态。
7. 在编辑器输入 `/channels`：mock 刻意拒绝该 registrar capability，发送占位显示中文错误、`forbidden` code 和可展开的 detail。向原始 v2 socket 提交不存在的 audience/channel 时则分别返回 `not_in_audience` / `channel_not_found`。

`/mock/approve`、`/mock/introduce`、`/mock/drop` 已由 Vite 代理，因此既可在当前站点直接打开，也可访问 `http://127.0.0.1:8832`。mock 历史只在本进程内存中保存，重启会恢复预置状态。

## 验证

```bash
npm test
npm run build
```

测试覆盖 v2 帧构造/解析、信封状态代数、feed fold、游标单调性、带回执/错误/重连的 WebSocket 行为，以及真实启动本地 mock 后的登录、回放、submit、审批和 `since` 续传。

## 目录

```text
src/
├── protocol/   # v2 帧、消息信封与 type 词表
├── net/        # 身份、obs、原生 WebSocket
├── model/      # 游标、feed fold、名册与自我识别
├── ui/         # 登录、频道、时间线、编辑器、名册
├── App.jsx
└── styles.css
tests/          # vitest 纯函数与假 WebSocket 测试
mock/           # Node + ws 的本地契约 mock
```
