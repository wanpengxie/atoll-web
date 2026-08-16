# atoll-web 测试指南

壳只走 atoll 的三张客户端面：身份 HTTP（`/api/identity/*`）、`/ws` v2 帧、`/obs` 只读。三张面全是确定性的 JSON/帧，因此测试分三层，**都不需要真后端**；真后端只作最后一道对照。

契约的唯一权威在 atoll 主仓（coagent）：`platform/subjectgate/frame.go`（帧与错误码）、`protocol/message/envelope.go`（信封）、`drivers/gateway/portal/portal.go`（HTTP 路由）、`platform/obs/plane.go` + `platform/lagoon/obsview.go` + `platform/channelspec/types.go`（obs 形状）、`protocol/actor/reserved.go`（system 事件）、`registry/activity.go`（activity 事件）、`platform/internal/humancell/humancell.go`（审批 decision 字面值）。发现壳与这些文件不一致，以文件为准。

## 一、单元测试（vitest，`npm test`）

| 文件 | 守什么 |
|---|---|
| `tests/frame.test.js` | 帧信封 v2；`v≠2` 拒；上行 payload 只含闭集字段；未知下行帧类型 must-ignore |
| `tests/envelope.test.js` | 信封字段名；`kind/visibility` 闭集；status 代数（终态 `completed|failed`，临时 `received|queued|processing|deferred|unavailable`）；`isTerminal`；`correlationOf` |
| `tests/wire.test.js` | 首帧 attach 且仅一次；ref↔receipt/error 关联；close 时 pending 全部 reject；重连时 since 取游标快照 |
| `tests/cursors.test.js` | 游标单调；快照 |
| `tests/fold.test.js` | feed → 回合（request + provisional + activity + final）/系统叙事/审批/去重/lastSeq |
| `tests/roster.test.js` | 名册缓存；自我识别退路（receipt.message_id ↔ feed sender.id） |
| `tests/e2e.mock.test.js` | 对 mock server 的端到端：登录 → attach → 回放折叠 → submit → receipt → 回合终态 → resolve 审批 → 断线重连无重复 |

## 二、对 mock server 的手工点验（本地浏览器）

```bash
npm install
npm run mock      # 契约 mock，监听 8832（ATOLL_ROOT_PASSWORD 默认 root）
npm run dev       # 5173，代理 /api /ws /obs → 8832
```
浏览器开 http://localhost:5173，按下表逐条对照（编号对应 spec §7.2）：

| # | 操作 | 期望 | mock 触发口 |
|---|---|---|---|
| 1 | 用 `root@atoll.local` / `root` 登录 | 频道栏出现 c0 与 lobby；顶部连接条 open | — |
| 2 | 点 c0 | 时间线回放预置历史：回合卡（请求→queued/processing→工具活动→终态）、折叠的系统事件区、一张待审批卡 | — |
| 3 | 编辑器输入 `@steward 只回复 PONG` 发送 | 出现"发送中"占位 → 变为回合卡：queued → processing → tool.started/ended → 终态 `PONG`。文本含 `fail` 则终态为红色失败原因 | — |
| 4 | 断线重连 | 连接条变 reconnecting → 恢复 open；时间线**无重复行、无丢行** | `curl localhost:8832/mock/drop` |
| 5 | 名册刷新 | 侧栏出现新成员；无轮询（只在事件到达后拉一次） | `curl localhost:8832/mock/introduce` |
| 6 | 审批 | 新审批卡出现 → 点"批准" → 卡片变灰、时间线出现终态 response | `curl "localhost:8832/mock/approve?channel=c0"` |
| 7 | 错误 | 向不存在的收件人 / 无权频道发送 → 行内中文错误 + code，detail 可展开 | 直接在编辑器里 @ 一个不存在的名字，或发到 lobby 之外的 id |

附加检查：
- 未读徽标：切到 lobby 再触发 `/mock/approve?channel=c0`，c0 上应出现未读数；切回后清零。
- 无 @ 发送：频道里恰一个 agent 时自动指向它并在气泡标 `→ steward`；否则拒发并提示。
- 刷新页面：游标在 localStorage，重开只补缺不重放全量（看 Network 里 attach 帧的 since）。

## 三、对真 server 的对照（可选，需能起 atoll）

同二，把 `npm run mock` 换成 `atoll up`（server 8832 + 本机 daemon），登录用 `--root-password` 设的密码。差异点只应在：真 steward 的回复内容与耗时；系统事件由真实 Introduce/Remove 触发。若出现帧级差异（字段名、错误码、type 名），先查 coagent 对应文件，再改 `src/protocol/*`——**恒不改 mock 去迁就壳**。

已知本期真 server 会拒的一处：人对 agent 的文本请求词用的是 `human.text`（agent base 的 `agent.*` 是闭集，`agent.text` 未纳入）；server 补词后只改 `src/protocol/vocab.js` 一处。

## 四、代码卫生（每次 PR）

```bash
grep -Rn "/api/workspaces\|/api/channels\|/api/daemons\|subscribe\|fonts.googleapis" src index.html   # 应为空
grep -Rn "agent.text" src tests README.md   # 只允许 vocab.js 里那条 TODO
npm test && npm run build
```
