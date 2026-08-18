# Atoll Web 产品与系统设计

状态：阶段 D 实现基线
日期：2026-08-17
总计划：[PRODUCT-INTERACTION-MASTER-PLAN.md](PRODUCT-INTERACTION-MASTER-PLAN.md)
当前阶段：[PHASE-D.md](PHASE-D.md)

## 1. 产品定位

Atoll Web 是 atoll 的账本型协作客户端。用户不是在一个临时聊天窗口里等待字符串，而是在频道中以自己的 human Actor 身份提交请求、观察可恢复的处理过程、读取唯一终态并处理发给自己的审批。

三个产品面保持一一对应：

```text
身份面 HTTP       → principal 登录与服务端会话
协作面 WebSocket  → member/observer reader、submit/resolve、feed 账本
观测面 OBS        → 空间结构、频道运行状态、频道名册和其他投影
```

Web 不建立 `/api/channels` 一类旁路管理 API。频道和 Actor 管理仍是向内置 Actor 发送有账本记录的 request。

## 2. 页面信息架构

```text
┌──────────────────┬────────────────────────────────────┬──────────────────┐
│ 频道左栏         │ 当前频道                           │ 频道名册         │
│                  │                                    │                  │
│ 我的频道         │ 标题、SEQ、频道级状态             │ 业务 Actor       │
│ - active         │                                    │ - Agent          │
│ - stale          │ 可恢复的 RequestTurn 时间线        │ - Human          │
│ - unavailable    │ request → provisional/activity     │ - 普通 Tool      │
│                  │         → one terminal             │                  │
│ 空间             │                                    │ 隐藏标准 Actor   │
│ - discoverable   │ 成员 active 时才显示可写编辑器     │ system/registrar │
│ - denied         │                                    │ svcactor         │
└──────────────────┴────────────────────────────────────┴──────────────────┘
```

频道左栏不是 OBS present 列表的直接翻版。“空间中存在”和“当前 principal 是成员”是两件事。

## 3. 权威事实与组合边界

### 3.1 OBS 能回答什么

`GET /obs/space/channels` 提供频道结构、生命周期声明和 `open` measure。它不能证明当前 principal 是成员，也不能证明当前连接可写。

节点 owner 与 well-known `c0` 是 Atoll 启动时共同装配的 root/home 不变式。前端仅对
`profile.id === "c0" && profile.owner_principal === me` 使用这条启动事实，使 c0 首次登录即可进入和写入；
不得把该例外推广到普通子频道。

`GET /obs/channel/{id}/actors` 提供 Actor id、kind、decl_id、展示属性及 bound/device measures。最新真实 atoll 的 human 行不包含 principal，因此不能把第一位 human 或名字相同者猜成自己。

OBS 的 `complete=false` 表示结果不完整。此时缺失不能推导成 retired。

### 3.2 WS 能回答什么

attach 后真实 gateway 自动回放当前 principal 的成员频道，并持续推送 feed。没有本地 active observation 时收到某频道 feed，是当前会话 membership 的强证据。

成功业务 receipt 是成员可写的强证据，但 receipt 不带 seq，也不是账本 cursor。只有 feed.seq 推进读取位置。

### 3.3 Mock-only membership

Mock 暴露 `/obs/space/memberships`，并明确携带 `mock_extension:true`。前端将其作为显式测试证据；真实服务端返回 404 时正常降级到 feed/receipt/self 对账，不报告产品错误。

### 3.4 Lobby

lobby 是未认证注册大厅。root 不是 lobby 成员，已登录协作界面不展示 lobby，也不接收其 feed。

## 4. 频道访问状态

每个频道统一维护：

```text
existence    present | retired | unknown
runtime      open | closed | unknown
relationship member | observer | discoverable | denied | unknown
freshness    fresh | stale | initial
```

组件只消费统一 selector 输出：

| mode | 时间线 | 写入 | 产品位置 |
|---|---|---:|---|
| member_active | 历史+实时 | 是 | 我的频道 |
| member_stale | 本地缓存 | 否 | 我的频道，离线标记 |
| member_unavailable | 本地缓存 | 否 | 我的频道，异常标记 |
| observer_active | 历史+实时 | 否 | 旁观（当前生产不开放入口） |
| observer_stale | 本地缓存 | 否 | 旁观中断 |
| discoverable | 不加载他人账本 | 否 | 空间 |
| access_denied | 本地缓存可解释 | 否 | 空间弱化 |
| retired | 本地归档 | 否 | 不进入协作左栏 |
| loading | 骨架/确认提示 | 否 | 临时状态 |

断线只改变 freshness；频道停服只改变 runtime；forbidden 改变 relationship；完整 OBS 缺失或明确生命周期事件改变 existence。四类事件不能互相代替。

## 5. self Actor 映射

principal 与频道内 human Actor 是不同身份：

```text
principal root
  ├─ c0           → human actor A
  └─ c0.project   → human actor B
```

映射证据优先级：

1. 未来真实 OBS 的 `declared.principal`；
2. Mock membership 的 `actor_id`；
3. Web 在 submit 前生成 message id，登记 `message id → channel`，随后用同 id request feed 的 `sender.id` 学习；
4. 上次会话的持久化映射只能作为 stale 占位。

feed 可以早于 receipt，因此登记必须发生在 `socket.send` 之前。成员撤销、principal 改变或 contract version 不兼容时不沿用旧权威映射。

## 6. 消息与请求状态

### 6.1 两层模型

本地 submission：

```text
transmitting → accepted → landed
            ↘ uncertain ──feed/replay──→ landed
            ↘ rejected
```

账本 RequestTurn：

```text
open
  → received | queued | processing | deferred | unavailable
  → <namespace>.<business-status>
  → completed | failed
```

submission 由 client-generated message id 对账；RequestTurn 由 request id 建立。两者不能混成一个气泡状态。

### 6.2 Fold 主键与乱序

- request id 是唯一回合主键；
- correlation id 可以关联多个 request，只用于业务链组织；
- response/activity 优先用 parent_id，缺失时才按 correlation 找最近相关回合；
- response/activity 先到时暂存，request 到达后归并；
- envelope.id 重放不重复渲染；
- 第一条有效 terminal 是权威终态，后续不同 terminal 记录 `terminal_conflict`；
- terminal 后 provisional 记录 `provisional_after_terminal`，但不重开回合；
- activity.turn.ended 从不关闭 request。

### 6.3 切频道

submission、resolve 和其他异步动作都携带动作创建时的 channel id。active channel 只是视图状态，不能在 Promise 完成时重新读取它作为业务上下文。

## 7. 终态渲染

渲染优先级：

1. Actor/type 专用 renderer；
2. `payload.text` 文本（空字符串显示“返回了空文本”）；
3. registrar 的 `word/value/source`；
4. 通用对象/数组 renderer；
5. 只有协议元字段时显示“已完成”。

failed 同时展示 reason、error_code、detail 和额外结构化诊断。通用 renderer 递归遮蔽 password、secret、token、private_key、key、credential 等字段；复制功能只复制脱敏 JSON。数组默认只展开前 20 项，频道列表使用表格摘要。

## 8. 名册与内置 Actor

普通业务名册隐藏：

- `id=system`；
- `decl_id=atoll-internal:registrar-seat`；
- `decl_id=atoll-internal:svcactor`；
- `decl_id=coreactor`。

管理路由仍从完整名册解析：

| 作用 | 解析方式 |
|---|---|
| 频道内 composition 管理 | 保留 `id=system` |
| c0 registry | `decl_id=atoll-internal:registrar-seat` |
| 普通频道上级 registry | `decl_id=coreactor` |

Actor 实例 id 除 system 外不是稳定契约。`/channels` 在 c0 发给 registrar，在普通频道发给 coreactor。

## 9. 持久化

允许持久化：

- 每频道 feed rows、feed cursor、read cursor；
- member/self 的最后已知 stale 证据；
- 未完成 submission 的 message id、原频道、语义 frame 和状态；
- cancel 的原频道/原 request、accepted/uncertain/error 状态；
- terminal payload 的可恢复脱敏副本；设备 key、token、credential 等敏感值不得持久化。

页面刷新时 transmitting 转为 uncertain；accepted/uncertain 继续等待 attach replay 对账。持久化键按 principal 和版本隔离。cursor 不得超过本地可恢复 rows 的最大 seq。

## 10. Actor 能力与动态调用

OBS 名册只说明 Actor 的声明身份和建议性 presence，不说明它能处理哪些消息。用户点击业务 Actor 后，Web 通过普通 `actor.describe` request 读取 Describe，并从账本重建 `channel + actor` 能力索引。

TypeMeta 统一映射为：request kind 资格、参数 Schema、payload 示例/字段、建议等待时间、结果 Schema、错误码、恢复建议和 notes。动态表单优先使用 JSON Schema，其次 payload_fields/example；无法安全表达的 Schema 降级为原始 JSON object，不能静默丢字段。

能力调用仍使用阶段 B 的 client message id、submission 和 RequestTurn，不建立旁路 API。周期 OBS 刷新可以更新名册，但不能覆盖用户正在编辑的动态表单。

## 11. 长任务与控制

任务级入口由四项事实共同决定：本人是 request sender、回合没有 terminal、频道为 `member_active`、目标 Actor Describe 声明对应控制类型。processing provisional 中的 `turn_id` 是 steer CAS 输入；activity.turn.ended 不是终态。

cancel 是 WS 控制帧：receipt 后只显示“已受理”，原请求的 `cancelled:true` failed terminal 才关闭任务。断线/超时恢复为 uncertain，并以 replay 为准。steer、interrupt、queue、stop、terminate、restart 是独立账本 request，各自展示自己的 provisional 和 terminal。

stop/restart 必须勾选风险确认；terminate 必须输入完整 Actor id。生命周期操作只从 Actor 详情进入，terminal 是动作结果权威，presence 仅作辅助事实。

## 12. 结构化审批

审批卡展示请求方、动作、影响、过期时间和处理者。请求 payload 的 `response_schema|resolve_schema` 可生成输入字段；无 Schema 时使用 JSON object 降级。填写内容随 resolve payload 原样发送。

`expires_at` 只禁用本地决策，不伪造终态。already_closed、request_not_found、not_in_audience、forbidden 保留审批卡和错误事实；外部处理或刷新后由账本 terminal 恢复 settled 状态。

## 13. 频道治理

频道治理是现有账本消息面的产品化入口。c0 的频道 registry 请求发给 registrar seat；普通频道的创建、详情和退役发给当前频道 `decl_id=coreactor` 的实例；composition 请求只发给 `id=system`。UI 不依赖实例 id 猜测内置 Actor。

创建 payload 只包含真实闭集字段 `name/template/overrides`；用途映射到 `overrides.profile.description`。创建进度分别合成 RequestTurn terminal、频道树 OBS、membership 和 open measure，任一投影延迟都保留已完成事实。

human 候选来自 principals OBS，payload 为 `{kind:"human", principal}`；agent/tool 候选来自 declarations OBS，payload 使用 `decl_id`。移除和重启严格使用 `instance_id`。标准/foundation Actor 不显示危险入口，频道 owner 显示但不可移除；后端 `protected_actor` 仍是最终权威。

管理抽屉不替换中间账本。所有治理动作仍在时间线形成独立 RequestTurn；抽屉额外展示“账本确认 → 名册/serving 收敛”，避免 presence 冒充操作成功。

## 14. Mock 设计

Mock 分为协议层、领域层和场景控制层，详见 [MOCK-DESIGN.md](MOCK-DESIGN.md)。阶段 B/C/D 新增：

- real-backend-shape：无 membership 扩展、名册无 principal；
- receipt/feed 分别延迟及业务 receipt 丢失；
- 结构化、空成功、failed、命名空间 provisional；
- terminal 后 provisional、冲突 terminal、重复 feed；
- open、membership、OBS complete 和 lifecycle 控制；
- 相同 id/相同语义幂等，差异语义返回 idempotency_conflict；
- 完整 Describe、结构化订单和动态表单结果；
- 长任务 turn_id、cancel、steer、interrupt、queue 与生命周期终态；
- Schema 审批、过期审批、并发错误和外部处理。
- 频道创建/退役、三类参与者、真实 instance_id 生命周期、投影延迟和权限拒绝。

## 15. 已知真实后端缺口

- 没有显式 principal-channel membership 投影；
- channel actor human 行没有 principal；
- 生产 gateway 未装配 Observer；
- approval resolve Schema 没有统一标准载体；当前兼容 `response_schema|resolve_schema` 并保留 JSON 降级；
- Agent 标准控制 TypeMeta 缺少统一 payload schema/error metadata；当前仅在 Describe 声明类型时使用标准 payload 兼容层；
- stop/terminate/restart 没有统一 provider 状态 OBS，不能用 presence 替代 terminal。
- channel.create 的 introduced 是提交后的部分结果；真实进程装配、设备 placement 和 serving 仍需发布前 smoke。

因此，一个没有历史、不是已缓存成员、也未从当前 Web 发送过 request 的普通成员频道，前端无法仅凭现有真实接口完整发现；首次本人 request feed 前 self Actor 也可能未知。阶段 B 明确呈现“正在确认”，不伪造解决。

## 16. 空间治理、资源、文件与自动化

左栏账户区进入空间管理；频道标题进入资源和定时动作。右栏在名册、频道治理、空间治理、资源和自动化之间切换，中间账本始终保留并占满工作区主列。

Actor/频道模板、overlay、profile/endpoints 和设备命令都通过 Registrar/Coreactor 普通 RequestTurn。空间模板结果从 Registrar list/get terminal 读取；profile 同时展示独立的账本完成与 OBS open 投影。

设备只从 `/obs/space/daemons` 列出。mint/claim key 由发起操作的组件显示一次，普通 renderer 和 feed-cache 双重脱敏；绑定、解绑和退役均先展示影响说明再确认。由于真实后端没有安全 binding list，UI 不伪造绑定清单。

资源面板直接使用 WS resource 帧。KV 支持 create/read/write/delete/stat/list；文件通过控制面 ticket 和 `/files/{address}` HTTP 数据面传输。上传完成的资源可形成附件元数据，消息账本只引用资源，不嵌入字节。

定时动作使用 after/cancel_timer。没有服务端 timer OBS 时，列表明确标记“本设备记录”，只按 principal 持久化 receipt.timer_id；账本出现相同 id 时标记已触发。
