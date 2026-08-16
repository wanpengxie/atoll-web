# web 入口重基：以 atoll 契约为核心，把 atoll-web 接回来

状态：现状盘点（2026-08-17 亲核 server 侧；client 侧由子 agent 逐文件盘点，主循环复核关键项）+ 设计。未施工。
上游：self-dev-entry-week.md §3；docs/dsh/ui-face-and-loop-channel.md Part A（客户端契约三件、官方客户端同门、帧词汇即 ABI）；memory feedback_frontend_no_bypass。
一句话：**server 的客户端面今天只有三张：身份 HTTP、`/ws` 帧、`/obs` 只读；atoll-web 假设的十几条 `/api/...` 数据接口一条都不在。修法不是补接口，是把 client 的数据层按这三张面重写；渲染层可留。**

---

## 0. 差距一眼看

| atoll-web 假设（HEAD 2390fa1，2026-07-14） | atoll 今天（portal 路由表 + subjectgate/frame.go） | 判 |
|---|---|---|
| `POST /api/identity/{register,login,logout}`、cookie `coagent_session` | 同三条；cookie 或 `Authorization: Bearer` 皆可 | ✅ 对得上（login 回 `{id}`，非 `{user}`） |
| `GET /api/identity/me` `GET /api/identity/verification/issue` | 无 | ✗ |
| `GET/POST /api/workspaces`、`/api/workspaces/:id/channels` | 无；频道列表 = `GET /obs/space/channels`（+`?parent_id=`） | ✗ 整条概念（workspace）不存在 |
| `GET /api/channels/:id/messages?after&limit`（历史） | 无；历史 = `/ws` attach `since{ch:seq}` 后 feed 回放 | ✗ |
| `POST /api/channels/:id/messages`（发消息，type `human.text`） | 无；发消息 = `/ws` `submit` 帧（`msg_type`、`audience` 必填语义） | ✗ 且 type 名错 |
| `/api/channels/:id/{members,actors,daemons}`、`/api/daemons*` | 无；名册 = `GET /obs/channel/{id}/actors`；设备 = `GET /obs/space/daemons` | ✗ |
| `/api/channels/:id/files/<path>` | `GET/PUT /files/<address>?t=<ticket>`，票据来自 resource 帧 | ✗ 路径与鉴权皆变 |
| `/ws` v2 `attach{since}` → `feed{channel_id,seq,envelope}` / `receipt` / `error` | 同 | ✅（client 只发 attach，从不发 submit/resolve/observe） |
| envelope 字段读法（id/seq/type/kind/visibility/sender/parent_id/correlation_id/audience/payload.status 代数） | 同（`protocol/message/envelope.go`）；`visibility` 闭集是 `public|system`（client 还认 `private`） | ✅ 基本对，细节修 |
| 三态 casing 兜底（`id|ID`、`seq|Seq`…）、`not_before`/`delivery_failed_at`/`doc_refs` | 信封无这些字段 | 清掉 |
| Chrome 扩展面板、`/downloads/*`、`/install/proxy.sh` | 无 | 删 |
| README 仍写 v1 `subscribe/unsubscribe/message` 帧、vanilla-JS 布局 | — | 重写 |

client 侧另有六个模块（unread/notify/media/threading/errors/aggregation）是**死代码**（无人 import），Chat.jsx 只做扁平列表 + `agent.progress` 折叠 + provisional 卡片。可复用的其实只有：登录页、频道切换壳、provisional/progress 渲染、设备 chip 的视觉。

## 1. atoll 客户端契约盘点（权威，来自代码）

### 1.1 身份（HTTP，`drivers/gateway/portal/portal.go`）
- `POST /api/identity/register {id?,email,password,display_name?}` → 201 principal row + Set-Cookie。
- `POST /api/identity/login {email,password}` → 200 `{"id":"<principal>"}` + Set-Cookie。
- `POST /api/identity/logout` → `{ok:true}`。
- 之后所有口：cookie **或** `Authorization: Bearer <session token>`。
- `GET /healthz`。**无 `me`**（登录返回 id 即身份；显示名从 `/obs/space/principals` 取）。

### 1.2 `/ws`（cookie 鉴权；`platform/subjectgate/frame.go` 是唯一词表）
信封：`{"v":2,"frame_type":…,"ref"?:…,"payload"?:…}`；`v≠2` 拒；单帧 ≤512KB；下行未知帧类型 **must-ignore**，上行未知字段 **拒**（严格解码）。

上行（client→server）：

| frame_type | payload | 回执 |
|---|---|---|
| `attach`（首帧，且只此一次） | `{since?: {<channel_id>: <seq>}}`——**连接即人、channel-blind**：不带频道；since 是多键游标表 | `receipt{contract_version}` |
| `submit` | `{channel_id, id?, msg_type, kind?, payload?, audience?, visibility?, parent_id?, expires_at_ms?}` | `receipt{message_id}`（**不回 seq**；读位置只认 feed.seq） |
| `resolve` | `{channel_id, req_id, decision, payload?}`（答 human.approve 一类的 deferred 请求） | `receipt{req_id}` |
| `cancel` | `{channel_id, req_id}` | `receipt{req_id}` |
| `after` / `cancel_timer` | `{channel_id, duration_ms, msg_type, payload}` / `{channel_id, timer_id}` | `receipt{timer_id}` |
| `resource` | `{channel_id, op∈create|read|write|delete|stat|list, resource_id, args?, target?, ops?, query?{prefix,cursor,limit}, address?, with_content?}` | `ResourceOutcome{status,detail,value,ticket,redeem}` / `ResourceStat` / `ResourcePage` |
| `observe` / `unobserve` | `{channel_id}`（连接局部只读旁听非成员频道） | `receipt{channel_id}`；结束时 `observe_ended{channel_id, reason∈now_member|channel_retired|channel_unavailable|capability_unavailable}` |

下行：`feed{channel_id, seq, envelope}`、`receipt`（ref 回显）、`error{frame, code, detail}`、`observe_ended`。
错误码闭集（平铺一词）：`bad_payload not_in_audience unauthorized_sender already_closed request_not_found invalid_decision unavailable routing_unavailable idempotency_conflict now_member channel_not_found channel_unavailable capability_unavailable forbidden closed`（+ harness 拒写原因原样透传）。

attach 后：server 按 entitlement（所有 present 频道里能 resolve 到该 principal 的）对每个频道从 `since[ch]`（缺省 0）起回放 feed，再实时推——**client 由 feed 学到自己在哪些频道，不需要频道列表接口才能开工。**

### 1.3 信封（`protocol/message/envelope.go`）
`{id, ts, ts_received?, channel_id, sender{kind∈human|agent|tool|system, id}, kind∈event|request|response, type, payload, parent_id?, correlation_id?, visibility∈public|system, audience[], expires_at?}`。
- response 的 payload 里带 `status`：终态 `completed|failed`；临时 `received|queued|processing|deferred|unavailable`；失败带 `reason`/`detail`。`is_terminal = kind==response && status∈{completed,failed}`。
- `type` 语法 `域.区.词`，六域 `core|system|peer|tool|agent|human`（message-type-domains 档）。

### 1.4 UI 必须认识的词（今天实际在跑的名字；§7 归位表说明将改名，client 用表驱动）

| 场景 | 今天的 type / 形 |
|---|---|
| 人对 agent 说话 | kind=request，type **`agent.text`**（归位表补的词；agent base 接受任何 request、读 `payload.text`），`audience=[<agent actor id>]`，payload `{text}` |
| agent 回答 | 同 request 的 response：`{status:"completed", turn_index, text}`；失败 `{status:"failed", reason, detail}`；中途 provisional `status:"processing"` |
| agent 过程 | kind=event：`activity.turn.started/ended{turn_index,status}`、`activity.tool.started/ended{turn_index,tool_call_id,tool,status,detail}`（`registry/activity.go`） |
| agent 控制 | request `agent.steer{text,expected_turn_id?}` `agent.interrupt` `agent.queue` `agent.stop` `agent.terminate` `agent.restart` |
| 对人 | request `human.message`（送达即 completed）；`human.approve`（deferred，人以 `resolve` 帧作答） |
| 膜内管理（对 sysactor） | request `channel.introduce_actor` / `channel.remove_actor` / `channel.restart_actor`（将归 `system.member.*`） |
| 核（对 c0 的 registrar 席位） | request `channel.create/list/get/retire` `principal.register` `decl.*` `device.*`（将归 `core.*`） |
| 系统事件 | event `system.actor.registered/deregistered/forked/ended` 等（`visibility=system` 默认读口抑制） |
| 自省 | request `describe`（introspect.QueryDescribe） |

### 1.5 `/obs`（cookie/Bearer；`platform/obs/plane.go`）
`GET /obs/space/{channels|principals|daemons|decls}`（channels 可 `?parent_id=`），`GET /obs/channel/{id}/{profile|actors}` → `{subject, kind, complete, items[{key, declared, actual{measures[]}}]}`。actors 的 declared = 名册行（actor id、kind、principal、class、bound、device），measures 含 `bound` 与设备在场。

### 1.6 `/files`：`GET/PUT /files/<address>?t=<ticket>`，票据由 `resource` 帧的 outcome 给（`ticket`/`redeem`）。本周不碰。

## 2. 设计原则（从契约与既拍律推出）
1. **同门**：client 只走 1.1/1.2/1.5 三张面；**恒不为 UI 加一条读写旁路**（feedback_frontend_no_bypass）。历史 = feed 回放；发言 = submit；结构 = obs。
2. **帧词汇即 ABI**：`protocol.js` 从 `subjectgate/frame.go` 与 `envelope.go` **逐字**对表，下行 must-ignore、上行严格；不再三态 casing 兜底。
3. **读位置只认 feed.seq**：游标 = 每频道最大 seq，落 localStorage，attach 时作 since；submit 回执只用于"我这条被收了"。
4. **自我 = 名册里的 actor id**，不是 principal id：登录拿 principal，`/obs/channel/{id}/actors` 找 principal==me 的行得本频道 actor id；@ 与"我发的"判断都用它。
5. **管理即对话**：建频道/铸 agent = 向 registrar 席位 / sysactor 发 request，UI 只做 slash 糖衣（`/create-channel`、`/introduce`），恒不开管理 API。
6. **本周只做形 a**（principal 的躯体延伸）：一个人在浏览器里看账、发言、答审批。看板/接线/多主体组合皆不做。

## 3. 目标形（本周版）
```
┌ 频道栏 ─────────┬ 时间线 ─────────────────────────────┬ 侧栏 ───────┐
│ c0  ●3          │ [root] 修 X                        │ 名册        │
│ lobby           │  └ [codex] processing… tool: shell │  root(我)   │
│ dev-1           │  └ [codex] completed: 已开 PR #12   │  steward ●  │
│                 │ [system] steward restarted (折叠)   │  claude ●   │
│ + /create       │ ─── 审批：human.approve ── [批][拒] │ 设备/绑定    │
├─────────────────┴ 编辑器：@steward 修一下 …  [发送]     ┴─────────────┘
```
- **频道栏**：来源 = attach 后 feed 出现过的 channel_id ∪ `/obs/space/channels`；未读 = seq > 本地游标（visibility≠system）。
- **时间线**：按 seq；一条 request 与其 response（parent_id）折成一个"回合"卡：request 文本 → provisional 状态/activity.tool 行 → 终态文本或失败原因；`visibility=system` 默认折叠成一行可展开；activity.* 事件归到所属回合（同 correlation_id）。
- **编辑器**：@ 补全来自名册；无 @ 时按分诊位规则由 server 处理（default_agent），UI 不猜；发 `submit{msg_type:"agent.text", kind:"request", audience:[…], payload:{text}}`。
- **审批**：收到发给我的 `human.approve` request → 卡片带 [批准/拒绝] → `resolve{req_id, decision}`。
- **错误**：`error` 帧按 code 表映射成中文行内提示（不再吞进 console）。
- **侧栏**：`/obs/channel/{id}/actors` 名册（kind/class/在场/绑定设备）；15s 轮询或按 system 事件触发刷新。

## 4. 数据层重写清单（这是全部工作）
| 模块 | 内容 | 量级 |
|---|---|---|
| `identity.js` | 三条 HTTP + 会话恢复（`/obs/space/principals` 换 `me`） | 小 |
| `obs.js` | 四条 space + 两条 channel 观测的 fetch + Observation 解包 | 小 |
| `wire.js` | 帧信封 v2；attach/since；submit/resolve/cancel/observe 发送 + ref→receipt 关联（Promise）；feed 路由；error 帧上抛；重连（指数退避，重放 since） | 中 |
| `protocol.js` | 逐字对表：frame_type/错误码/信封字段/kind/visibility/status 代数/type 词表（§1.4） | 小，重要 |
| `model.js` | fold：按频道聚 feed → 回合（request+responses+activity by correlation/parent）→ 系统事件折叠 → 未读 | 中 |
| `store` | 频道→游标 localStorage；名册缓存 | 小 |
| 组件 | 复用 Auth、Chat 壳、provisional/progress 视觉；新增 @ 补全、审批卡、错误行、名册侧栏；删 workspaces/daemons 页/扩展面板 | 中 |

估：数据层 ~800 行新写，组件改 ~600 行，删 ~2000 行。两到三天。

## 5. server 侧诚实发现（不建，记痛感）
- **无历史回填接口**：attach since=0 全量回放；大频道成本高。将来痛了再议（"最近 N 条"要么 obs 加 history 面，要么 attach 允许负游标）。**本周不建。**
- **无 `me`**：登录回 `{id}` 够用；显示名走 obs。
- 频道列表无"我的"过滤：`/obs/space/channels` 列全部 present；root 无所谓；普通用户靠 feed 集合即可。
- 错误帧 detail 是英文原样，UI 侧表驱动翻译。
- `type` 名将按归位表迁（`agent.text` 是补词，client 用表，改名只改一处）。

## 6. 恒不做（本周）
workspace 概念；任何 `/api/channels/*` `/api/daemons*` 复活；扩展面板；文件渲染（票据流未走通）；看板/job 视图；接线视图；服务端游标；SSR/框架迁移。

## 7. 顺序
1. 起 server + daemon，root 登录，用 `wscat`/curl 走通 attach→feed→submit→receipt（半天，零前端）。
2. 写 `protocol.js` + `wire.js` + `obs.js`，用一个最简页面验证收发（1 天）。
3. `model.js` fold + 时间线/编辑器/审批/名册（1 天）。
4. 删死代码、改 README、`vite.config` 代理三张面（`/api`、`/ws`、`/obs`）（半天）。壳独立编译运行，server 不托管。

## 8. 拍点（owner 2026-08-17）
1. **留在 atoll-web 仓**——它是外部壳，与 server 同门不同仓（拍定）。
2. **不 embed**——壳自己编译、自己跑，server 恒不托管静态页（拍定；§7 第 5 步删除）。
3. `agent.text` 补进 base 显式词表（一行，让 server 与 client 用同一份名字，而非 client 单方面约定）——按倾向执行，owner 未反对。
4. 名册刷新走"收到 `system.actor.*` 事件才拉一次 `/obs/channel/{id}/actors`"，不轮询——按倾向执行。
