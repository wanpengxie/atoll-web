# Atoll Web 构建规格

状态：阶段 A–E 与前端施工 F1–F6 实现基线
日期：2026-08-18
对应设计：[DESIGN.md](DESIGN.md)、[FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md](FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md)、[FRONTEND-D2-VISUAL-INTERACTION-SPEC.md](FRONTEND-D2-VISUAL-INTERACTION-SPEC.md)
阶段验收：[PHASE-E.md](PHASE-E.md)、[F6-RELEASE-GATE.md](F6-RELEASE-GATE.md)

## 1. 运行与命令

```bash
npm install
npm run mock
npm run dev
npm test
npm run test:browser
npm run test:all
```

默认：Vite `127.0.0.1:5173`，Mock `127.0.0.1:8832`。Vite 只代理 `/api`、`/obs`、`/ws` 和测试控制口 `/mock`。

## 2. 模块边界

```text
src/net/identity.js           身份 HTTP 与会话错误
src/net/obs.js                六类真实 OBS + 可选 Mock membership 扩展
src/net/wire.js               WS v2、ref Promise、attach/reconnect
src/protocol/*                帧与 envelope 闭集、状态词汇

src/model/channel-access.js   四维访问 tracker、selector、持久化
src/model/roster.js           名册投影、self 对账与缓存
src/model/capabilities.js     Describe 解包、合并与能力索引
src/model/dynamic-form.js     Schema 字段模型、typed payload 与 JSON 降级
src/model/task-controls.js    cancel/steer/interrupt 资格与 turn_id
src/model/control-actions.js  cancel receipt 状态的账户级恢复
src/model/management-actors.js 内置管理 Actor 解析
src/model/submissions.js      本地提交状态与持久化
src/model/fold.js             request-id 账本 fold 与 anomaly
src/model/feed-cache.js       feed rows 缓存与恢复
src/model/cursors.js          feed/read cursor 与未读
src/model/workspace-route.js  频道、主视图与稳定对象焦点路由
src/model/artifacts.js        消息附件/派生文件引用与 SourceRef
src/model/channel-files.js    当前频道默认挂载目录与路径投影
src/model/work-items.js       task/approval/agent_run/recovery/automation 索引
src/model/activity.js         可见频道活动、操作与搜索索引
src/model/list-window.js      动态、文件、任务固定 DOM 窗口

src/ui/ChannelList.jsx        我的频道/空间及 mode 标签
src/ui/Timeline.jsx           回合、provisional、activity、terminal、pending
src/ui/StructuredResult.jsx   结构化终态与敏感字段遮蔽
src/ui/ActorDetails.jsx       Actor 能力、动态调用与风险确认
src/ui/Composer.jsx           Tiptap/ProseMirror、本地编辑状态、@、稳定 submit、兼容管理命令
src/ui/Roster.jsx             业务名册与 self 确认状态
src/ui/ArtifactsView.jsx      当前频道挂载目录主视图与消息引用区
src/ui/TasksView.jsx          WorkItem 主视图与固定窗口
src/ui/context/*              文件、回合、任务详情 Context
src/ui/primitives/*           Modal、焦点、选择菜单等共享交互
```

`App.jsx` 是控制器组合入口，不再直接渲染具体产品面板。页面结构由 `app/AppShell.jsx` 组合，覆盖式 Context 路由由 `app/RightPanelHost.jsx` 负责；身份恢复、频道目录、feed 批处理/缓存、提交状态机和本地定时器分别位于 `app/hooks/`。App 不在 JSX 内重新推导权限或回合语义。Composer 的逐字输入不得进入 App state；App 只通过 ref 保存按频道草稿快照，避免驱动 Workspace/Timeline 重渲染。

样式入口仍为 `src/styles.css`，它只按固定顺序聚合 `src/styles/` 下的 tokens、base、auth、app-shell、timeline、composer、roster、primitives、features、runtime 与 responsive 文件。F6 将表面、线条、状态、阴影和圆角集中到 `tokens.css`，继续使用 Atoll 暖色、品牌红与 Agent 蓝。当前产品是 Light-only；暗色主题不属于 F1–F6。

## 3. 协议层

### 3.1 上行帧

所有帧为：

```js
{ v: 2, frame_type, ref?, payload? }
```

submit 字段闭集：

```text
channel_id id msg_type kind payload audience visibility parent_id expires_at_ms
```

每次 Web submit 在调用 wire 前生成 UUID 并写入 `payload.id`。ref 是一次 socket 传输的临时关联键，message id 是业务幂等与 feed 对账键。

### 3.2 下行帧

```text
feed receipt error observe_ended
```

未知 frame type 安全忽略；非法版本/结构进入统一错误。receipt 只 resolve 对应 ref，不推进 cursor。

### 3.3 Envelope

顶层闭集与真实 `protocol/message.Envelope` 一致。终态只有 completed/failed；核心 provisional 是 received/queued/processing/deferred/unavailable；合法 `<namespace>.<name>` 是业务 provisional。

## 4. 频道访问 tracker

`createChannelAccessTracker({principalId,storage,contractVersion})` 必须支持：

```text
channelsObserved(profiles,{complete})
membershipsObserved(rows,{complete,supported})
feed(channelId)
receipt(channelId)
self(channelId,actorId)
forbidden(channelId)
unavailable(channelId,reason)
retire(channelId,reason)
wire(attached|disconnected,epoch)
rows()
snapshot()
```

约束：

- complete=false 不将缺失频道置 retired；
- 普通频道的 owner_principal 不是 membership 证据；唯一例外是节点 owner 对 well-known `c0` 的启动不变式，`c0` 必须作为 root/home 频道显示并可写；
- membership 扩展 404 时 `supported=false`，不清空 feed 推导的 member；
- disconnected 只把 member/observer 变 stale；
- canWrite 仅对 member_active 为真；
- lobby/内部 systemReserved 在 tracker 出口过滤，但 `c0` 即使带 systemReserved 标记也绝不能过滤；
- 持久化恢复的 member 一律 stale。

## 5. self Actor

`createRoster` 的 self 流程：

1. refresh 时若真实/未来 OBS human 行包含 `principal===me`，保存 actor id；
2. submit 前调用 `recordSubmission(channelId,messageId)`；
3. request feed 到达时 `observeFeed` 只接受相同 id、相同 channel、kind=request、sender.kind=human；
4. 保存键包含 principal、channel、contractVersion；
5. membership revoke 调用 `clearSelf`。

不得按 human 行顺序、名称或 principal id 猜 actor id。

## 6. Submission 状态

Submission 结构至少包含：

```js
{
  key: messageId,
  messageId,
  channelId,
  text,
  targetLabel,
  frame,
  state: 'transmitting|accepted|delayed|uncertain|rejected',
  error,
  createdAt,
  updatedAt
}
```

规则：

- setPending 与 roster.recordSubmission 均发生在 wire.submit 之前；
- feed 中出现 messageId 后删除本地 pending，由 RequestTurn 接管展示；
- receipt 先到置 accepted，10 秒只将文案改为 delayed；
- timeout/closed 置 uncertain；明确 error 置 rejected；
- forbidden/unavailable 同时向 channel-access tracker 发事件；
- 页面恢复时 transmitting 变 uncertain；
- 重试复用原 id 和完全相同 frame；
- 所有异步分支使用 submission.channelId，不读取完成时的 activeChannelId。

## 7. Feed fold

ChannelState：

```js
{
  rows: Map<seq,Envelope>,
  turns: Map<requestId,RequestTurn>,
  correlations: Map<correlationId,requestId[]>,
  narration: [], approvals: Map(), standalone: [], orphans: [], anomalies: [],
  lastSeq
}
```

RequestTurn：

```js
{
  requestId, correlationId, request, requestSeq,
  provisional: [{seq,envelope,status,core}],
  activity: [{seq,envelope}],
  terminal, terminalSeq,
  phase, latestStatus, text, lastSeq, anomalies
}
```

处理顺序：

1. 单调推进 lastSeq；
2. envelope.id 去重并检测内容冲突；
3. system visibility/type 进入 narration；
4. request 建立 request-id 回合并归并暂存项；
5. activity 按 parent_id，再按 correlation；
6. response 按 parent_id，再按 correlation；
7. provisional 全量保留；
8. 第一 terminal 关闭回合，后续 terminal 只记 anomaly。

## 8. 结构化终态

`terminalPresentation(requestType,payload)` 返回 text、ack、failed、registrar、describe 或 structured 之一。不得因 completed 缺少 text 而渲染空白。

`redactSensitive` 必须递归处理对象和数组。通用 JSON、复制内容与测试快照都使用脱敏值。频道数组渲染表格；一般数组默认最多展示 20 项摘要；原始脱敏 JSON 放在 details 中。

## 9. 内置 Actor 解析

`resolveManagementActors(rows)`：

```text
system          row.id === 'system'
registrar       row.decl_id === 'atoll-internal:registrar-seat'
coreactor       row.decl_id === 'coreactor'
channelRegistry registrar || coreactor
```

UI 可以隐藏内置 Actor，但 Composer 必须使用完整名册解析。缺失时给出明确错误，不退化到“任意 tool”。

## 10. App 编排

- feed 每批最多 250 行，通过 idle callback/零延迟任务继续处理；
- 每个频道独立 state、cursor、read cursor、roster、pending；
- active channel 只影响显示与 markRead；
- access refresh 每 1.5 秒用于当前阶段的 lifecycle 收敛；
- partial OBS 与失败保留上次状态；
- retired active channel 自动选择下一 member_active，并展示退役提示；
- discoverable/denied 不请求或展示业务名册，不显示可写编辑器；
- closed/timeout 的发送结果展示待确认，并在 replay 对账后展示确认提示。
- 动态、任务、目录文件和消息引用的当前 DOM 投影均不得超过 120 个业务行；翻页不删除账本或目录事实；本地待提交只挂载最近 50 行，诊断只挂载最近 120 行；
- 用户阅读历史时新 feed 不强制滚到底部，而以“新动态”入口恢复最新窗口；
- 文件主视图表示当前频道在所选 daemon 上的默认挂载目录。消息引用/派生文件只作为有 SourceRef 的附加区域，不得解释成跨频道全局产物库；
- 预览在切换或关闭时必须取消请求并释放 Object URL，且按文本 512 KiB、图片 20 MiB、PDF 25 MiB、音视频 50 MiB 做已知大小、Content-Length 和实际数据三层门禁。

## 11. Actor 能力索引与动态表单

`capabilityIndexFromState(state)` 只消费已 fold 的 `actor.describe` RequestTurn：

- `payload.value` 与顶层 Describe 均可解包；
- 完整 Describe 与单类型 Describe 按 actor id 合并；
- 后续失败保留最后成功结果并附 error；
- loading/failed/completed 都由账本重建，不依赖内存 Promise。

`buildFormSpec(type,meta)` 使用 input_schema → payload_fields/example → 已知标准控制 → JSON object 的优先级。`valuesToPayload` 负责 required、number/integer、boolean、enum、object/array 和 JSON 解析。OBS/父组件重渲染不得重置正在编辑的字段。

## 12. 任务控制状态

`taskControlContext(turn, facts)` 返回 canCancel/canSteer/canInterrupt、turnId、expired 和 maxPendingMs。cancel 状态键固定为 `channel_id:request_id:cancel`，按 principal 持久化：

```text
sending → accepted → 原请求 terminal 后删除
       ↘ uncertain ── replay terminal 后删除
       ↘ error（保留稳定 wire code，可重试）
```

刷新时 sending 转 uncertain。steer/interrupt 通过普通 `handleSend` 建立独立 RequestTurn，并把原 request id 写入 parent_id；steer payload 必须带当前 processing.turn_id 作为 expected_turn_id。

## 13. Actor 风险控制与审批

- queue、stop、restart、terminate 只从 Actor 详情调用；
- stop/restart 提交按钮受确认 checkbox 约束；terminate 受完整 actor id 精确匹配约束；
- 审批优先读取 response_schema/resolve_schema，无 Schema 使用 JSON object；
- expires_at 禁用按钮，wire 错误不删除审批卡；terminal 恢复 decision、处理者与结构化 payload。

## 14. Mock

Mock 必须支持：

- 协议字段闭集、真实 OBS JSON 形态；
- member feed 隔离和 root/lobby 隔离；
- receipt/feed/OBS 独立 delay/fault；
- open、membership、retire、OBS complete 控制；
- 文本、结构化、空成功、failed、业务 provisional 和冲突终态；
- system、registrar、coreactor 的真实路由语义；
- 同 id 同语义幂等、不同语义 conflict；
- real-backend-shape 关闭 Mock membership 并移除 actor principal。
- actor-capability 返回完整 TypeMeta 和结构化能力终态；
- long-running/control-conflict 生成可恢复 turn_id、cancel/steer/interrupt/queue 结果与故障；
- actor-lifecycle、approval-schema/expired/conflict 覆盖风险确认和审批边界。
- channel-governance/delay/denied 与 actor-governance 覆盖创建多投影收敛、治理权限、三类参与者和 Actor 生命周期。

## 15. 测试门槛

`npm run test:all` 顺序执行：

1. Vitest：协议、access、roster、submission、fold、renderer、Mock、契约 fixture；
2. Playwright：阶段 A–E、F1–F6、1280/800/600/320、200% 等价窄视口、键盘/焦点/reduced motion 与人工审查后的视觉基线；
3. Vite production build。

发布前还必须通过：

```bash
git diff --check
node -e "JSON.parse(require('fs').readFileSync('contracts/product-capabilities.json','utf8'))"
rg '/api/workspaces|/api/channels|/api/daemons|subscribe' src
```

最后一条应无结果。F6 专项预算与发布证据分别见 [F6-PERFORMANCE-BUDGET.md](F6-PERFORMANCE-BUDGET.md) 和 [F6-RELEASE-GATE.md](F6-RELEASE-GATE.md)。`human.text` 当前是后端已知兼容决策，直到正式 agent 文本 type 在 atoll 闭集归位前不作为卫生失败项。

## 16. 真实服务端最小验证

Mock 不能证明以下真实事实，发布前仍需最小 smoke：

- client id 与 receipt.message_id/feed envelope.id 一致；
- 真实 provisional/activity 的 parent/correlation 形态；
- registrar、system、peer coreactor 的 terminal 包装；
- `channel.create` 的 introduced 部分结果、OBS/membership/open 独立收敛；
- owner/core 退役权限、活动子频道冲突和 retirement 后真实服务停止；
- introduce/remove/restart 的声明解析、placement、protected_actor 与真实 serving 时序；
- 相同 id 幂等与差异语义 conflict；
- 大历史回放及断线 replay 无重复。
- provider 真实 cancel 热路径、steer CAS 并发与生命周期控制；
- 真实 Actor 的 Describe Schema 翻译及审批 payload 约定。
- 真实 daemon 路由、文件落盘和 ticket 跨进程/过期/一次性语义；
- 设备 key 的后端日志与存储生命周期、安全 binding 投影及 attach/detach 收敛；
- 真实 Actor class/config 校验、并发治理权限和 timer 跨端/重启语义。

本地最终真实 Atoll smoke 已证明：全新空间声明 `c0`/`c0.lobby`；浏览器可用 root identity 登录，看到并选中 root 默认频道 `c0`，恢复对应 URL、达到 `OPEN`、启用 Composer 文本框，并在文件主视图看到 `local-device` 与 `daemon://local-device/c0/`。本次没有先 `@` 选择成员并实际提交，因此真实入账、进展和终态闭环仍属于未证明边界；healthz、bearer OBS、WS receipt/contract version 等也没有在这次最终浏览器 smoke 中重新取证。Vite 的 `/ws` 代理必须保留原始 Host，才能通过真实 Atoll 的 Origin/Host 同源检查。

当前真实后端对可选 `/obs/space/memberships` 返回 `400 invalid_args` 且 detail 为 unknown observation kind；前端将该结果与旧版 404 一样识别为“能力不支持”，每个会话只探测一次。root 对 well-known `c0` 的访问来自后端启动不变式，不得泛化为其他频道的 membership。

membership/self 的一般服务端缺口仍在 [PHASE-B.md](PHASE-B.md) 第 5 节明确保留，不以 Mock 通过冒充后端已补齐。单节点 smoke 也不能证明多进程并发、重启持久化、ticket 跨进程/一次性、timer 跨端、真实磁盘、设备 key 生命周期或生产 TLS/反向代理事实。

## 17. 阶段 E：空间、资源与自动化

右栏由单一 `rightPanel` 在名册、频道治理、空间治理、资源与定时动作之间切换。空间级模板/设备命令使用 c0 registrar 名册；overlay/profile 使用来源频道 registrar/coreactor，前端不得把配置旁路成管理 HTTP。

阶段 E 领域模型：

- `space-administration.js`：真实 Registrar 闭集命令、系统声明保护、安全 daemon 投影和 terminal 状态；
- `resources.js`：KV 六类 op、文件地址、ticket 与附件元数据；`list` 不要求 `resource_id`，文件 create 可只带 `address`；
- `timers.js`：after/cancel_timer 字段、本浏览器 timer_id 记录和恢复。

设备密钥只允许在发起 mint/claim 的挂载组件中从当前 terminal 读取一次。普通结构化结果递归隐藏 key；feed-cache 在写 localStorage 前再次递归脱敏；安全列表只读取 `/obs/space/daemons`，禁止调用会序列化 key 的 `device.list`。

文件流程固定为：resource create ticket → HTTP PUT → 会话资源卡；下载为 resource read ticket → HTTP GET。附件只保存 resource_id/address/name/media_type/size，不把字节写入账本。ticket 失效时重新取票，不重复使用已经成功的 PUT ticket。

定时器没有服务端 list/OBS。UI 明示“本设备记录”，按 principal 保存 timer_id；feed 出现相同 timer id 时转为已触发，cancel receipt 后转为已取消。

阶段 E Mock 增加模板、overlay/profile、安全设备、KV、文件字节/ticket 和虚拟定时器的有状态领域数据。状态快照不包含设备 key、ticket 值或文件内容。
