# RequestTurn、Progress 与 Agent 调用树协议修复

状态：已实现（2026-08-24）  
日期：2026-08-24  
范围：Atoll Agent runtime、频道账本、atoll-web fold/过程组件/消息树  
关联问题：Agent Tool 过程被写成独立 event；Agent→Agent 子 request/response 在前端丢失；过程与消息没有统一归属

## 1. 结论

协议统一采用以下模型：

> request 建立一个 RequestTurn；该 request 的接收 Actor 通过任意条 provisional response 报告状态与过程，通过唯一 terminal response 关闭 RequestTurn；处理该 request 时发出的新 request 按 `parent_id` 成为子 RequestTurn。

由此得到五条硬规则：

1. 凡是某个 Actor 为处理一条具体 request 而产生的 turn、tool、thinking、text 等过程，全部投影为该 request 的 provisional response；
2. `kind=event` 只表达没有具体 request 所有者的频道事实，不承载 Agent 回合过程；
3. 消息树只由原始 request 的 `parent_id` 构造，绝不从 Tool input/output 或 JSON 内容反向生成；
4. `call_actor` 的父过程只复制子调用的 request 输入与 terminal/failed 输出；子 Actor 的 provisional progress 绝不向父过程冒泡；
5. 后端允许 request/terminal 内容同时存在于“子 Actor 原始 RequestTurn”和“父 Actor Tool 过程”中，前端按不同组件槽位投影，不做跨槽位数据去重。

## 2. 为什么要修

当前实现叠加了两代设计：

- 较早实现把 `agent.turn.started/ended`、`agent.tool.started/ended` 写成持久 event；
- 较新实现又把 queued/processing、thinking/writing 写成 provisional response。

结果是同一个 Agent 回合被拆成两套 wire 语义：

```text
状态、思考、正文阶段  → response progress
turn/tool lifecycle   → event
最终结果              → terminal response
```

这造成以下问题：

- 前端必须同时维护 `provisional` 和 `activity`，同一过程气泡有两个事实源；
- event 不受“terminal 后不得再写 provisional”的 RequestTurn 闭合约束；
- progress 可以按产品策略清理，而 durable activity event 长期污染协作账；
- Agent→Agent 调用既有真实子 RequestTurn，又有父 Tool event，前端容易错误吞掉其中一边；
- 普通 Tool 与 `call_actor` 的过程渲染被迫硬编码 envelope type。

## 3. Envelope 语义

### 3.1 Request

request 是工作和因果树的节点：

```json
{
  "kind": "request",
  "type": "agent.ask",
  "id": "request-a",
  "parent_id": "root-request-or-empty",
  "correlation_id": "root-request",
  "sender": {"kind": "human", "id": "human:root:1"},
  "audience": ["agent:a:1"],
  "payload": {"body": {"text": "请完成任务"}}
}
```

- 根 request 没有 `parent_id`，其 `correlation_id` 等于自己的 id；
- Actor 为服务当前 request 发出的子 request，以当前 request 为 `parent_id`；
- 所有后代继承根 `correlation_id`。

### 3.2 Provisional response / Progress

progress 必须是 response：

```json
{
  "kind": "response",
  "type": "agent.ask",
  "parent_id": "request-a",
  "correlation_id": "root-request",
  "sender": {"kind": "agent", "id": "agent:a:1"},
  "audience": ["human:root:1"],
  "payload": {
    "status": "processing",
    "turn_id": "turn-a-1"
  }
}
```

约束：

- response 的 `type` 与所属 request 相同；
- `parent_id` 精确指向所属 request；
- sender 必须是正在服务该 request 的接收 Actor；
- visibility 继承 request，audience 指向 request sender；
- top-level `payload.status` 必须是合法 provisional 状态，过程自身的完成/失败不得占用 top-level terminal 状态；
- terminal 到达后不允许再写 progress，竞态由现有 harness/store 几何吸收。

### 3.3 Terminal response

terminal 仍是关闭 request 的唯一事实：

```json
{
  "kind": "response",
  "type": "agent.ask",
  "parent_id": "request-a",
  "payload": {
    "status": "completed",
    "text": "最终结果",
    "usage": {
      "model": "gpt-5.6-sol",
      "effort": "low",
      "context_tokens": 1200,
      "context_window": 258400
    }
  }
}
```

`turn.ended` 不再单独进入公开账本。回合是否完成、失败或中断，由 terminal response 的状态、reason、error_code、usage 等字段表达。

### 3.4 Event

event 仅用于不属于某个 RequestTurn 的频道事实，例如：

- 成员加入或离开频道；
- 频道配置、挂载或治理事实发生变化；
- 定时器触发形成一个新的根事实；
- 设备、空间或系统状态发生可协作观察的变化。

以下内容不得再以公开 event 落账：

- Agent turn started/ended；
- Agent tool started/ended；
- thinking/writing/text 过程；
- 某条 request 的队列、处理或可操作状态。

Provider/runtime 内部仍可使用事件和回调组织进程内状态；本修复只统一 Agent Base → Ledger 的公开投影。

## 4. Progress payload

### 4.1 状态 Progress

没有新的过程内容时，progress 只更新 RequestTurn 状态和控制能力：

```json
{
  "status": "processing",
  "turn_id": "turn-a-1",
  "controls": [
    {"word": "agent.interrupt"},
    {"word": "agent.replace"}
  ]
}
```

### 4.2 阶段 Progress

模型产生有意义的中间阶段时：

```json
{
  "status": "processing",
  "turn_id": "turn-a-1",
  "process": {
    "kind": "stage",
    "stage": "thinking",
    "text": ""
  }
}
```

`stage` 使用 Provider 无关词表，例如 `thinking`、`plan`、`writing`、`text`。正文片段是否进入账本仍由 Provider/Base 的节流与隐私规则控制。

### 4.3 Tool started

```json
{
  "status": "processing",
  "turn_id": "turn-a-1",
  "process": {
    "kind": "tool",
    "phase": "started",
    "tool_call_id": "tool-call-1",
    "tool": "call_actor",
    "input": {
      "actor_id": "agent:b:1",
      "type": "agent.ask",
      "payload": {"text": "请协助处理"}
    }
  }
}
```

### 4.4 Tool ended

```json
{
  "status": "processing",
  "turn_id": "turn-a-1",
  "process": {
    "kind": "tool",
    "phase": "ended",
    "tool_call_id": "tool-call-1",
    "tool": "call_actor",
    "outcome": "completed",
    "detail": "",
    "output": {
      "status": "completed",
      "text": "被调 Actor 的结果"
    }
  }
}
```

注意：

- top-level `status` 始终是 `processing`；
- Tool 自身结果使用 `process.outcome=completed|failed`，不能使所属 RequestTurn terminal；
- input/output 保留 Provider/Tool 的原始 JSON，不绑定前端业务语义；
- `tool_call_id` 只负责配对同一节点内部的 Tool started/ended；
- 不增加 `child_request_id`。父 Tool 投影和真实子 RequestTurn 独立，消息树只认 request 因果。

## 5. Agent→Agent 调用

场景：用户问 A；A 调 B/C；B 调 D；C 调 E。

```text
request Q: user → A
├─ A progress: call_actor(B) started
├─ request B: A → B, parent=Q
│  ├─ B progress: processing/thinking/tool...
│  ├─ B progress: call_actor(D) started
│  ├─ request D: B → D, parent=B
│  │  ├─ D progress...
│  │  └─ D terminal
│  ├─ B progress: call_actor(D) ended
│  └─ B terminal
├─ A progress: call_actor(B) ended
├─ A progress: call_actor(C) started
├─ request C: A → C, parent=Q
│  └─ ... E 子树
└─ A terminal
```

这里允许有限的双重记录：

- B 的原始 request/progress/terminal 构成真实子 RequestTurn；
- A 的 `call_actor` started/ended 是 A 所属 RequestTurn 的 Tool progress，input/output 可以包含与 B request/terminal 重叠的数据；
- B 的 thinking/stage/tool 等 provisional progress 只属于 B，不进入 A 的 Tool output；
- 因此 A 最多知道“调用了 B”与“B 最终返回了什么”，不会看到 B 内部又调用了哪些工具或 Actor。

前端不得删除任一账本记录，也不得把 Tool output 解析成子消息；它只把两种投影放到不同位置：

- A Tool progress → A 消息的过程组件；
- B RequestTurn → A 下方缩进一级的子消息；
- D RequestTurn → B 下方再缩进一级。

### 5.1 隔离律

对任意 `A → B` 调用：

```text
A 的 ProcessTrail
├─ call_actor started.input  = 发给 B 的 request 参数
└─ call_actor ended.output   = B 的 terminal/failed 结果，或 accepted ACK

B 子消息
├─ request                   = A → B 的原始 request
├─ ProcessTrail              = 仅 B 自己的 provisional progress
└─ terminal                  = B → A 的最终 response
```

禁止：

- 将 B 的 progress 收集成 `progress_events` 塞入 A 的 Tool output；
- 将 D 的过程经 B 再逐层复制到 A；
- 用 Tool output 反向制造或闭合 B 的 RequestTurn；
- 用 `correlation_id` 代替 `parent_id` 猜测消息树父子关系。

### 5.2 并发

A 并发调用 B/C 时：

- B/C 是 parent 相同的兄弟 request；
- 兄弟顺序按频道 seq；
- 各自 progress/terminal 只按自己的 request id 配对；
- Tool started/ended 只按所属父 Turn 内的 `tool_call_id` 配对。

### 5.3 ACK 与长任务

`call_actor` fast-path 返回 ACK，只代表 Tool callback 已返回 `accepted`，不代表子 RequestTurn terminal。

- 父 Tool ended 的 output 可以是 ACK；
- 子 RequestTurn 继续通过自己的 progress/terminal 推进；
- 父 Agent 后续 `await_result` 是另一条 Tool 过程；
- 前端不能把父 Tool outcome 当作子 Turn 状态。

`call_actor` 与 `await_result` 等待子结果时可以在 JobTable 内部消费/丢弃子 progress，
但返回给 Provider 的 Tool result 不得携带 `progress_events`。父过程只保留本次 Tool 的
原始 input 和最终 output/ACK。

## 6. 后端施工

### 6.1 保留的内部边界

Provider 和 runtime 继续产生内部事件：

- `TurnStarted`；
- `Progress`；
- `Tool`；
- `TurnEnded`。

这些是进程内控制与背压接口，不是公开 wire kind。

### 6.2 Base → Ledger 投影

Agent Base 必须持有 owner request，并执行以下投影：

| Runtime 输入 | 账本输出 |
|---|---|
| TurnStarted | 一条 `status=processing` response，带 turn_id、controls；可合并 turn started 过程信息 |
| Progress(stage/text) | 一条 `status=processing` response，带 `process.kind=stage` |
| Tool started | 一条 `status=processing` response，带 `process.kind=tool, phase=started` |
| Tool ended | 一条 `status=processing` response，带 `process.kind=tool, phase=ended` |
| TurnEnded OK | terminal completed response，usage 随 terminal |
| TurnEnded failed/interrupted | terminal failed response，reason/error_code 按现有规则 |

自发回合没有 owner request，因此没有可合法回复的对象；其过程不进入频道账本。

### 6.3 删除的公开协议

生产代码停止 Emit：

- `agent.turn.started`；
- `agent.turn.ended`；
- `agent.tool.started`；
- `agent.tool.ended`。

删除只为这些公开 event 服务的 registry payload、allowlist 和生产分支。不能删除 Provider/runtime 内部 ToolEvent。

### 6.4 原子性与顺序

- Base actor loop 以收到 runtime 事件的顺序同步写 progress；
- terminal 写入后，晚到 progress 由现有 RequestTurn 闭合门禁拒绝/吸收；
- Tool 过程属于可丢观测，拥塞可以丢，但不得阻塞或终止主回合；
- started 丢失而 ended 存在时，前端仍显示一条独立 ended 记录并标注缺少开始，而不是丢弃结果。

## 7. 前端施工

### 7.1 Fold

每个 RequestTurn 的目标模型：

```js
{
  request,
  provisional: [],
  terminal: null,
  children: []
}
```

新 process progress 进入 `provisional`。前端从 `payload.process` 派生过程行；RequestTurn
模型删除 `activity` 事实源，过程组件不再识别 `agent.turn.*`、`agent.tool.*` event，
也不从 Tool output 的任意 JSON 字段生成过程行或子 RequestTurn。

### 7.2 每条消息的过程组件

每个 Agent 消息节点拥有自己的 ProcessTrail：

- 运行中：气泡内展示最近一至两条过程并计时；
- 点击气泡：展开该节点自己的完整 progress；
- Tool 详情：展示原始 input/output JSON；
- 完成后：折叠为“n 条过程记录”；
- progress 被清理后：消息正文、子树和 terminal 不受影响。

### 7.3 消息树

主时间线只放根 RequestTurn。Agent 业务子 request 递归渲染在父消息下：

```text
用户消息 @A
A 回答
  ├─ A 的过程组件
  ├─ B 子消息
  │   ├─ B 的过程组件
  │   └─ D 孙消息
  │       └─ D 的过程组件
  └─ C 子消息
      └─ E 孙消息
```

显示规则：

- Agent 协作型 request 显示为子消息节点；
- 普通 Tool、system、describe、resource 等技术调用只出现在过程组件；
- 协作/技术分类应最终来自 capability/word 的标准 presentation metadata；迁移期只对标准 Agent request 词表使用集中分类器，禁止散落组件硬编码；
- 深度有视觉缩进上限，但逻辑深度和无障碍层级不得截断；
- 子节点排序按 request seq，不按 Tool output 顺序或时间戳猜测。

### 7.4 两份账的渲染

后端重复不等于 UI 重复：

| 账本事实 | UI 槽位 |
|---|---|
| 父 Agent Tool progress | 父消息 ProcessTrail |
| 子 Agent request | 子消息请求部分 |
| 子 Agent progress | 子消息自己的 ProcessTrail |
| 子 Agent terminal | 子消息回答部分 |
| Tool output 内业务 JSON | 仅作为该 Tool 的原始输出审计，不生成过程行或消息 |

## 8. 一次性迁移

- 升级点之后只写新 response progress；
- 不回写历史 event；
- 前端只支持新 `payload.process`，不保留旧 activity 适配；
- Mock 和全部测试夹具切换到新协议；
- 旧 `agent.turn.*`、`agent.tool.*` event 不参与产品投影；
- 未识别 process kind 保留在回合审计数据，不直接铺原始 JSON到主时间线。

## 9. 验收矩阵

### 9.1 后端

1. 普通 Agent 回合不再产生 `agent.turn.*` event；
2. 普通 Tool started/ended 均产生 parent=request 的 processing response；
3. Tool progress 的 response type、visibility、audience 与 request-response 规则一致；
4. `call_actor` 同时产生父 progress 和真实子 request；
5. 子 Agent 的 progress/terminal 只回复子 request；
6. B→D 产生正确的多级 parent 链并继承根 correlation；
7. ACK、失败、中断、晚到 Tool ended 不会误关 RequestTurn；
8. terminal 后 provisional 仍由现有闭合门禁处理。

### 9.2 前端

1. 新 Tool progress 实时进入所属消息的过程气泡；
2. 完成后过程详情仍显示原始 input/output；
3. Claude→Steward 的真实 request/progress/response 显示为一级子消息；
4. Steward→D 显示为二级子消息；
5. 父 `call_actor` 仍显示在父过程区，但不会制造第二条子消息；
6. 技术性 `actor.describe` 不进入业务消息树；
7. “与我相关”范围不会因为子节点被折叠而漏掉整个根树；
8. 深树、并发兄弟、失败节点和移动端无横向溢出；
9. B 的 progress 不出现在 A 的 ProcessTrail 或 Tool output，D 的 progress 不向 B/A 冒泡。

## 10. 非目标

本轮不做：

- 新增 `child_request_id` 或第二套父子关联协议；
- 从 Tool JSON 推断业务消息；
- 把 token delta 写入协作账；
- 为 progress 引入新的 WebSocket 通道；
- 改变 request/terminal 唯一性、response author 或 correlation 语义；
- 自动清理历史 progress；清理由运维/维护策略独立处理。

## 11. 施工顺序

1. 后端 Base 投影改为 provisional response；
2. 删除公开 Agent activity event 生产路径与词表依赖；
3. 后端协议/Agent/多级调用测试；
4. 前端只使用 `payload.process`，删除 legacy event 适配；
5. AgentConversationTurn 接入子 RequestTurn 消息树；
6. Mock 构造 A→B/C、B→D 场景；
7. 单测、真实浏览器、构建和代码审查收口。
