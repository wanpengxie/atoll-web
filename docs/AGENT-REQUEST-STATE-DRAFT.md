# Agent 请求状态、Progress 与可操作状态方案（草稿）

状态：讨论草稿，不是实施规格  
日期：2026-08-20  
范围：Atoll 后端 Agent/Actor、消息协议、atoll-web 状态投影与交互  

## 1. 要解决的问题

用户发给 Agent 的 request 在进入账本后，不一定马上进入 Agent 的处理回合：

- Agent 空闲时，请求可以立即开始；
- Agent 已有任务时，新请求进入等待队列；
- 等待中的请求可以被取消，或者在协议支持时被提升为当前回合的补充指令；
- 处理中请求可以被 interrupt 或 stop；
- terminal 到达后，不再提供运行期控制；
- 刷新、断线重连和跨设备恢复后，以上状态与操作仍应从账本收敛。

当前前端把 request 入账直接投影为正式 Turn，无法区分“已入账但等待处理”和“已经进入 Agent 回合”。如果前端再根据 Actor 能力、消息类型和本地推测自行决定按钮，会持续复制 Agent 内部的垂直业务知识，并产生竞态。

本方案的核心判断是：

> request 建立工作；provisional response（下文简称 progress）更新这项工作的状态、用户可读过程和当前可操作状态；terminal response 关闭工作。前端不推测 Agent 内部状态，只安全地投影最新有效 progress。

## 2. 协议边界

```text
request
  用户提交的意图与输入

provisional response / progress
  单条 request 的状态更新
  用户可读的阶段进展
  此刻允许执行的动作

terminal response
  唯一最终结果
  completed / failed

activity event
  工具调用、runtime 活动等技术审计

Actor OBS
  Actor 健康、负载、容量等不要求与具体 request 严格对齐的观察

system event
  真正具有频道协作意义的系统事实，不承载普通调度变化
```

普通消息状态不依赖 Actor OBS，也不使用 system event。这样 request、progress、terminal 始终处于同一频道账本、同一可见性规则和同一 `parent_id` 因果链中。

## 3. 请求生命周期

### 3.1 前端标准状态

| 前端状态 | 账本证据 | 展示位置 | 默认动作 |
|---|---|---|---|
| `submitting` | 尚未收到 submit receipt | Composer 上方本地状态 | 等待；结果不确定时允许原 id 重试 |
| `admitted` | request 已入账，尚无有效 progress | 等待区 | 仅展示后端最近明确提供的动作；没有则不猜 |
| `received` | 最新 progress 为 `received` | 等待区 | 同上 |
| `queued` | 最新 progress 为 `queued` | 等待区 | 例如取消、提升为 steer；完全以后端 action 为准 |
| `processing` | 最新 progress 为 `processing` | 正式消息区 | 例如 interrupt；完全以后端 action 为准 |
| `deferred` | 最新 progress 为 `deferred` | 等待区或需关注区，由 presentation 指定 | 后端提供的恢复动作 |
| `unavailable` | 最新 progress 为 `unavailable` | 等待区或警告区 | 后端提供的重试、取消等动作 |
| `terminal` | 第一条合法 terminal | 正式历史区 | 清空全部运行期动作 |

`request` 入账不等于进入正式对话。只有 `processing` 才证明 Agent 已经把这项请求放入真实处理区。

### 3.2 基本状态链

```text
本地 submitting
  → request 入账
  → admitted
  → received（可选）
  → queued（可选，可重复更新）
  → processing { turn_id }
  → completed | failed
```

允许直接路径：

```text
admitted → processing
admitted → failed
queued → failed(cancelled=true)
queued → completed(outcome=merged|promoted)
processing → failed(error_code=interrupted)
```

## 4. Progress 数据模型

### 4.1 设计原则

1. progress 必须通过 `parent_id` 精确绑定原 request；
2. 同一 request 可以有多条 progress；
3. 同一发送者的较新 progress 覆盖其较旧可操作状态，但不删除审计历史；
4. 第一条合法 terminal 永久关闭 request，并使此前所有 action 失效；
5. progress 是持久账本事实，不是周期心跳；只有状态或有意义的过程发生变化时才写；
6. payload 中的垂直业务字段由响应 Actor 定义，通用外壳保持闭集；
7. 未识别的扩展字段必须保留在审计数据中，但不得直接渲染为原始 JSON。

### 4.2 通用外壳草案

```json
{
  "status": "queued",
  "state_revision": 7,
  "presentation": {
    "summary": "等待 Agent 处理",
    "detail": "前面还有一项工作",
    "attention": "normal"
  },
  "actions": [
    {
      "id": "cancel:req-2:7",
      "operation": "request.cancel",
      "label": "取消等待",
      "risk": "normal",
      "target": {
        "request_id": "req-2"
      },
      "guard": {
        "request_id": "req-2",
        "state_revision": 7
      }
    }
  ],
  "data": {
    "queue_position": 2
  }
}
```

字段职责：

- `status`：协议核心 provisional 或合法命名空间状态；
- `state_revision`：该 Actor 对此 request 发布的单调状态版本；
- `presentation`：面向用户的安全摘要，不是 HTML；
- `actions`：当前可执行动作的声明；缺失或空数组即前端不展示控制；
- `data`：垂直业务数据，供专用 renderer 使用，不进入通用消息正文。

`state_revision` 不能替代频道 `seq`。频道 `seq` 决定账本顺序；`state_revision` 用于动作 CAS 和发现同一 request 的陈旧状态。

### 4.3 queued 示例

```json
{
  "status": "queued",
  "state_revision": 4,
  "presentation": {
    "summary": "等待 Agent 处理",
    "attention": "normal"
  },
  "actions": [
    {
      "id": "cancel:req-2:4",
      "operation": "request.cancel",
      "label": "取消等待",
      "risk": "normal",
      "target": { "request_id": "req-2" },
      "guard": { "request_id": "req-2", "state_revision": 4 }
    },
    {
      "id": "promote:req-2:turn-7:4",
      "operation": "message.submit",
      "word": "agent.steer",
      "label": "立即补充当前任务",
      "risk": "medium",
      "target": { "actor_id": "agent:steward" },
      "payload": {
        "queued_request_id": "req-2",
        "expected_turn_id": "turn-7",
        "expected_state_revision": 4
      }
    }
  ],
  "data": {
    "queue_position": 2
  }
}
```

这里的“提升为 steer”必须由后端原子完成。前端不能先 cancel 再另发 steer，否则存在丢失或重复执行竞态。

### 4.4 processing 示例

```json
{
  "status": "processing",
  "state_revision": 5,
  "presentation": {
    "summary": "正在处理",
    "detail": "正在分析项目文件",
    "attention": "normal"
  },
  "actions": [
    {
      "id": "interrupt:turn-7:5",
      "operation": "message.submit",
      "word": "agent.interrupt",
      "label": "中断本轮处理",
      "risk": "medium",
      "target": { "actor_id": "agent:steward" },
      "payload": {
        "expected_turn_id": "turn-7",
        "expected_state_revision": 5
      }
    }
  ],
  "data": {
    "turn_id": "turn-7"
  }
}
```

`interrupt` 必须携带 `expected_turn_id`。后端执行时再次验证；回合已经变化时返回 `cas_mismatch`，不能打断后来启动的回合。

### 4.5 编辑等待中的请求：原子替换

“编辑”不是修改已经存在的 request M，也不是前端先取消 M 再独立发送一条普通 request。它是由 M 的最新 progress 明确提供的后端动作。

M 的 progress 可以声明：

```json
{
  "status": "queued",
  "state_revision": 8,
  "presentation": {
    "summary": "等待 Agent 处理"
  },
  "actions": [
    {
      "id": "replace:req-M:8",
      "operation": "message.submit",
      "word": "agent.replace",
      "label": "编辑",
      "risk": "normal",
      "target": { "actor_id": "agent:steward" },
      "form": {
        "source_request_id": "req-M",
        "mode": "edit_request_content"
      },
      "payload": {
        "replaces_request_id": "req-M",
        "expected_state_revision": 8
      }
    }
  ]
}
```

用户点击编辑、修改内容并发送后，前端创建一条全新的 request N。N 至少携带：

```json
{
  "text": "编辑后的内容",
  "replaces_request_id": "req-M",
  "expected_state_revision": 8
}
```

Actor 在自己的串行 mailbox 中原子执行：

1. 验证 M 仍然存在、仍属于同一 sender、仍处于可替换的等待位置；
2. 验证 M 的 `state_revision` 仍为 8；
3. 从等待队列移除 M；
4. 将 N 放入 M 原来的位置，而不是追加到队尾；
5. 为本次操作生成稳定的 `replacement_id`；
6. 关闭 M；
7. 发布 N 的最新 progress。

M 与 N 必须各自拥有一条 response，因为 response 只能通过一个 `parent_id` 归属一条 request：

```json
{
  "parent_id": "req-M",
  "payload": {
    "status": "completed",
    "outcome": "replaced",
    "replaced_by": "req-N",
    "replacement_id": "replacement-12"
  }
}
```

```json
{
  "parent_id": "req-N",
  "payload": {
    "status": "queued",
    "state_revision": 1,
    "presentation": {
      "summary": "已更新等待内容"
    },
    "relation": {
      "kind": "replaces",
      "request_id": "req-M",
      "replacement_id": "replacement-12"
    },
    "actions": [],
    "data": {
      "queue_position": 2
    }
  }
}
```

这里推荐 M 使用 `status=completed + outcome=replaced`，而不是把 replacement 混同为普通 cancel：

- cancel 表示用户放弃了这项工作，没有承接者；
- replaced 表示原工作由一条可追溯的新 request 承接；
- 两者在 UI 上都可以从等待区移除，但审计、搜索和恢复语义不同；
- 协议 terminal 的顶层闭集仍只有 `completed` 和 `failed`。

如果产品最终坚持把 M 记为取消，也必须保留关系字段：

```json
{
  "status": "failed",
  "cancelled": true,
  "error_code": "cancelled",
  "outcome": "replaced",
  "replaced_by": "req-N",
  "replacement_id": "replacement-12"
}
```

但这会把一次成功编辑统计为失败，因此不是推荐方案。

M terminal 与 N progress 可以由同一次后端原子状态转换产生，也可以共享同一个 `replacement_id`，但不能在协议上合成一条 response：一条 response 只有一个 `parent_id`，合并后将无法同时关闭 M 并更新 N。两条账本写入即使到达顺序不同，前端也能通过双向关系和 `replacement_id` 收敛。

如果校验时 M 已经离开等待区，后端不得替换，也不得把 N 静默当成普通新任务。N 应获得明确 terminal：

```json
{
  "status": "failed",
  "error_code": "edit_conflict",
  "detail": "原请求已经开始处理或已经关闭"
}
```

M 保持原状态不变。前端可以让用户选择把编辑内容作为新任务重新发送，或在当前回合支持时改为 steer。

前端所谓 `hide M` 只是产品投影：默认用 N 替代 M 在等待区的位置，并提供“查看编辑历史”；M 的 request 与 terminal 永久保留在账本中。

### 4.6 用户可读过程

有用户信息含量的阶段变化可以使用命名空间 provisional：

```json
{
  "status": "agent.progress",
  "state_revision": 6,
  "presentation": {
    "summary": "已完成代码检查，正在运行浏览器测试",
    "attention": "normal"
  },
  "actions": [
    {
      "id": "interrupt:turn-7:6",
      "operation": "message.submit",
      "word": "agent.interrupt",
      "label": "中断本轮处理",
      "risk": "medium",
      "target": { "actor_id": "agent:steward" },
      "payload": {
        "expected_turn_id": "turn-7",
        "expected_state_revision": 6
      }
    }
  ],
  "data": {
    "turn_id": "turn-7",
    "phase": "testing"
  }
}
```

主消息区只显示最新一条 `presentation.summary`。完整 progress 历史在回合详情的小型滚动区查看。纯技术 activity 默认过滤，只在技术审计中按需加载。

## 5. Action 声明协议

### 5.1 为什么由后端提供

可操作状态属于响应 Actor 的垂直业务知识：

- Agent 知道当前请求是否仍在自己的队列；
- Agent 知道当前 turn 是否可 steer 或 interrupt；
- 审批 Actor 知道当前允许 approve、reject 还是补充材料；
- Tool Actor 知道当前操作是否支持 retry、resume 或 cancel。

前端只看 `status`、Describe capability 或消息类型进行推测，会把每个 Actor 的状态机硬编码进 Web，并且无法消除读取状态与提交命令之间的竞态。

因此 progress 应提供当前动作集合；前端执行以下职责：

1. 校验 action 外壳；
2. 根据当前登录身份、频道写权限和风险策略做通用限制；
3. 使用统一组件渲染；
4. 原样提交声明中的目标、word、payload 和 guard；
5. 展示动作自身的 submitting、accepted、uncertain、terminal；
6. terminal 或更新 revision 到达后立刻撤销旧 action。

### 5.2 Action 闭集

第一版只允许两类 operation：

| operation | 含义 | 传输方式 |
|---|---|---|
| `request.cancel` | 取消当前用户自己发起且仍开放的 request | 通用 cancel frame |
| `message.submit` | 向指定 Actor 发送一个声明过的消息 word | 通用 submit frame |

前端不接受 URL、JavaScript、任意组件名或任意 HTTP 方法。Actor 只能声明数据，不能向前端注入执行代码。

### 5.3 Action 不是授权

action 是“后端认为此刻可用”的可操作状态，但不是不可伪造的授权：

- 前端必须遵守自身登录态、频道访问和风险确认策略；
- Actor/平台收到命令后必须重新校验 sender、目标 request、turn、revision 和能力；
- action 陈旧时返回稳定的 `cas_mismatch`、`already_closed` 或 `action_unavailable`；
- 前端不能因为 action 曾出现过就缓存并长期复用。

如果以后需要跨不可信 Actor 的能力授权，可以把 action 扩展为带服务端签名、短期有效的 capability token；第一版不提前引入。

### 5.4 静态能力与动态动作

```text
actor.describe
  这个 Actor 理论上支持哪些 word、输入 Schema 和错误码

progress.actions
  对这一个 request，在这个状态版本上，此刻允许用户执行哪些动作
```

前端可以用 Describe 预加载表单和解释能力，但运行期按钮以最新 progress actions 为准。两者冲突时不执行猜测：隐藏动作并记录契约异常。

## 6. 前端 Fold 与投影

### 6.1 Fold 保存，Selector 决定展示

Fold 必须无损保存 request、全部 progress、activity 和第一 terminal，但不能把每条账本记录直接渲染成聊天内容。

建议派生：

```text
submissions
  本地发送但尚未确认入账

waitingRequests
  admitted / received / queued / deferred / unavailable

activeTurns
  processing 或带 turn_id 的合法 agent.* progress

historicalTurns
  terminal 已确认

controlOperations
  用户点击 action 后产生的控制 request 及其状态
```

### 6.2 最新状态规则

1. 第一条合法 terminal 最高优先级；
2. terminal 到达后，后续 provisional 只记录为协议异常，不重新开放；
3. 没有 terminal 时，取账本顺序最新的合法 progress 作为展示状态；
4. `state_revision` 倒退或重复但内容冲突时记录契约异常；
5. 最新 progress 中的 `actions` 是唯一运行期动作集合；
6. progress 没有 actions 时显示零个动作，前端不从旧 progress 继承；
7. 未知 namespaced status 保存并采用安全降级 presentation，不判为 terminal。

### 6.3 主消息区过滤

默认不生成独立消息块：

- `received`；
- 纯调度 `queued`；
- 只有 `turn_id` 的 `processing`；
- 重复且没有新用户信息的 progress；
- tool started/ended；
- token、usage、provider 元数据；
- steer、interrupt、cancel 等控制 request 的原始 JSON 结果。

默认可见：

- 用户 request 的真实正文；
- 最新有信息含量的 progress summary；
- 审批等需要用户介入的业务卡片；
- Agent 最终文本或专用结构化结果；
- 失败、取消、合并、抢占等可解释终态。

## 7. UI 草案

```text
┌──────────────────────────────────────────────┐
│ 正式消息区                                   │
│                                              │
│ 用户请求（processing 后进入）                │
│ Agent 最新进展摘要                           │
│ Agent 最终回复                               │
│                                              │
├──────────────────────────────────────────────┤
│ 等待处理 2                                   │
│ req-2  整理测试报告     [取消] [立即补充]     │
│ req-3  检查部署配置     [取消]                │
├──────────────────────────────────────────────┤
│ Composer                                     │
└──────────────────────────────────────────────┘
```

- 等待区固定在 Composer 上方，不作为历史消息列表的一部分；
- request 从 waiting 进入 processing 时使用同一 `request_id`，不复制消息；
- 等待区变化不改变历史滚动锚点；
- progress summary 在主消息内保持紧凑；
- 完整过程在局部滚动区展开；
- action 只显示最新 progress 明确提供的集合；
- terminal 后所有运行期按钮立即消失。

## 8. 后端需要调整的地方

### 8.1 Agent Base

1. `agent.ask` 固定为发起新工作，忙时排队，不再隐式 steer；
2. 接收 request 后按需发布 `received`；
3. 入队发布带 `state_revision`、presentation、actions 的 `queued`；
4. 启动回合发布带 `turn_id`、actions 的 `processing`；
5. 状态或可操作集合变化时发布新 progress；
6. `agent.interrupt` 增加 `expected_turn_id` 和可选 `expected_state_revision`；
7. queued request 提升为 steer 必须成为单 mailbox 内的原子操作；
8. queued request 的编辑必须以新 request 原子替换旧 request，并保留原队列位置；
9. terminal 关系规范化为 `merged`、`preempted`、`promoted`、`replaced` 等稳定 outcome；
10. Manifest 只声明实际受理的 word，不能无条件发布 steer/interrupt。

### 8.2 通用协议

需要决定通用 progress 外壳是否进入协议层：

- `state_revision`、`presentation`、`actions` 作为所有 Actor 可复用字段；
- `data` 继续由垂直 Actor 定义；
- action operation、risk、guard、target 字段闭集；
- action label 是后端文本还是稳定 `label_key + params`；
- progress payload 大小和 action 数量上限；
- 多 audience、多 responder 情况下的 action 所有权。

## 9. Mock 要求

Mock 不能继续用静态消息夹具模拟这一功能，应实现每个 Agent 的确定性状态机：

```text
requests
queue
active turn
state revision
pending controls
capabilities
```

至少覆盖：

1. 空闲请求直接 processing；
2. 忙时请求 received → queued；
3. queued action 取消成功与 already_closed；
4. queued 原子提升为 steer；
5. queued 编辑后 N 原子替换 M 的位置，M/N response 任意顺序到达仍可收敛；
6. 编辑时 M 已开始或关闭，N 以 `edit_conflict` 终结且 M 不变；
7. processing action interrupt 成功；
8. 回合切换导致 interrupt CAS 失败；
9. progress 更新后旧 action 立即失效；
10. terminal 清空 actions；
11. 多条队列批处理产生 merged 关系；
12. submit receipt 与 request feed 任意先后；
13. 断线刷新后只靠 feed 恢复 waiting、processing 和 actions；
14. 未知 namespaced progress 与未知 action 安全降级。

## 10. 需要继续确认的设计决策

1. `presentation.summary` 是否允许 Actor 直接提供用户文案，还是使用 `label_key + params` 统一本地化；
2. `actions` 是否作为核心 provisional payload 的通用字段正式标准化；
3. action CAS 使用 `state_revision`，还是使用后端签发的 opaque `guard_token`；
4. 已排队请求提升为 steer 的正式 word 与 terminal outcome；
5. 编辑等待请求使用独立 `agent.replace`，还是在原 request word 上增加统一 replacement 字段；
6. 多人同时可见同一 request 时，哪些 action 对哪些 principal 可见；
7. queued 是否展示精确 position；若不影响用户决策，第一版只显示“等待处理”；
8. stop 是只在 Actor 管理面提供，还是 processing progress 可以声明；
9. Agent 重启后尚未 terminal 的旧 request 如何重新发布 progress 并恢复 action；
10. progress 中用户摘要与 activity 技术事实的明确分界；
11. action 执行 request 是否只挂在原 request 详情中，默认不进入主聊天流。

## 11. 本草稿的推荐结论

第一版建议确认以下原则后再施工：

1. 消息生命周期与可操作状态统一由 progress 提供；
2. 前端不根据 Agent 内部状态猜按钮；
3. terminal 永远关闭 progress actions；
4. 所有 action 执行时由后端重新校验，progress action 不是授权本身；
5. Actor OBS 和 system event 不参与普通消息状态机；
6. 技术 progress/activity 保留在账本，但普通消息区按语义过滤；
7. 先修正后端语义和 Mock 状态机，再调整前端 fold 与 UI。
