# atoll-web 产品交互总任务

状态：阶段 A–E 已全部完成
日期：2026-08-17
适用仓库：`atoll-web`
后端基线：`atoll` main `f5aee647`（lobby 只暴露注册/登录，root 不是 lobby 成员）

## 0. 文档目的

阶段 A–E 完成后的前端产品体验改进统一由 [FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md](FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md) 管理。UI 表面、容器决策和响应式状态机由 [UI-INTERACTION-ARCHITECTURE.md](UI-INTERACTION-ARCHITECTURE.md) 定义；GenSpark 的分层产品研究、主交互区设计和 atoll-web 差距由 [GENSPARK-DESIGN-BENCHMARK.md](GENSPARK-DESIGN-BENCHMARK.md) 定义；基础组件实现边界由 [UI-COMPONENT-REFACTOR-PLAN.md](UI-COMPONENT-REFACTOR-PLAN.md) 定义。

这份文档是 atoll-web 产品交互建设的总入口，用来解决两个问题：

1. atoll 后端入口已经规范化，但产品能力仍散落在 WS 帧、OBS 投影、系统 actor、registrar、资源和文件数据面中，缺少按用户任务组织的产品模型。
2. 前端开发需要一个足够真实、可编排、可重复的 Mock 环境，使绝大多数 UI 开发和浏览器测试不依赖启动完整 atoll 服务端。

本文不把后端帧逐个翻译成按钮，而是建立下面这条固定映射：

```text
后端协议能力
  → 用户任务
  → 产品能力
  → 交互状态机
  → UI 入口
  → Mock 场景
  → 浏览器验收
  → 少量真实服务端契约验证
```

本文是总任务文档，不替代[用户交互总规格](USER-INTERACTION-SPEC.md)。产品体验按完整用户旅程统一定义，不再为每个后端 verb 建立一份长规格。`docs/interaction-specs/` 只保留少量跨多个旅程复用、具有复杂状态机的技术附录。

交互规格体系：

- [用户交互总规格](USER-INTERACTION-SPEC.md)：统一定义信息架构、完整用户旅程、全局反馈原则、Mock 场景和分阶段产品验收；
- [频道访问状态](interaction-specs/channel-access-state.md)：定义频道存在性、运行状态、用户关系、最终 UI 模式、Mock 场景和浏览器验收。
- [普通消息与结构化终态](interaction-specs/message-and-structured-terminal.md)：定义提交与账本两层状态、receipt/feed 对账、回合 fold、结构化结果渲染、异常场景和验收。

独立工程重构轨道：

- [UI 组件层重构设计与施工计划](UI-COMPONENT-REFACTOR-PLAN.md)：在不改变产品视觉与用户旅程的前提下，统一基础组件、右侧面板、动态表单、App 编排、CSS 和视觉回归。该轨道使用 DG/R 编号，不属于产品阶段 A–E。

## 1. 当前结论

当前 atoll-web 已经是一个“核心频道访问与消息结果可信、可恢复的账本客户端”，但还不是完整的 Atoll 交互客户端。

已经覆盖：

- 注册、登录、退出和会话恢复；
- OBS 频道树和频道名册；
- WS v2 attach、feed 回放、实时推送、游标和断线重连；
- 普通消息 submit；
- Agent 临时状态、工具活动和终态的基础展示；
- human approval 的 resolve；
- 基础未读和本地 feed 缓存；
- “我的频道 / 空间”及 stale、unavailable、denied、retired 访问状态；
- self Actor 的显式投影/submit-feed 对账，不会猜测任一 human；
- submission 与账本回合分层、receipt/feed 乱序和 uncertain 恢复；
- 完整 provisional、乱序归并、第一终态权威和 anomaly；
- 文本、空成功、失败、registrar、actor.describe 和通用结构化终态；
- 标准 Actor 隐藏及 registrar/coreactor 管理路由；
- Actor Describe 能力发现、TypeMeta 说明和 Schema/payload_fields/JSON 动态调用；
- cancel、steer、interrupt、queue、stop、terminate、restart 及风险确认；
- 结构化审批、过期/并发错误和外部处理恢复；
- 长任务 turn_id、控制资格和 cancel 状态的刷新/重连恢复；
- 频道创建、详情、退役及 terminal/OBS/membership/open 分阶段收敛；
- human/agent/tool 添加、Actor 重启/移除、owner/标准 Actor 保护和权限反馈；
- 分层 Mock、确定性场景、契约 fixture 和阶段 A–E 真实浏览器回归。

主要欠缺：

- 模板、声明、设备、Profile、Endpoint 没有产品化；
- 定时器、资源和文件数据面没有产品化；
- 真实后端缺少显式 membership/self 投影，生产 Observer 尚未装配；
- Mock 已校正阶段 A–E 契约，并实现模板、设备、KV、文件 ticket 数据面和虚拟定时器闭环；真实 daemon、磁盘与并发权限仍由发布前 smoke 证明。

## 2. 产品设计原则

### 2.1 按用户任务组织，不按后端包组织

用户不应该理解 `subjectgate`、`svcactor`、`peeractor`、registrar seat 或跨膜 port。产品界面只表达用户目标，例如“创建子频道”“停止任务”“添加 Agent”“上传文件”。

系统 actor、coreactor、svcactor、registrar 等基础设施 actor 可以在普通名册中隐藏，但 Web 必须在后台发现并正确使用它们。

### 2.2 管理动作仍然走统一消息面

频道创建、Actor 编排、设备绑定等管理动作继续通过频道消息请求完成，不为 UI 新增 `/api/channels/*` 一类旁路接口。

专用 UI 是消息请求的产品化入口，而不是另一套管理后端。

### 2.3 区分三类状态

任何重要交互都必须区分：

- 声明状态：频道、Actor、模板等被声明成什么；
- 运行状态：open、bound、device_online、serving 等当前事实；
- 操作结果：一次真实请求最终成功、失败、超时或被取消。

不能把 presence 当作可服务承诺，也不能把 OBS 中存在当作当前用户拥有写权限。

### 2.4 以端到端能力为准，不以词表存在为准

一个帧类型或字段只有在生产装配、执行路径、结果返回和权限判断全部存在时，才算可产品化能力。

例如：

- `observe` 是正式 WS 帧，但当前生产装配没有注入 Observer，不能按已可用功能设计；
- resource 的 `target/ops` 字段当前没有执行分支，不能仅因字段存在就做 UI；
- cancel、after、resource 文件 ticket、actor.describe 已有完整执行链，可以进入产品计划。

### 2.5 Mock 必须模拟产品闭环

Mock 不应只返回 `{ok:true}`。例如创建频道必须同时产生：

1. 原频道中的请求；
2. 临时状态和结构化终态；
3. 新频道 OBS 投影；
4. 新频道 membership；
5. system/coreactor 等标准 actor；
6. 后续该频道 feed 推送。

## 3. 产品能力地图

### 3.1 身份与账户

用户任务：

- 注册账户；
- 登录、恢复已有会话、退出；
- 查看自己的 principal 信息；
- 修改凭据；
- 退役账户。

后端能力：

- 身份 HTTP：register/login/logout；
- registrar：`principal.me`、`credential.set`、`principal.retire`。

当前缺口：

- Cookie 存在但 localStorage principal 丢失时，没有可靠的当前身份恢复；
- 没有账户设置界面；
- principal 与频道内 human actor 的映射缺失。

### 3.2 频道发现与访问状态

用户任务：

- 查看自己是成员的频道；
- 浏览空间中的频道树；
- 识别频道是可写、只读、不可访问、未 serving 还是已退役；
- 切换频道并查看未读。

后端能力：

- OBS：space channels、channel profile；
- WS entitlement：自动订阅成员频道；
- observe/unobserve 协议；
- registrar：channel.list/get/describe。

阶段 B 状态与后端缺口：

- Web 已将空间树、成员证据、运行状态和 freshness 合成为统一访问模式；
- lobby 不进入已登录协作界面，非成员频道不再启用编辑器；
- 后端仍没有直接返回“当前 principal 的成员频道及 subject actor id”；
- 生产 Observer 尚未装配，因此产品入口保持关闭。

目标交互：

- 左栏至少区分“我的频道”和“空间”；
- 频道项展示 open/不可用状态；
- 非成员频道不能显示可写编辑器；
- observe 未正式启用前，不展示可用的“旁观”操作。

### 3.3 频道账本与实时协作

用户任务：

- 查看历史和实时消息；
- 切换频道后看到不同账本；
- 发送消息给一个或多个成员；
- 查看系统叙事、失败和未读；
- 断线后无重复、无丢失地恢复。

后端能力：

- WS attach/since/feed；
- submit receipt；
- request/response/event 信封；
- provisional 和 terminal 状态；
- system actor narration。

阶段 B 完成状态：

- submission 和账本回合已经分层，receipt/feed 任意先后可对账；
- 五种核心及命名空间 provisional 保留原值和 payload；
- 文本、空成功、结构化和 failed 终态都有非空展示；
- 权限撤销、retire、停止 serving、partial OBS 和 feed 延迟有真实 Chromium 验收；
- 大历史性能和真实服务端并发重放仍是发布前运行时 smoke。

### 3.4 Agent 任务与控制

用户任务：

- 给 Agent 发起任务；
- 查看排队、处理中、工具调用和终态；
- 在任务执行中追加方向；
- 中断当前动作；
- 排队新任务；
- 停止、终止或重启 Agent；
- 取消自己发起且仍未关闭的请求。

后端能力：

- `agent.steer`；
- `agent.interrupt`；
- `agent.queue`；
- `agent.hold` / `agent.unhold` / `agent.replace`；
- `agent.terminate`；
- `agent.restart`；
- WS cancel；
- activity.turn/tool 事件。

阶段 C 完成状态：

- cancel 只对本人发起、未终结且可写的请求开放，并区分 receipt 与原任务 terminal；
- steer 由 processing.turn_id 和 Describe 共同启用，interrupt/queue 是独立控制回合；
- stop/restart 需要显式确认，terminate 需要完整 Actor id；
- accepted、uncertain、稳定错误和 replay 收敛均有浏览器证据。

### 3.5 人工介入与审批

用户任务：

- 查看发给自己的审批请求；
- 批准、拒绝，并可附加结构化信息；
- 识别审批已关闭、已过期或已被他人处理。

后端能力：

- human.approve；
- resolve approved/rejected；
- request_not_found、not_in_audience、already_closed 等错误。

阶段 C 完成状态与后端缺口：

- 后端未提供显式 self 投影时，首次本人 request feed 前仍无法确认频道 actor；UI 会明确提示而不猜测，因此已有审批可能暂不显示；
- Web 已兼容 request payload 中的 `response_schema|resolve_schema`，无 Schema 时降级为 JSON object；
- 过期、重复/并发、权限错误、外部处理和刷新恢复均已产品化；
- 真实后端仍欠缺统一的 approval resolve Schema 载体。

### 3.6 Actor 发现与能力驱动交互

用户任务：

- 查看频道中有哪些业务成员；
- 查看 Actor 是否在场、设备是否在线；
- 查看 Actor 能做什么；
- 根据具体动作填写正确参数；
- 理解预期耗时、可能错误和恢复方式。

后端能力：

- OBS channel actors；
- system actor 的 actor.list/status；
- `actor.describe`；
- TypeMeta：allowed kinds、max pending、payload fields/example、input/output schema、error codes、notes。

阶段 C 完成状态：

- 名册负责“是谁”；
- 能力面板负责“能做什么”；
- Web 主动调用并从账本恢复 actor.describe；
- JSON Schema、payload_fields/example 和 JSON 降级驱动通用调用；
- 参数、建议耗时、错误、恢复建议和 notes 可查看；
- 名册隐藏标准 actor，后台继续按 id/decl_id 解析管理 actor。

### 3.7 频道治理

用户任务：

- 创建子频道；
- 查看频道详情和子频道；
- 退役频道；
- 邀请 human；
- 添加 agent/tool；
- 移除或重启 Actor。

后端能力：

- registrar：channel.create/list/get/describe/candidates/retire；
- system actor：channel.introduce_actor/remove_actor/restart_actor；
- 普通频道 coreactor 到 c0 svcactor/registrar 的跨膜转发。

当前缺口：

- 只有 `/introduce` 和 `/channels` 两个调试式命令；
- `/channels` 只查本频道 registrar，在普通频道找不到正确的 coreactor；
- 没有创建、退役、成员和 Actor 管理页面；
- 没有结构化结果呈现；
- 没有异步等待新频道 serving/coreactor 出现的交互状态。

### 3.8 模板、声明与频道配置

用户任务：

- 管理 Actor 模板；
- 管理频道模板；
- 为特定频道设置 overlay；
- 配置频道描述、serving 和 endpoints；
- 基于模板创建频道。

后端能力：

- actor.template.register/edit/revoke/list；
- actor.overlay.set/clear；
- channel.template.register/edit/revoke/list/get；
- channel.profile.set；
- OBS space decls。

当前缺口：全部未产品化。

### 3.9 设备治理

用户任务：

- 查看设备及在线状态；
- mint/claim/retire 设备；
- 将设备绑定或解绑频道；
- 理解设备离线对 Actor 和文件的影响。

后端能力：

- device.mint/claim/list/retire/attach/detach；
- OBS space daemons；
- actor device presence。

当前缺口：全部未产品化。

安全约束：当前后端 `device.list` 返回结构包含设备 key。在后端提供安全投影前，不应把完整 `device.list` 结果直接暴露、缓存或记录到普通 Web 日志中。

### 3.10 资源和文件

用户任务：

- 创建、读取、修改、删除和列举资源；
- 上传文件；
- 下载或打开文件；
- 在消息中引用附件；
- 处理 host offline、ticket 失效和权限拒绝。

后端能力：

- resource create/read/write/delete/stat/list；
- 文件 create/read 返回 ticket；
- `GET/PUT /files/<address>?t=<ticket>`；
- daemon 文件地址和 host offline 错误。

当前缺口：

- wire 虽有 resource 方法，但 UI 和 Mock 都没有执行闭环；
- 没有文件选择、上传进度、下载和附件模型；
- 没有 Mock ticket 和内存文件数据面。

### 3.11 定时动作

用户任务：

- 创建提醒或定时事件；
- 查看客户端已创建的定时器；
- 取消定时器。

后端能力：after、cancel_timer。

当前缺口：

- UI 和 Mock 均未实现；
- timer receipt 是脱离账本的结果，客户端若要展示定时器列表，需要明确本地持久化或后端观测来源。

## 4. 用户交互规格与技术附录

所有面向用户的入口、展示条件、输入、反馈、权限、异常恢复和验收都在[用户交互总规格](USER-INTERACTION-SPEC.md)中按旅程统一定义。`cancel`、`steer`、`channel.create` 等单个协议动作只是旅程中的步骤，不单独形成产品规格。

只有一个主题同时满足以下条件时，才在 `docs/interaction-specs/` 新增技术附录：

- 被三个以上用户旅程复用；
- 存在复杂的多源状态合成或状态优先级；
- 实现需要共享 reducer、selector 或对账算法；
- 分散描述会导致 Mock、UI 和浏览器测试产生矛盾。

技术附录必须包含后端映射、状态机、成功证据、稳定错误、Mock 异常场景和浏览器断言，但不得重复设计产品信息架构。

## 5. 机器可读的能力清单

为了避免文档、Mock、测试和 UI 再次漂移，后续应增加一份机器可读的 capability manifest。建议位置：

```text
contracts/product-capabilities.json
```

示例：

```json
{
  "id": "request.cancel",
  "product_domain": "agent-task",
  "transport": "ws",
  "frame_type": "cancel",
  "available_when": [
    "request.open",
    "request.sender_is_self",
    "channel.writable",
    "wire.attached"
  ],
  "success": {
    "receipt": "req_id",
    "feed_terminal_required": true
  },
  "errors": [
    "already_closed",
    "unauthorized_sender",
    "request_not_found",
    "unavailable"
  ],
  "mock_scenarios": [
    "success",
    "already_closed",
    "unauthorized",
    "receipt_delayed",
    "feed_delayed",
    "connection_lost"
  ]
}
```

第一阶段 manifest 只用于覆盖检查和场景注册，不要求 UI 完全动态生成。成熟后可以逐步用于：

- 自动生成能力总表；
- 检查每项能力是否有 Mock 场景；
- 检查是否有浏览器验收；
- 控制 UI 功能开关；
- 对照后端契约版本；
- 生成错误码和恢复策略表。

## 6. Mock 总体方案

### 6.1 目标

日常前端开发和绝大多数浏览器测试不启动真实 atoll。

目标覆盖：浏览器可观察交互的 90%～95%。

Mock 必须满足：

- 协议严格；
- 状态真实；
- 场景可重复；
- 时间可控制；
- 错误可注入；
- 能力覆盖可统计；
- 不复制完整 Go runtime。

### 6.2 第一层：严格协议 Mock

职责：保护浏览器与 atoll 的 ABI。

必须模拟：

- register/login/logout Cookie；
- WS upgrade 鉴权；
- attach 必须是第一帧且只发一次；
- v2 frame envelope；
- 上行未知字段拒绝；
- 未知上行 frame_type 拒绝；
- 下行未知 frame_type 可注入，用于 must-ignore；
- ref 与 receipt/error 对应；
- 512KB 限制；
- channel_id、audience、decision、duration 等字段校验；
- 正确的错误码和 detail；
- contract_version。

这一层不决定复杂业务，只负责“说话格式像真实服务端”。

### 6.3 第二层：有状态领域模拟器

建议维护以下最小状态：

```text
principals
sessions
channels
channel_profiles
memberships
actors
actor_capabilities
messages
open_requests
timers
resources
files
file_tickets
observations
devices
declarations
channel_templates
```

关键规则：

- attach 只推送 membership 频道，不广播全部频道；
- observation 订阅与 membership 订阅分开；
- observer 永远不可发送业务帧；
- root 不是 lobby 成员；
- lobby 只有 guest，只暴露 register/login；
- 普通频道通过 coreactor 调用 registrar 能力；
- system actor 处理 introduce/remove/restart；
- 频道/Actor 变更必须产生相应 feed 和 OBS 变化；
- receipt 与 feed 可以设置不同延迟；
- channel retire 会停止协作并改变 OBS；
- membership 撤销会停止 feed 并拒绝后续写入；
- Actor restart 产生 lifecycle/system 事件并改变 incarnation/presence；
- resource/file ticket 有过期、一次性或权限语义；
- timer 使用虚拟时钟，不要求测试真实等待。

### 6.4 第三层：场景与故障控制器

建议提供两种入口。

预设启动场景：

```text
ATOLL_MOCK_SCENARIO=first-login
ATOLL_MOCK_SCENARIO=existing-approval
ATOLL_MOCK_SCENARIO=long-agent-turn
ATOLL_MOCK_SCENARIO=multi-channel
ATOLL_MOCK_SCENARIO=permission-revoked
ATOLL_MOCK_SCENARIO=file-workflow
```

运行时控制口：

```text
POST /mock/control/advance-time
POST /mock/control/drop-websocket
POST /mock/control/delay-feed
POST /mock/control/revoke-membership
POST /mock/control/retire-channel
POST /mock/control/restart-actor
POST /mock/control/host-offline
POST /mock/control/push-approval
POST /mock/control/inject-unknown-frame
```

控制口只用于测试环境，不模仿正式后端 API。

### 6.5 Mock 不需要复刻的内容

Mock 只需复刻浏览器可观察的因果关系，不需要实现：

- Go actor runtime；
- SQLite；
- 真正的跨膜 goroutine/port；
- daemon 进程；
- 真实磁盘目录；
- 完整权限存储引擎；
- 生产级加密和 ticket 签名。

例如 coreactor → svcactor → registrar 在 Mock 中可以是一次领域命令，但必须产生与真实后端一致的请求、终态、OBS 和权限结果。

## 7. Mock 与真实服务端的边界

### 7.1 可以完全在 Mock 中完成的浏览器开发

- 身份表单和会话 UI；
- 频道列表、访问状态和切换；
- 历史、实时消息、未读；
- Agent 长任务和工具活动；
- cancel/steer/interrupt/queue/stop/terminate/restart；
- 审批；
- actor.describe 驱动的结构化交互；
- 频道创建、退役；
- human/agent/tool introduce/remove/restart；
- 模板、声明、Profile、Endpoint UI；
- 设备 UI；
- 资源和内存文件上传下载；
- 定时器与虚拟时间；
- 重连、延迟、重复、乱序和错误恢复。

### 7.2 Mock 无法证明的内容

- Go 与 JavaScript 契约是否实际漂移；
- 真实 entitlement resolver、lease 和 per-batch revocation；
- SQLite 持久化和服务端重启恢复；
- 多频道高并发下的 feed 顺序、公平性和背压；
- coreactor/svcactor/registrar 的真实跨膜执行；
- daemon 离线、重连和物理文件落盘；
- ticket 的真实安全性；
- 大历史量和大文件性能；
- 反向代理、Cookie、WebSocket Upgrade 的部署组合。

因此 Mock 可以成为日常开发主环境，但不能成为唯一发布验收环境。

### 7.3 推荐测试比例

```text
日常开发：       100% Mock
每次提交/PR：    单元测试 + Mock 浏览器 E2E + 契约快照
主分支定时任务： 真实 atoll 冒烟测试
发布前：         完整真实服务端用户旅程
```

## 8. 场景矩阵

第一批必须支持的产品场景：

| 场景 | 主要验证点 | Mock | 真服务端 |
|---|---|---:|---:|
| 首次注册登录 | 身份、Cookie、初始频道、自我识别 | 必须 | 冒烟 |
| 已有会话恢复 | localStorage 缺失、OBS、attach | 必须 | 冒烟 |
| 多频道回放 | since、多频道隔离、切换 | 必须 | 必须 |
| 普通 Agent 任务 | queued/processing/activity/terminal | 必须 | 冒烟 |
| 长任务取消 | cancel receipt + terminal | 必须 | 必须 |
| steer/interrupt | 能力判断、控制状态、失败恢复 | 必须 | 必须 |
| 已存在审批 | 未发言前自我识别 | 必须 | 必须 |
| 重复审批 | already_closed | 必须 | 冒烟 |
| 创建子频道 | coreactor、结构化结果、OBS 收敛 | 必须 | 必须 |
| 添加/重启 Actor | system actor、系统事件、名册刷新 | 必须 | 必须 |
| 成员资格撤销 | feed 停止、编辑器禁用、forbidden | 必须 | 必须 |
| 频道退役 | OBS、写入停止、陈旧 UI 清理 | 必须 | 必须 |
| WebSocket 断线 | pending 失败、重连、无重复 | 必须 | 必须 |
| receipt 后 feed 延迟 | accepted/landed 两阶段 UI | 必须 | 冒烟 |
| OBS partial | complete=false 和降级提示 | 必须 | 可选 |
| Actor 能力发现 | describe Schema、错误码、耗时 | 必须 | 必须 |
| 文件上传下载 | resource ticket、PUT/GET、host offline | 必须 | 必须 |
| 定时器 | 虚拟时间、cancel_timer | 必须 | 冒烟 |

## 9. Mock 偏差整改进度

阶段 A–E 已完成以下整改：

1. root 不再是 lobby 成员，已登录连接不接收 lobby feed；
2. attach 和实时 feed 按 membership/observation 投递，不再全频道广播；
3. observe/unobserve 会真实改变 Mock 连接订阅，但生产 UI 仍按后端装配状态关闭；
4. registrar `channel.list` 和普通频道 coreactor 路由均可形成请求、结构化终态与页面结果；
5. 周期事件只进入 root 的真实成员频道；
6. Mock E2E 同时覆盖协议层与完整 React/Chromium 交互；
7. cancel 已有正式任务入口，并区分 receipt、uncertain 和原请求 cancelled terminal；
8. Describe、长任务控制、Actor 生命周期和结构化审批均有协议级 Mock 与 Chromium 闭环。
9. channel/actor template、overlay/profile 和安全 daemon OBS 具有有状态闭环；
10. resource list 不再错误要求 resource_id，KV 六类操作和文件 ticket PUT/GET 可重置复现；
11. after/cancel_timer 由虚拟时间驱动，取消后不会产生账本事件；
12. 设备 key、ticket 值和文件内容不会进入 Mock 状态快照。

仍保留为真实服务端或后续协议验证：

- observe_ended 的完整生命周期场景；
- daemon 真实路由、磁盘持久化、设备绑定安全投影和并发权限；
- timer 跨浏览器可观测性（当前后端没有 list/OBS）。

Mock 扩展不得为了迎合现有 UI 偏离真实协议或伪造生产装配能力。

## 10. 后端协同问题

以下问题不能仅靠 atoll-web 完美解决，需要与 atoll 契约协调。

### P0：成员频道和自我 actor 投影

需要一种可靠方式返回：

```text
principal
  → member channel
  → channel-local human actor id
```

候选方案：

- OBS human actor 行在合适权限下增加 principal；
- 新增“我的 memberships”OBS 投影；
- attach receipt 增加 membership/subject 映射。

选择时要同时考虑隐私、频道数量和首次加载成本。

### P0：生产 Observer 是否启用

当前协议存在 observe/unobserve，但生产 gateway 未注入 Observer。产品不得在此决定前承诺旁观体验。

需要明确：

- 是否允许公开频道旁观；
- 旁观能看哪些 visibility；
- 空间列表如何表达可旁观；
- 何时产生 observe_ended；
- 是否允许 lobby 被任何已登录 principal 旁观。

### P1：Agent 文本类型归位

当前 Web 使用 `human.text` 绕过 Agent `agent.*` 闭集。需要最终决定并统一正式文本请求类型。

### P1：设备密钥安全投影

在设备管理产品化之前，需要一个不返回设备 key 的安全 list/OBS 结果。

### P2：定时器可观测性

如果产品需要跨浏览器、跨设备查看未触发定时器，需要后端提供定时器观测；否则第一版明确为当前浏览器本地记录。

## 11. 分阶段实施路线

### 阶段 A：建立产品规格与可靠 Mock

目标：后续 UI 开发可以完全依赖 Mock，并且不再继续扩大契约偏差。

阶段 A 的范围、交付物、非目标和逐项完成证据以[阶段 A：产品契约与可靠 Mock](PHASE-A.md)为准。阶段 A 同时包含设计和基础设施施工，不是纯文档阶段，也不是阶段 B–E 的产品功能施工。

状态：**已完成（2026-08-17）**。完成证据见 PHASE-A §7。

任务：

- 建立 `docs/interaction-specs/`；
- 建立 capability manifest 初版；
- 重构 Mock 为协议层、领域状态层、场景控制层；
- 修正 lobby 和 membership；
- 模拟 coreactor、system actor、registrar；
- 建立第一批场景矩阵；
- 引入真实浏览器 E2E，而不只是 wire/fold E2E；
- 增加 Mock 与后端 JSON fixture/契约的漂移检查。

完成标准：

- 首次登录、多频道、消息、审批、断线、权限撤销、频道退役可稳定复现；
- 每个场景可通过一个启动参数或控制命令进入；
- Mock 不再向 root 推送 lobby feed；
- Mock 不再全频道广播；
- 浏览器测试能验证频道内容、按钮状态和错误提示。

### 阶段 B：修复当前产品正确性

阶段定义、边界、交付物和验收证据以[阶段 B：修复当前产品正确性](PHASE-B.md)为准。

状态：**已完成（2026-08-17）**。完成证据见 PHASE-B §9。

任务：

- 区分我的频道、空间频道和访问状态；
- 解决 self actor 映射；
- 支持结构化终态；
- 保留完整 provisional 状态；
- 频道退役/权限变化后收敛 UI；
- 修正普通频道管理 actor 解析；
- 更新 DESIGN、BUILD-SPEC、TESTING 中的旧假设。

### 阶段 C：完成核心协作

阶段定义、边界、交付物和验收证据以[阶段 C：完成核心协作](PHASE-C.md)为准。

状态：**已完成（2026-08-17）**。完成证据见 PHASE-C §10。

任务：

- actor.describe；
- 动态能力选择和结构化参数；
- cancel；
- steer/interrupt/queue；
- stop/terminate/restart 的高风险确认；
- 审批过期和重复处理；
- 长任务状态和恢复。

### 阶段 D：频道治理

阶段定义、边界、交付物和验收证据以[阶段 D：频道治理](PHASE-D.md)为准。

状态：**已完成（2026-08-17）**。完成证据见 PHASE-D §9。

任务：

- 创建/查看/退役频道；
- 添加 human/agent/tool；
- 移除/重启 Actor；
- 处理新频道异步 serving；
- 频道设置和权限反馈。

### 阶段 E：空间治理、资源和自动化

阶段定义、边界、交付物和验收证据以[阶段 E：空间治理、资源和自动化](PHASE-E.md)为准。

状态：**已完成（2026-08-17）**。完成证据见 PHASE-E §7。

任务：

- Actor/频道模板；
- overlay、profile、endpoint；
- 安全的设备管理；
- KV 资源；
- 文件上传下载和附件；
- 定时器。

## 12. 总体完成标准

一个能力只有同时满足以下条件才算完成：

- 能力在产品能力地图中登记；
- 已纳入用户交互总规格；复杂共享状态有必要的技术附录；
- 明确权限和展示条件；
- 明确状态机和成功证据；
- 所有稳定错误码有中文含义和恢复策略；
- 至少一个正常 Mock 场景；
- 至少一个失败或异常 Mock 场景；
- 有真实浏览器 E2E；
- 明确是否需要真实服务端验证；
- 阶段指定的真实契约验证已经通过；标记为发布前运行时 smoke 的项目不得由 Mock 冒充证明；
- 文档、Mock 和实现对同一 contract version 无漂移。

## 13. 待决策事项

1. “我的频道”由后端提供显式 membership 投影，还是由 Web 根据 feed 与名册组合推断？建议后端显式提供。
2. principal 到频道 human actor 的映射放在 OBS、attach receipt，还是新的 membership 投影？
3. observe 是否进入近期产品范围？生产 Observer 未启用前建议不进入。
4. Agent 正式文本类型最终使用什么名字？
5. 设备管理是否等待安全 list 投影后再做？建议等待。
6. 定时器第一版是浏览器本地记录，还是要求跨端可观测？
7. 模板、设备、资源等高级治理能力是进入主界面，还是独立管理区域？

## 14. 下一步

阶段 A–E 的能力施工、Mock、单元测试、真实 Chromium 回归和文档审计已经完成。协议/能力轨道后续仍保留发布前真实 atoll smoke：真实 daemon 路由/磁盘、设备 key 生命周期与 binding 投影、真实 class config、并发权限和 timer 跨端可观测性；这些不属于用 Mock 冒充完成的范围。

前端产品体验进入独立改进轨道，状态、设计阶段 D0–D2、施工波次 F1–F6 和唯一下一步以[前端产品体验改进总计划](FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md)为准。阶段 A–E 完成不代表新一轮前端体验设计和施工已经完成。

阶段内不再为每个小动作暂停确认；只有产品范围、安全边界或不可逆业务决策才升级给用户决定。
