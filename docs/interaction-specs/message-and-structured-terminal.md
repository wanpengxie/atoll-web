# 普通消息与结构化终态交互规格

状态：规格基线
日期：2026-08-17
所属能力域：频道协作、Agent 任务、通用请求结果
上级任务：[产品交互总任务](../PRODUCT-INTERACTION-MASTER-PLAN.md)
前置规格：[频道访问状态](channel-access-state.md)
实现状态：阶段 B 已完成；阶段 C 的主动能力面板和任务控制不在本规格本阶段范围

## 1. 用户目标

用户需要在频道中完成一个完整、可信的请求闭环：

1. 输入并发送请求；
2. 知道请求是在发送、已被入口接受、已经入账，还是发送结果未知；
3. 查看排队、处理、等待、工具调用等过程；
4. 得到文本或结构化结果；
5. 理解失败原因和恢复方式；
6. 在断线、延迟、重复 feed 和页面刷新后仍能看到同一个请求的正确状态。

本规格同时解决两类响应：

- 文本响应，例如 Agent 最终返回 `{status:"completed", text:"..."}`；
- 结构化响应，例如 registrar、system actor、actor.describe 返回对象、列表、Schema 或操作结果。

核心裁决：

> 一个请求不是“点发送后出现一个气泡”，而是“客户端提交动作 + 账本中的 request + 任意 provisional process + 唯一 terminal”组成的可恢复状态机。

## 2. 产品入口

本规格适用于：

- 频道底部普通编辑器；
- @ 某个 human/agent 的消息；
- Actor 能力面板发起的结构化请求；
- 频道设置、Actor 管理、模板、设备等专用表单；
- slash 命令的临时兼容入口；
- 审批之外的通用 request/response；
- Agent 任务和控制请求；
- registrar、system actor、coreactor 的管理请求。

本规格不限定具体组件样式，但所有入口必须使用同一套提交状态和账本 fold。

## 3. 非目标

本规格不负责：

- 定义 cancel 的完整交互；
- 定义 human.approve 卡片的专用表单；
- 定义每个 Actor 类型的专用业务结果页面；
- 把所有结构化 JSON 自动转换成完美业务 UI；
- 建立服务端消息历史 HTTP 接口；
- 用 submit receipt 的到达顺序代替 feed.seq；
- 把 activity 当作终态；
- 把连接超时直接解释成后端没有写入。

## 4. 后端协议事实

### 4.1 Submit

客户端通过 WS v2 发送：

```json
{
  "v": 2,
  "frame_type": "submit",
  "ref": "submit-1",
  "payload": {
    "channel_id": "c0",
    "id": "client-generated-message-id",
    "msg_type": "human.text",
    "kind": "request",
    "payload": {"text": "你好"},
    "audience": ["agent-id"],
    "visibility": "public",
    "expires_at_ms": 0
  }
}
```

成功 receipt：

```json
{
  "message_id": "client-generated-message-id"
}
```

receipt 只证明入口接受了写入，并返回消息身份。它不包含 seq，也不能推进读取游标。

### 4.2 Feed

账本事实通过 feed 到达：

```json
{
  "channel_id": "c0",
  "seq": 42,
  "envelope": {
    "id": "...",
    "channel_id": "c0",
    "sender": {"kind": "human", "id": "..."},
    "kind": "request",
    "type": "human.text",
    "payload": {"text": "你好"},
    "visibility": "public",
    "audience": ["agent-id"]
  }
}
```

只有 feed.seq 是读取位置。receipt、message id、时间戳都不能充当 cursor。

### 4.3 Response

response 通过 `parent_id` 指向 request id，并继承或建立 correlation：

```json
{
  "kind": "response",
  "parent_id": "request-id",
  "correlation_id": "correlation-id",
  "type": "human.text",
  "payload": {
    "status": "completed",
    "text": "完成"
  }
}
```

协议终态闭集只有：

- `completed`；
- `failed`。

核心 provisional 闭集：

- `received`；
- `queued`；
- `processing`；
- `deferred`；
- `unavailable`。

协议还允许命名空间形式的业务 provisional，例如 `<namespace>.<name>`。客户端不能因为它不在核心五值中就把它当作孤儿或终态；应按“未知但非终态的业务状态”展示并保留原值。

### 4.4 终态唯一性

一个 request 最多有一个有效 terminal。可能出现：

- 多个 provisional；
- provisional 与 activity 交错；
- terminal 后因竞态到达重复/过晚 provisional；
- 网络重放导致客户端再次收到已经处理过的 envelope。

客户端必须按 envelope.id 去重，并以第一条有效 terminal 作为请求关闭事实。后续冲突 terminal 记录为契约异常，不覆盖第一条终态。

### 4.5 Failure

失败终态通常包含：

```json
{
  "status": "failed",
  "reason": "receiver_internal_error",
  "error_code": "type_unsupported",
  "detail": "..."
}
```

协议级 terminal reason：

- `unanswered_timeout`；
- `receiver_unavailable`；
- `receiver_internal_error`。

Actor 自身的具体错误放在 `error_code`，恢复提示可能来自 actor.describe 的 error metadata。

### 4.6 Process progress

Agent 的 turn、stage、tool 过程统一写成所属 request 的 provisional response：

- top-level `status` 保持合法 provisional 状态；
- `payload.process.kind` 为 `turn|stage|tool`；
- Tool 通过 `phase=started|ended` 与 `tool_call_id` 配对；
- Tool 自身结局写在 `process.outcome=completed|failed`，不关闭 RequestTurn；
- input/output 保留原始 JSON，不从中推断消息树。

完整形状、Agent 调用树和进度隔离律见 `../REQUEST-TURN-PROGRESS-PROTOCOL.md`。

## 5. 两层状态模型

必须区分“客户端提交动作”和“账本请求回合”。

### 5.1 客户端提交状态 `submission`

| 状态 | 含义 |
|---|---|
| `composing` | 尚未发出 |
| `transmitting` | frame 已交给 WebSocket，等待 receipt/error |
| `accepted` | 收到 submit receipt，但 request feed 尚未落到本地 |
| `landed` | 已在 feed 中看到同 id request |
| `uncertain` | receipt 超时或连接中断，不能确定服务端是否接受 |
| `rejected` | 收到明确 error，服务端没有接受本次提交 |

submission 是客户端临时状态，可以在 request landed 后折叠进账本回合。

### 5.2 账本回合状态 `turn`

| 状态 | 含义 |
|---|---|
| `open` | request 已入账，尚无 provisional/terminal |
| `received` | receiver 已确认收到 |
| `queued` | 已进入队列 |
| `processing` | 正在执行 |
| `deferred` | 等待外部条件或人工动作 |
| `unavailable` | 当前不可处理，但请求尚未由 terminal 关闭 |
| `business_provisional` | 非核心命名空间 provisional |
| `completed` | 唯一成功终态已入账 |
| `failed` | 唯一失败终态已入账 |

不能把所有 provisional 统一改写成 processing。UI 可以在视觉上归入“进行中”，但模型必须保留原始 status 和顺序。

### 5.3 整体用户可见状态

```text
composing
  → transmitting
     → rejected
     → uncertain ──(feed 对账)──→ landed/open
     → accepted ──(feed 到达)──→ landed/open
                                  → received/queued/processing/deferred/unavailable
                                  → completed
                                  → failed
```

receipt 与 request feed 可能任意先后到达。模型必须支持：

- feed 先到、receipt 后到；
- receipt 到达、feed 延迟；
- receipt 丢失但 feed 已入账；
- receipt timeout 后重连回放发现 request；
- 明确 error 后不得再把同一次本地 submission 当作 accepted；如果 feed 中出现同 id，记录契约异常并以账本事实展示。

## 6. 客户端生成消息 ID

产品裁决：所有 Web submit 必须在发送前生成稳定的 message id，并填写 `payload.id`。

原因：

- receipt 超时不等于服务端未写入；
- 有客户端 id 才能在重连 feed 中对账；
- 可以安全展示 uncertain，而不是丢失本地气泡；
- 重试时可以使用同一个 id 和相同语义 payload，依赖后端幂等判断；
- pending UI 不依赖 receipt 才获得 message id。

建议本地 submission key 与 message id 使用同一 UUID，ref 仍是一次传输动作的临时编号。

重试规则：

- 只有原始语义字段完全相同时才复用同一 message id；
- 用户修改文本、audience、payload、expires_at 后必须生成新 id；
- `idempotency_conflict` 表示同 id 对应不同语义，必须停止自动重试并报告；
- uncertain submission 重连后先等待 feed 对账，再允许用户主动重试；
- 不进行无限自动 submit 重试。

## 7. 回合数据模型

建议每个频道维护：

```js
{
  rowsBySeq: Map<number, Envelope>,
  envelopeIds: Set<string>,
  requestsById: Map<string, RequestTurn>,
  correlations: Map<string, string[]>,
  pendingSubmissions: Map<string, Submission>,
  standaloneEvents: [],
  systemNarration: [],
  anomalies: [],
  lastSeq: 0
}
```

`RequestTurn`：

```js
{
  requestId: '',
  correlationId: '',
  request: null,
  requestSeq: 0,
  provisional: [
    {seq, envelope, status, core: true}
  ],
  activity: [
    {seq, envelope}
  ],
  terminal: null,
  terminalSeq: 0,
  phase: 'open|received|queued|processing|deferred|unavailable|business_provisional|completed|failed',
  latestStatus: '',
  lastSeq: 0,
  anomalies: []
}
```

### 7.1 主键规则

- request id 是一个回合的权威主键；
- response 优先使用 `parent_id` 找 request；
- activity 优先使用 `parent_id` 找 request；
- correlation_id 用于组织同一业务链或辅助恢复，不是唯一 request 主键；
- 一个 correlation 允许关联多个 request，不能使用 `Map<correlation, one turn>` 覆盖前一个请求；
- request 自身缺少 correlation_id 时，以 request.id 作为 correlation fallback。

这比当前“一个 correlation 对应一个 turn”更稳健，尤其适用于 steer、控制请求和跨 Actor 业务链。

### 7.2 未到达 request 的暂存

如果 response 在本地先于 request 被处理：

- 暂存到 `unmatchedByParent` 或 `unmatchedByCorrelation`；
- request 到达后重新归并；
- 不立即永久归类为 orphan；
- 一轮 feed batch 或恢复窗口结束后仍无法匹配，再展示为独立诊断项；
- 不因孤儿项阻塞 cursor 前进。

## 8. Fold 规则

### 8.1 通用入口

处理每个 feed row 时：

1. 校验 channel_id 与当前 channel state 一致；
2. 将 `lastSeq` 单调推进到 feed.seq；
3. envelope.id 已见过时不重复渲染，但仍保留 cursor 推进；
4. envelope id 首次出现时存入 rowsBySeq；
5. 按 kind/type/visibility 分派；
6. 尝试与 pending submission 对账；
7. 更新 unread 和持久化脏标记。

### 8.2 Request

- 建立或补全 `requestsById[envelope.id]`；
- request 已存在且内容相同：视为重放；
- request 已存在但内容不同：记录 `message_id_content_conflict`；
- 将 pending submission 从 accepted/uncertain 更新为 landed；
- 尝试归并之前暂存的 response；
- request type 为 system.* 或 visibility=system 时进入 narration，不进入普通回合列表；
- human.approve 的专用渲染由审批规格覆盖，但底层仍是 RequestTurn。

### 8.3 Provisional response

- 必须有 parent_id，优先归入对应 request；
- 保留每条 provisional 的原始 status、payload 和 seq；
- 核心状态按原值更新 phase；
- 命名空间扩展状态更新为 business_provisional，并把原值放进 latestStatus；
- terminal 已存在时，后到 provisional 不改变 phase，记录 `provisional_after_terminal`；
- 多条相同 status 不去重，除非 envelope.id 重复，因为它们可能包含不同进度数据。

### 8.4 Final response

- `completed|failed` 才能关闭 request；
- 第一条 terminal 成为权威 terminal；
- 后续同 id 是网络重放，忽略；
- 后续不同 id terminal 记录 `terminal_conflict`，不覆盖第一条；
- completed 不要求存在 text；
- failed 不要求只存在 reason/detail，必须保留完整结构化 payload；
- terminal 后保留先前 provisional process，用于展开过程记录。

### 8.5 Process progress

- process response 不建立独立 request；
- 先按 parent_id 匹配，再按 correlation_id 匹配最近仍打开或相关的 request；
- tool started/ended 按 tool_call_id 配对，但原始 response 都保留；
- 同一个 tool_call_id 的 ended 无 started 时仍展示，并记录 `tool_start_missing`；
- process 不关闭 RequestTurn；
- process 无法匹配时进入诊断区，而不是伪造普通消息。

### 8.6 普通 event

- 非 system、非 activity 的 event 作为独立账本条目；
- payload.text 存在时按文本展示；
- 否则使用结构化 payload renderer；
- event 没有 terminal 状态，不展示“等待回复”。

## 9. 结构化终态渲染

### 9.1 渲染优先级

completed terminal 按以下顺序选择 renderer：

1. 已注册的 type-specific renderer；
2. payload.text 为字符串 → Markdown/text renderer；
3. payload.value 存在且请求属于 registrar/coreactor → registrar value renderer；
4. 除协议元字段外存在业务字段 → generic structured renderer；
5. 没有业务字段 → completion acknowledgement“已完成”。

协议元字段：

```text
status
reason
error_code
detail
cancelled
closed_by
```

不能因为没有 `text` 就把 successful terminal 渲染为空白。

### 9.2 Generic structured renderer

第一版至少支持：

- 标量：键值行；
- 对象：可折叠属性树；
- 数组：数量摘要 + 列表/表格；
- 深层对象：默认折叠，并提供格式化 JSON；
- 空对象：显示“已完成”；
- 超大结果：只渲染摘要，展开时分块；
- 复制 JSON；
- 字段名保持后端原名，不做不可逆转换。

### 9.3 Registrar 结果

registrar 的 terminal 可能包含：

```json
{
  "status": "completed",
  "word": "channel.list",
  "value": [...],
  "source": {
    "channel_id": "c0",
    "request_id": "..."
  }
}
```

展示规则：

- `word` 作为操作类型；
- `value` 是主要业务结果；
- `source` 默认折叠到“调用来源”；
- channel list 优先表格化 id/name/qualified_name/status/open；
- channel create 优先展示新频道名称、id、parent、introduced 结果；
- generic renderer 必须作为未知 registrar word 的 fallback。

### 9.4 Actor.describe 结果

第一版 type-specific renderer 应展示：

- actor description；
- skill_doc；
- types 列表；
- 每个 type 的 description；
- allowed_kinds；
- max_pending_ms；
- payload example/fields/input schema；
- output schema；
- error codes 和 recovery；
- notes。

actor.describe 结果还应进入能力缓存，但时间线仍保留可展开的原始终态。

### 9.5 Operation result

system actor 常见结果：

```json
{"status":"completed","instance_id":"...","created":true}
{"status":"completed","removed":true}
{"status":"completed","restarted":"actor-id"}
```

UI 应显示人类可读摘要，同时允许展开原始字段。

### 9.6 敏感字段

通用结构化 renderer 默认遮蔽疑似敏感字段：

```text
password
secret
secret_hash
token
access_token
refresh_token
private_key
key
credential
```

规则：

- 默认显示“已隐藏”；
- type-specific renderer 可以对“只展示一次”的正式 secret 输出作显式例外；
- 未经专用规格批准，generic renderer 不提供一键显示所有 secret；
- 日志和测试快照必须使用脱敏值；
- feed cache 的敏感数据问题最终需要后端安全投影解决，前端遮蔽不是安全边界。

## 10. 文本渲染

文本响应：

- payload.text 是字符串时展示；
- 支持段落、代码块、安全链接和基础列表；
- 不执行 HTML；
- 链接使用安全 target/rel；
- 超长文本分段渲染；
- 空字符串与字段缺失不同：空字符串显示“返回了空文本”，字段缺失走结构化 fallback。

请求文本：

- 优先 payload.text；
- 没有 text 时显示结构化请求摘要；
- slash 命令不能成为唯一可读描述，应保留真实 msg_type 和 payload；
- audience 显示解析后的成员名，无法解析时保留 actor id。

## 11. Provisional 与 Process UI

### 11.1 核心状态文案

| status | 中文语义 | 默认视觉 |
|---|---|---|
| received | 已收到 | 中性 |
| queued | 排队中 | 等待 |
| processing | 处理中 | 活跃 |
| deferred | 等待后续条件 | 需要关注 |
| unavailable | 暂时不可处理 | 警告但非终态 |

### 11.2 展示方式

- 回合卡标题展示最新状态；
- 展开“过程记录”可看到全部 provisional process；
- 不删除重复但不同 id 的状态；
- business provisional 显示原始 status 和结构化 payload；
- tool started/ended 使用 tool_call_id 配对；
- tool failed 显示 detail，但不自动把 request 判为 failed；
- interrupt 过程也等待正式 terminal；
- terminal 到达后过程区默认折叠，仍可展开。

### 11.3 预计等待时间

如果 actor.describe 为请求 type 提供 max_pending_ms：

- 可以展示“预计最长等待”；
- 不能把该值自行当作请求 deadline；
- 真正过期以 envelope.expires_at 和最终 terminal 为准；
- 超过提示时间但没有 terminal 时显示“耗时超出预期”，不能伪造 failed。

## 12. 失败终态 UI

失败摘要优先级：

1. error_code 对应的 type-specific 中文说明；
2. terminal reason 对应的中文说明；
3. detail；
4. “请求失败”。

建议文案：

| reason | 中文摘要 |
|---|---|
| unanswered_timeout | 请求在截止时间前没有得到最终响应 |
| receiver_unavailable | 接收方已不可用 |
| receiver_internal_error | 接收方处理失败 |

恢复动作来自错误类型：

- retryable：允许“重试为新请求”；
- type_unsupported：打开 Actor 能力列表；
- payload_invalid/bad_payload：返回编辑并保留输入；
- unavailable：等待/刷新 Actor 状态；
- cancelled terminal：显示“已取消”，不建议普通重试；
- timeout：允许复制为新请求，但保留原失败记录。

失败 payload 中除协议字段之外的结构化诊断仍可展开。

## 13. Pending、延迟和不确定状态

### 13.1 Transmitting

- 显示本地请求摘要；
- 禁止重复点击同一提交按钮；
- 允许用户继续浏览其他频道；
- submission 绑定原始 channel id，切频道不能改变它。

### 13.2 Accepted but not landed

- 文案：“已受理，等待入账”；
- 使用 message id 等待 feed；
- 不能凭 receipt 创建伪造 seq；
- 10 秒等阈值只改变提示，不改变事实状态；
- 重连后继续通过 message id 对账。

### 13.3 Uncertain

触发条件：

- receipt timeout；
- socket 在 send 后、receipt 前关闭；
- 客户端无法判断 frame 是否到达服务端。

产品行为：

- 文案：“发送结果待确认”；
- 不直接显示“发送失败”；
- 保留 client-generated message id；
- 重连回放时自动对账；
- 提供“检查频道”和受控重试；
- 如果后续 feed 出现同 id，合并为 landed；
- 如果明确 error 与 ref 对应，则进入 rejected，而不是 uncertain。

### 13.4 Rejected

- 与本地 submission 关联显示；
- 不进入账本回合，除非 feed 中真的出现同 id；
- 保留用户输入用于修改；
- 根据错误提供重试、重新选 audience 或刷新频道状态；
- forbidden 同时触发频道访问状态收敛。

## 14. 切频道、刷新与持久化

### 14.1 切频道

- pending submission 始终属于发送时 channel id；
- 切换 active channel 后 receipt/feed 仍更新原频道；
- resolve/控制操作不得使用点击时已经变化的全局 activeChannelId，必须携带对象自己的 channel id；
- 每频道独立保存 turn、cursor、read cursor 和 pending 对账信息。

### 14.2 页面刷新

持久化：

- 已 fold 的 feed rows 或可重建 state；
- 每频道 cursor；
- 未完成 submission 的 message id、channel id、语义 fingerprint 所需字段和状态；
- 已知 request turn；
- renderer 所需原始 terminal payload。

不持久化：

- WebSocket ref；
- 旧连接 pending Promise；
- 组件局部 loading 状态；
- 明文敏感表单输入。

刷新后：

- transmitting 一律转 uncertain；
- accepted 保持 accepted，等待 attach replay 对账；
- landed/open 从 feed cache 恢复；
- cursor 不得超过本地可恢复的最大 seq；
- contract version 不兼容时丢弃无法解释的 fold cache，并从安全 cursor 重放。

## 15. 异常和诊断

客户端必须容忍并记录：

| anomaly | 行为 |
|---|---|
| duplicate_envelope_id | 不重复渲染，cursor 继续 |
| message_id_content_conflict | 保留第一条，报告严重契约异常 |
| response_parent_missing | 暂存，等待 request |
| activity_parent_missing | 暂存或诊断区 |
| terminal_conflict | 保留第一终态，报告严重异常 |
| provisional_after_terminal | 不重开请求，记录过程异常 |
| unknown_provisional | 保留原值并展示 |
| unknown_visibility | 按 public 安全展示并告警，沿用现有协议策略 |
| malformed_payload | 显示原始摘要，不让整个时间线崩溃 |
| seq_gap | 不自行补造消息，记录并等待重连/回放 |
| seq_regression | 不回退 cursor，报告异常 |

诊断默认不打扰普通用户；开发模式和错误详情中应能看到 channel、seq、envelope id、type 和 anomaly code。

## 16. Mock 规格

### 16.1 Mock 提交状态

Mock 必须把以下步骤独立调度：

```text
receive frame
validate frame
send receipt/error
append request to ledger
broadcast request feed
append provisional process
append terminal
broadcast subsequent feed
```

每个步骤可配置延迟或故障，不能再把 receipt、append 和所有响应固定捆在一个同步函数里。

### 16.2 必备响应模板

#### 文本成功

```json
{"status":"completed","turn_index":1,"text":"PONG"}
```

#### 空文本成功

```json
{"status":"completed","text":""}
```

#### 通用结构化成功

```json
{"status":"completed","instance_id":"agent-1","created":true}
```

#### Registrar 包装结果

```json
{
  "status":"completed",
  "word":"channel.list",
  "value":[{"id":"c0","name":"c0","status":"present"}],
  "source":{"channel_id":"c0","request_id":"req-1"}
}
```

#### Actor describe

```json
{
  "status":"completed",
  "actor_id":"agent-1",
  "description":"Mock Agent",
  "types":{
    "human.text":{
      "description":"接受文本任务",
      "allowed_kinds":["request"],
      "max_pending_ms":30000,
      "input_schema":{"type":"object","properties":{"text":{"type":"string"}}}
    }
  }
}
```

#### 失败

```json
{
  "status":"failed",
  "reason":"receiver_internal_error",
  "error_code":"type_unsupported",
  "detail":"actor does not support this type"
}
```

### 16.3 首批 Mock 场景

#### `message-text-success`

- request feed；
- queued；
- processing；
- tool started/ended；
- completed text。

#### `message-structured-success`

- completed 无 text；
- 包含对象和数组；
- UI 显示结构化结果而不是空白。

#### `message-empty-success`

- completed 只有 status；
- UI 显示“已完成”。

#### `message-failed`

- processing 后 failed；
- reason、error_code、detail 全部存在；
- UI 显示摘要和恢复动作。

#### `receipt-delayed`

- request feed 先于 receipt；
- pending 与 request 正确合并；
- receipt 后不产生第二条气泡。

#### `feed-delayed`

- receipt 立即返回；
- request feed 延迟；
- UI 先 accepted，再 landed。

#### `receipt-lost-feed-landed`

- 不返回 receipt；
- request 实际入账；
- 客户端先 uncertain；
- 重连 feed 对账后变 landed。

#### `receipt-timeout-no-write`

- frame 结果未知且最终没有 feed；
- UI 保持 uncertain；
- 用户可受控重试同 id/同 payload。

#### `idempotent-retry`

- 同 id、同语义重试；
- 返回同一 message identity，不重复入账。

#### `idempotency-conflict`

- 同 id、不同 payload；
- 返回 idempotency_conflict；
- UI 停止自动重试。

#### `business-provisional`

- 插入 `provider.waiting` 一类命名空间 provisional；
- UI 保留原值且不结束请求。

#### `provisional-after-terminal`

- terminal 后插入迟到 processing；
- UI 不重开请求。

#### `duplicate-feed`

- 同 envelope id 重复发送；
- 时间线只显示一次，cursor 单调。

#### `terminal-conflict`

- 同 request 两个不同 terminal id；
- 第一终态保持，开发诊断出现异常。

#### `response-before-request`

- 测试调度层先把 response 交给前端，再交 request；
- request 到达后正确归并。

#### `activity-before-request`

- activity 暂存；
- request 到达后归入过程记录。

#### `channel-switch-pending`

- 在 c0 发送后立即切到另一个频道；
- receipt/feed 更新 c0，不污染当前频道。

#### `large-structured-result`

- 数百行数组；
- UI 使用摘要/分块，不阻塞主线程。

### 16.4 Mock 控制口

```text
POST /mock/control/set-receipt-delay
POST /mock/control/set-feed-delay
POST /mock/control/drop-next-receipt
POST /mock/control/drop-websocket-after-send
POST /mock/control/push-provisional
POST /mock/control/push-terminal
POST /mock/control/replay-envelope
POST /mock/control/inject-terminal-conflict
```

控制结果必须返回 message id、channel id、当前 ledger seq 和调度步骤，方便浏览器测试诊断。

## 17. 浏览器验收

### 17.1 文本成功

1. 在 member_active 频道向 Agent 发送文本。
2. 本地立即显示 transmitting。
3. receipt 后显示 accepted；feed 已先到时可以直接 landed。
4. request feed 到达后只保留一个请求卡。
5. queued、processing 按原状态显示。
6. tool started/ended 可展开。
7. completed 文本展示 Markdown。
8. 刷新页面后回合仍完整且不重复。

### 17.2 结构化成功

1. 发起 channel.list 或等价 Mock 请求。
2. terminal 不包含 text。
3. 页面显示操作名称和频道结果表格/结构树。
4. 可以展开原始 JSON。
5. 不出现空白 ANSWER 区域。

### 17.3 Actor describe

1. 对 Actor 发 actor.describe。
2. 终态显示 description、types、Schema 和错误码。
3. 结果进入能力缓存。
4. 时间线仍可查看原始终态。
5. 未识别字段不会导致渲染失败。

### 17.4 Receipt 先到、feed 延迟

1. 设置 feed 延迟 10 秒。
2. receipt 后显示“已受理，等待入账”。
3. 不能凭 receipt 推进 feed cursor。
4. feed 到达后原 pending 合并进 request card。
5. 页面只出现一个用户请求。

### 17.5 Feed 先到、receipt 后到

1. 设置 receipt 延迟。
2. request feed 先出现时 pending 立即合并。
3. receipt 后不增加第二条记录。
4. submission Promise 完成不改变 request seq。

### 17.6 发送结果不确定

1. send 后、receipt 前断开 WS。
2. UI 显示“发送结果待确认”，不是“发送失败”。
3. 重连 attach 使用 cursor 回放。
4. 若同 id request 出现，自动合并为 landed。
5. 若没有出现，用户可选择重试。
6. 重试保持同 id 和相同 payload。

### 17.7 失败终态

1. 先收到 processing。
2. 后收到 failed reason/error_code/detail。
3. 回合保持已关闭。
4. 显示中文错误摘要。
5. detail 和结构化诊断可展开。
6. 不因任何 process progress 提前关闭。

### 17.8 命名空间 provisional

1. 注入未知但合法的 `provider.waiting`。
2. 回合仍是进行中。
3. UI 显示原始状态和值。
4. 后续 completed 正常关闭。

### 17.9 重复和冲突

1. 重放同 envelope id，页面不重复。
2. 注入 terminal 后 provisional，回合不重开。
3. 注入第二个 terminal，第一终态不被覆盖。
4. 开发诊断显示异常 code。

### 17.10 切频道

1. 在 c0 发请求并立即切到频道 B。
2. c0 的 receipt、feed、terminal 全部进入 c0 state。
3. 频道 B 时间线不出现 c0 pending。
4. c0 未读按非 self 事件规则更新。
5. 切回 c0 后看到完整回合。

## 18. 真实服务端最小验证

Mock 无法代替以下检查：

1. submit 指定客户端 id 后，receipt.message_id 与 feed envelope.id 一致；
2. receipt 不包含 seq，真实 cursor 只由 feed 推进；
3. provisional 和 terminal 的 parent_id/correlation_id 符合 fold 规则；
4. Agent process response 的 parent_id、correlation_id、turn_index、tool_call_id 与真实运行一致；
5. registrar、system actor、actor.describe 的结构化 terminal 形状符合 renderer；
6. 相同 id/相同语义的重试和不同语义冲突符合后端幂等规则；
7. 断线重连回放不会制造重复终态；
8. 大历史回放下分批 fold 不阻塞浏览器。

## 19. 阶段 B 实现证据

- `src/model/submissions.js` 在发送前建立稳定 id，并区分 transmitting、accepted、uncertain、rejected、landed；
- `src/model/fold.js` 以 request id 为主键，支持 correlation 一对多、parent 优先、乱序暂存、第一终态权威和 anomaly；
- `src/ui/StructuredResult.jsx` 覆盖 text、ack、failed、registrar、actor.describe 和通用结构化结果，并递归脱敏、摘要大数组；
- `src/App.jsx` 在发送前登记 submission，所有异步结果绑定原 channel id，刷新后继续对账；
- Mock 可独立延迟 receipt/feed，覆盖 receipt 丢失、结构化、空成功、失败、命名空间 provisional 和冲突终态；
- `tests/fold-phase-b.test.js`、`tests/submissions.test.js`、`tests/structured-result.test.js` 和 B-BR-05..10 提供模型与真实 Chromium 证据。

仍属于后续阶段的不是本模型缺口：主动 actor.describe 能力面板、Schema 动态表单、cancel/steer/interrupt/queue 以及专用业务 renderer。

## 20. 实现模块映射

```text
Composer/App → submissions → wire submit
feed → fold(request-id) → Timeline → StructuredResult
Mock scenario → receipt/feed 独立调度 → 浏览器验收
```

真实 atoll 的 JSON 形态由源码核对和 `tests/fixtures/atoll-contract-v2.json` 约束；第 18 节中的并发、持久化和大历史运行时行为仍保留为发布前真实服务冒烟，不由 Mock 冒充证明。

## 21. 完成标准

该能力完成必须满足：

- 每个 Web submit 在发送前已有稳定 message id；
- receipt 和 feed 任意先后都只产生一个请求卡；
- receipt 丢失时能通过 feed/replay 对账；
- receipt timeout 显示 uncertain，不谎报确定失败；
- cursor 只由 feed.seq 推进；
- request id 是回合主键，correlation 支持多个 request；
- response 优先按 parent_id 关联；
- 五个核心 provisional 保留原值；
- 合法命名空间 provisional 不被当作终态或永久孤儿；
- process progress 不关闭 request；
- 第一条有效 terminal 不被后续冲突覆盖；
- 文本、空成功和结构化成功都有非空可理解 UI；
- registrar 和 actor.describe 结构化结果可用；
- failed 同时呈现 reason、error_code、detail 和恢复建议；
- 切频道不会改变 pending 所属频道；
- 页面刷新后未完成提交可以继续对账；
- Mock 覆盖第 16 节全部首批场景；
- 浏览器覆盖第 17 节全部验收；
- 与真实 atoll 源码和契约 fixture 的字段形态核对通过；真实运行时冒烟仍是发布前验证项。
