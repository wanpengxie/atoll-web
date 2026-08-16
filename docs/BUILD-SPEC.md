# web 壳重基 · 施工 spec

施工对象：`/data/agents/atoll-web`（独立仓，外部壳；owner 拍：留此仓、不 embed、自编译自运行）。
设计上游：`web-ui-rebase-design.md`（差距、契约盘点、原则、目标形）。本档只写"怎么做到验收"，不重复为什么。
施工者：codex（或指定 agent）；review：主循环。恒不 commit 到 coagent 主仓；atoll-web 仓内按 owner 令 commit。

---

## 0. 目标与非目标

**目标**：一个人（本周 = root）在浏览器里登录 → 看到自己所在频道 → 读账（含回放与实时）→ @ 成员发言 → 看 agent 回合（临时态/工具活动/终态）→ 答审批 → 看名册。全部只走三张面：身份 HTTP、`/ws` 帧、`/obs`。

**非目标（恒不做，本期）**：workspace；任何 `/api/channels/*` `/api/daemons*`；扩展面板与下载链接；`/files` 渲染；看板/job/接线视图；服务端游标；框架迁移；服务端托管静态页。

## 1. 前置（server 侧，两条——**owner 2026-08-17 定：本期恒不动 atoll/coagent 仓，只动 atoll-web；下表两条本期不做，全部走退路**）

- P1 退路（**2026-08-17 施工中勘误**）：`drivers/agents/base/loop.go` 对 `agent.` 前缀是**闭集**（steer/interrupt/queue/stop/terminate/restart），`agent.text` 会被 `type_unsupported` 拒；其余前缀的 request 一律接受并读 `payload.text`。故本期 client 发 `msg_type:"human.text"`（老壳沿用词），词表 `vocab.js` 单处持有并留 TODO(P1)：server 把 `agent.text` 纳入闭集后只改该处。
- P2 退路：自我识别 = 首次 submit 的 `receipt.message_id` 与随后 feed 中同 `id` 信封的 `sender.id` 对回，记为该频道自我并存 localStorage（`atoll.self.<channel_id>`）；未发过言前，自我未知：@ 候选不排除任何人、未读不排除自己（可接受）。

（下表保留为将来 server 侧小单的备忘，本期不执行。）

| # | 事 | 为什么 | 量 |
|---|---|---|---|
| P1 | 在 `drivers/agents/base/loop.go` 的 `agent.` 前缀 known 集里加 `agent.text`（`TypeText = "agent.text"`），语义 = 普通文本请求（走现有"任意 request 读 `payload.text`"路径，不改行为） | 让 client 与 server 用同一份名字（design §8-3 拍定） | 1 行 + 1 测试 |
| P2 | `/obs/channel/{id}/actors` 的 human 行 declared 里加 `principal`（`channelspec.ObsRosterRow` 加 `Principal string \`json:"principal,omitempty"\``，仅 human kind 填） | client 需要知道"我在本频道的 actor id"（自我识别、@ 排除自己）；今天名册行只有 id/kind/decl_id/name，无法映射 | 一行字段 + 一处填值 + 一测 |

**P2 若 owner 不批**：client 退路 = 首次 submit 后用 `receipt.message_id` 在随后的 feed 里找同 id 的信封，取 `sender.id` 记为本频道自我（localStorage 缓存）。spec 按 P2 批准写；退路在 §4.3 标注。

## 2. 仓布局（目标态）

```
atoll-web/
├── index.html                # 去 Google Fonts 外链
├── vite.config.js            # 代理 /api /ws /obs → ATOLL_SERVER_URL(默认 http://localhost:8832)
├── src/
│   ├── main.jsx
│   ├── App.jsx               # 壳：登录态 → 主布局
│   ├── protocol/
│   │   ├── frame.js          # §3.1 帧信封与闭集（逐字对 subjectgate/frame.go）
│   │   ├── envelope.js       # §3.2 信封字段、kind/visibility/status 代数
│   │   └── vocab.js          # §3.3 type 词表（表驱动，改名只改这里）
│   ├── net/
│   │   ├── identity.js       # §4.1
│   │   ├── obs.js            # §4.2
│   │   └── wire.js           # §4.3 /ws 客户端
│   ├── model/
│   │   ├── cursors.js        # §5.1 频道游标（localStorage）
│   │   ├── fold.js           # §5.2 feed → 频道状态（回合、系统事件、未读）
│   │   └── roster.js         # §5.3 名册缓存 + 自我识别
│   ├── ui/
│   │   ├── Auth.jsx          # 复用现有登录/注册页（改字段）
│   │   ├── ChannelList.jsx
│   │   ├── Timeline.jsx      # 回合卡 / 系统事件折叠 / 审批卡 / 错误行
│   │   ├── Composer.jsx      # @ 补全
│   │   └── Roster.jsx
│   └── styles.css
├── tests/                    # vitest：protocol/、model/ 纯函数
└── README.md                 # 重写
```
**删除**：`api.js` 旧接口全部、`aggregation.js threading.js unread.js notify.js media.js errors.js`、`MyDevicesPage.jsx ChannelDeviceBar.jsx AddDeviceDialog.jsx ExtensionPanel.jsx DeviceCard.jsx`、`.env.example` 旧默认、`dist/`。

## 3. 协议层（纯函数，必测）

### 3.1 `protocol/frame.js`
```js
export const FRAME_VERSION = 2;
export const MAX_FRAME_BYTES = 512 * 1024;
export const UP = { attach:'attach', submit:'submit', resolve:'resolve', cancel:'cancel', after:'after', cancel_timer:'cancel_timer', resource:'resource', observe:'observe', unobserve:'unobserve' };
export const DOWN = { feed:'feed', receipt:'receipt', error:'error', observe_ended:'observe_ended' };
export const ERROR_CODES = ['bad_payload','not_in_audience','unauthorized_sender','already_closed','request_not_found','invalid_decision','unavailable','routing_unavailable','idempotency_conflict','now_member','channel_not_found','channel_unavailable','capability_unavailable','forbidden','closed'];
export const OBSERVE_ENDED = ['now_member','channel_retired','channel_unavailable','capability_unavailable'];
export function frame(type, ref, payload) { /* {v:2, frame_type, ref?, payload?} */ }
export function parseDownstream(text) { /* v≠2 → {kind:'bad_version'}；未知 frame_type → {kind:'unknown', frame}（must-ignore） */ }
```
上行 payload 严格按 design §1.2 表；**不得**发未定义字段（server 严格解码会拒 `bad_payload`）。

### 3.2 `protocol/envelope.js`
- 字段：`id ts ts_received? channel_id sender{kind,id} kind type payload parent_id? correlation_id? visibility audience[] expires_at?`。**只认这些名字，无 casing 兜底。**
- `KIND = {event,request,response}`；`VISIBILITY = {public,system}`（未知值按 public 显示但打 warn）；`SENDER_KIND = {human,agent,tool,system}`。
- status 代数：`FINAL = {completed,failed}`，`PROVISIONAL = {received,queued,processing,deferred,unavailable}`；`isTerminal(env) = env.kind==='response' && FINAL.has(env.payload?.status)`。
- `correlationOf(env) = env.correlation_id || env.id`（与 server `behavior.CorrelationID` 同律）。

### 3.3 `protocol/vocab.js`（表驱动；design §1.4）
```js
export const TYPES = {
  agentText:'agent.text', agentSteer:'agent.steer', agentInterrupt:'agent.interrupt', agentStop:'agent.stop',
  humanMessage:'human.message', humanApprove:'human.approve',
  activity: { turnStarted:'activity.turn.started', turnEnded:'activity.turn.ended', toolStarted:'activity.tool.started', toolEnded:'activity.tool.ended' },
  system: { registered:'system.actor.registered', deregistered:'system.actor.deregistered', forked:'system.actor.forked', ended:'system.actor.ended' },
  sysactor: { introduce:'channel.introduce_actor', remove:'channel.remove_actor', restart:'channel.restart_actor' },
  registrar: { channelCreate:'channel.create', channelList:'channel.list' },
  describe:'describe',
};
export const isActivity = t => t.startsWith('activity.');
export const isSystemNarration = t => t.startsWith('system.');
```
归位表改名时**只改本文件**。

## 4. 网络层

### 4.1 `net/identity.js`
- `login(email,password)` → `POST /api/identity/login` → `{id}`；`register({id?,email,password,display_name?})` → 201 principal row；`logout()`。`credentials:'include'`；错误体 `{code,detail}` → `IdentityError{status,code,detail}`。
- 无 `me`：会话恢复 = 启动时直接尝试 `GET /obs/space/principals`；401 → 登录页；成功则用 localStorage 里上次登录的 principal id 匹配到自己的显示名（登录时把 `{id}` 存下）。

### 4.2 `net/obs.js`
- `spaceChannels(parentId?)`、`spacePrincipals()`、`spaceDaemons()`、`spaceDecls()`、`channelProfile(id)`、`channelActors(id)`。
- 返回原样 `{subject,kind,complete,items[{key,declared,actual}]}`；调用方按 declared 字段读（channels：`id parent_id name qualified_name type status owner_principal created_at`；principals：`id kind email display_name status`；actors：`id kind decl_id name description [principal]`；measures：`bound`、设备在场）。
- 错误：401 → 触发登出；503 → 提示"频道未在服务"，不重试风暴（指数退避 ≤30s）。

### 4.3 `net/wire.js`（核心）
```js
const w = createWire({ url: '/ws', since: () => cursors.snapshot(), onFeed, onError, onObserveEnded, onState });
w.submit({channel_id, msg_type, kind, payload, audience, visibility?, parent_id?, id?}) → Promise<{message_id}>
w.resolve({channel_id, req_id, decision, payload?}) → Promise<{req_id}>
w.cancel({channel_id, req_id}) → Promise<{req_id}>
w.observe(channel_id) / w.unobserve(channel_id) → Promise
w.close()
```
- **连接**：`(wss|ws)://${location.host}/ws`，无 query；cookie 鉴权。open 后**第一帧且仅一次**发 `attach{since}`；收到 `receipt`（ref 匹配）→ `onState('attached', {contract_version})`。attach 之后再发 attach = server 报错，client 侧禁止。
- **ref 关联**：每个上行帧带 `ref = <kind>-<n>`，维护 `pending: Map<ref, {resolve,reject,timer}>`；`receipt` 按 ref resolve（payload 原样），`error` 按 ref reject（`WireError{frame,code,detail}`）；无 ref 的 `error` 走 `onError`。pending 超时 30s reject `{code:'timeout'}`。
- **feed**：`onFeed(channel_id, seq, envelope)`；**client 不按本地订阅集过滤**（连接即人，server 已按 entitlement 推），全收全交给 fold。
- **重连**：close → 清 pending（reject `closed`）→ 退避 `min(30000, 500·2^min(n,6))` → 重连时 `since` 取 cursors 当前快照（回放只补缺）。`onState('reconnecting'|'open'|'closed')` 给 UI 显示连接条。
- **大小**：上行序列化 >512KB 直接拒（本地 `bad_payload`）。

## 5. 模型层（纯函数，必测）

### 5.1 `model/cursors.js`
- `localStorage['atoll.cursor.<channel_id>'] = <max seq seen>`，单调不回退；`snapshot()` → `{ch: seq}`；`advance(ch, seq)`。
- 未读游标另存 `atoll.read.<channel_id>`（用户看到哪）；未读数 = feed 中 `seq > read ∧ visibility!=='system' ∧ sender.id!==self`。

### 5.2 `model/fold.js`
输入：按 seq 递增的 `(channel_id, seq, envelope)` 流。输出每频道：
```
{
  rows: Map<seq, envelope>,                 // 全量（去重按 envelope.id）
  turns: Map<correlation, Turn>,            // 回合
  narration: [ {seq, envelope} ],           // visibility==='system' 或 type∈system.*（折叠区）
  approvals: Map<req_id, envelope>,         // 发给 self 的 human.approve request 且未终结
  lastSeq
}
Turn = { correlation, request: envelope, provisional: [envelope], activity: [envelope], final: envelope|null,
         status: 'open'|'processing'|'completed'|'failed', text: string }
```
规则：
- `kind=request` 且 type∉system.* → 新 Turn（key = correlationOf）。
- `kind=response`：按 `parent_id` 找到 request 的 Turn（找不到 → 归入 correlation 同名 Turn；再找不到 → 孤儿行）；`payload.status` 临时 → push provisional 并置 status；终态 → final，text = `payload.text ?? ''`，failed 时 `text = payload.reason + ': ' + payload.detail`。
- `type` 以 `activity.` 开头的 event → 归入 `correlation_id` 对应 Turn 的 activity（无对应则 narration）。
- `type` 以 `system.` 开头或 `visibility==='system'` → narration。
- 其它 event（如 `human.message` 送达、`svcactor.inbound`）→ 独立行。
- `human.approve` request 且 `audience` 含 self → approvals；收到其终态 response → 移除。
- 去重：同 `envelope.id` 只保留首次；`lastSeq = max`。
- fold 必须可增量（`apply(state, row) → state`），回放 10k 行不卡 UI（批处理 + `requestIdleCallback` 或分帧）。

### 5.3 `model/roster.js`
- `refresh(channel_id)` → `obs.channelActors` → 缓存 `[{id, kind, name, decl_id, principal?, bound, deviceOnline}]`。
- 触发：切频道首次；收到该频道 `system.actor.*` 事件后（去抖 500ms）；手动刷新按钮。**不轮询。**
- 自我：`self(channel_id)` = 名册中 `principal === me` 的 human 行 id（P2）；退路见 §1。
- @ 候选 = 名册中 `id !== self`。

## 6. UI 行为

### 6.1 登录（Auth.jsx 改）
- 表单 email/password；成功后存 `{id}` 到 localStorage，进主界面。注册保留（display_name 可选，密码 ≥8 交给 server 判）。错误显示 `detail`。

### 6.2 频道栏
- 集合 = `spaceChannels()` 里 `status==='present'` ∪ feed 中出现过的 channel_id；显示 `name`（无则 id 前 8 位）、未读徽标；点选切换；当前频道置 `read` 游标为 lastSeq。
- 顶部连接状态条（open/reconnecting/closed）。

### 6.3 时间线（Timeline.jsx）
- 按 seq 渲染；**回合卡**：头 = request（sender 名 + `payload.text`），体 = provisional 状态 chip（queued/processing）+ activity 行（`tool.started/ended`：工具名与状态；`turn.started/ended`），尾 = final 文本（Markdown 轻渲染：段落/代码块/链接，不加库或用极小库）或失败原因（红）。
- **narration**：默认折叠为一行"系统事件 N 条"，展开逐条（type + 主要字段）。
- **审批卡**：`human.approve` request：显示 payload；按钮 [批准]→`resolve{decision:'approve'}`，[拒绝]→`resolve{decision:'reject'}`（decision 字面按 humancell 契约；施工时核 `platform/internal/humancell` 的合法 decision 值，写进 vocab.js）。回执后卡片变灰。
- **错误行**：wire error（有 ref 的关联到发送气泡下方；无 ref 的进顶部条）；code → 中文短语表（`forbidden`→"无权在此发言"、`not_in_audience`→"收件人不在频道"、`unavailable`→"频道暂不可用"…），detail 折叠可见。
- 无乐观回显：发送后本地显示"发送中"占位，收到 receipt 后等 feed 到达替换（按 message_id 匹配），10s 未到显示"已受理但尚未入账"。

### 6.4 编辑器（Composer.jsx）
- 输入 `@` 弹名册候选（排除自我）；发送时 `audience = [选中 actor ids]`。
- **无 @ 时**：若频道名册里恰有一个 agent → 默认 audience 为它并在气泡上标"→ name"；否则拒发并提示"请 @ 一个成员"（server 对 request 要求非空 audience，client 不猜分诊）。
- 发送帧：`submit{channel_id, msg_type:'agent.text', kind:'request', payload:{text}, audience, visibility:'public'}`；对 human 收件人改 `msg_type:'human.message'`；混合收件人拒发（先不做多类广播）。
- Enter 发送，Shift+Enter 换行。
- slash 糖衣（可选，本期只做两个）：`/introduce <class> <name>` → `submit{msg_type:'channel.introduce_actor', kind:'request', audience:[sysactor id], payload:{...}}`（payload 形施工时核 sysactor 契约）；`/channels` → 对 registrar 席位发 `channel.list`。**找 sysactor/registrar 的 actor id 用名册 decl_id/kind=tool 匹配**；不确定就先只做 `/introduce` 或都不做——不阻塞验收。

### 6.5 名册（Roster.jsx）
- 列 name/kind/class(decl_id)/在场（measures：bound + device）；自我行标"我"。

## 7. 验收（DoD）

### 7.1 自动测试（vitest，新增 `npm test`）
- `frame.js`：构造/解析；`v≠2` 拒；未知下行类型 → unknown；上行未定义字段被 lint/测试拦（快照测试）。
- `envelope.js`：status 代数；`isTerminal`；`correlationOf`。
- `fold.js`：给定 12 条样本流（request → queued → processing → activity.tool.started/ended → completed；一条 failed；一条 human.approve；两条 system.actor.*；一条重复 id）→ 断言 turns/narration/approvals/lastSeq 与去重。
- `cursors.js`：单调；快照。
- `wire.js`：用假 WebSocket 断言：首帧 attach 且仅一次；ref↔receipt/error 关联；重连时 since 取快照；pending 在 close 时全部 reject。

### 7.2 手工验收（对真 server，`atoll up`）
1. root 登录（`root@atoll.local`）→ 频道栏出现 c0（与 lobby）。
2. 切到 c0 → 时间线回放历史 → 连接条 open。
3. `@steward 只回复 PONG` → 回合卡出现 queued/processing → final "PONG"。
4. 断开网络/重启 server → 连接条 reconnecting → 恢复后无重复行、无丢行（seq 连续）。
5. 名册显示 root(我)/steward/svcactor/registrar；重启 steward 后（`/introduce` 或 CLI）名册在事件后刷新。
6. 收到一条 `human.approve`（用 CLI/另一 agent 触发）→ 审批卡 → 批准 → 卡片变灰、feed 出现终态。
7. 发给非成员/无权 → 错误行显示中文 + code。

### 7.3 代码卫生
- 仓内 `grep -R "/api/workspaces\|/api/channels\|/api/daemons\|human.text\|subscribe" src` 为空。
- 无 Google Fonts / 外链。
- README 重写：三张面、帧版本 v2、启动方式、`ATOLL_SERVER_URL`。

## 8. 顺序（可并行处）
1. §3 协议层 + 单测（半天）——先于一切，它是 ABI。
2. §4.3 wire.js + 假 socket 测试（半天）；同时 §4.1/4.2（小）。
3. §5 fold/cursors/roster + 单测（半天）。
4. §6 UI（1 天）；先 Timeline+Composer 打通 7.2-3，再名册/审批/错误。
5. 删旧、README、vite 代理（半天）。
6. P1/P2 由主仓另开小单，与 3 并行；P2 未落前用退路。

## 9. 施工纪律
- 每个上行字段名、每个错误码、每个 type 名都必须能在 coagent 主仓里 grep 到出处；spec 与代码冲突以代码为准并回报。
- 不为前端加任何 server 接口（P1/P2 是既有面上的一行字段，且需 owner 点头）。
- 不引入状态管理/UI 大库；React 19 + 原生 fetch/WebSocket + vitest 即可。
- 施工中发现 server 侧缺口（历史回填、error detail 英文等）只记入 review 回报，不擅自补。
