# 阶段 C：完成核心协作

状态：已完成
日期：2026-08-17
上级计划：[产品交互总任务](PRODUCT-INTERACTION-MASTER-PLAN.md)
前置阶段：[阶段 B：修复当前产品正确性](PHASE-B.md)

## 1. 阶段定义

阶段 C 的目标只有一个：**让用户能够发现频道内业务 Actor 的真实能力，以结构化参数发起操作，并安全地控制、恢复和审批长任务，而不把 presence、receipt 或临时状态误当作业务完成。**

本阶段连续完成产品设计、状态模型、前端、Mock、单元测试和真实 Chromium 验收。第 9 节全部证据成立前不得标记完成。

## 2. 真实 Atoll 契约裁决

### 2.1 Actor 能力

- `actor.describe` 是发给目标 Actor 自身的普通 request；空 payload 返回完整 Describe，`{type}` 返回 DescribeType；
- 结构化结果通常位于 completed terminal 的 `payload.value`；
- Describe 是能力唯一权威，OBS 名册不携带 capability；
- TypeMeta 可包含 `allowed_kinds`、`max_pending_ms`、`payload_example`、`payload_fields`、`input_schema`、`output_schema`、`error_codes` 和 `notes`；
- `max_pending_ms` 是体验提示，不是前端自行判失败的截止时间；
- actor presence 只是建议性状态，能否服务仍由 send → terminal 证明。

### 2.2 Agent 控制

- Agent 只有在 Describe 中声明某个控制类型时才展示入口；
- `agent.steer` payload 使用 `text`，可附 `expected_turn_id` 做 CAS；该 turn id 来自 processing provisional；
- `agent.queue` payload 使用 `text`；
- `agent.interrupt`、`agent.hold`、`agent.unhold`、`agent.replace` 使用普通 request 和结构化 terminal；
- steer 可能合并、抢占、排队或以 `cas_mismatch` 失败，不允许前端预先宣称结果；
- stop、terminate、restart 是高风险动作，只能从 Actor 详情进入并二次确认。

### 2.3 Cancel

- cancel 是 WS 控制帧，不是新的账本 request；
- 只有原 request sender 能取消，且请求必须仍未关闭；
- receipt 只表示 cancel 已被接受；原请求出现带 `cancelled:true` 的 failed terminal 才表示账本收敛；
- `unauthorized_sender`、`request_not_found`、`already_closed`、断线和超时必须分别解释。

### 2.4 审批

- resolve 支持 `approved|rejected` 和可选 JSON object payload；
- 请求的 `expires_at` 是账本事实，过期后前端禁用决策但不伪造 terminal；
- 真实后端尚未规定“resolve payload Schema”的统一载体。本阶段支持审批 request payload 中的 `response_schema` 或 `resolve_schema`；没有可识别 Schema 时提供安全 JSON object 降级，不静默丢字段；
- 重复、并发关闭和权限变化保留原审批卡及错误事实。

## 3. 产品范围

### C1 能力详情

- 点击业务 Actor 打开详情，显示声明身份、presence 与能力加载状态；
- 首次打开或手动刷新时向该 Actor 提交 `actor.describe`；
- 从账本重建 Describe 缓存，刷新页面后不依赖内存 Promise；
- 完整 Describe 和单类型 Describe 可合并；
- description、skill_doc、类型、参数、耗时、错误码、恢复建议和原始脱敏 JSON 均可查看；
- describe 失败、Actor 离线或返回旧 Schema 时保留上次结果并明确标记。

### C2 动态调用

- 仅展示 `allowed_kinds` 允许 request 的能力；
- JSON Schema 优先，其次 payload_fields/payload_example，最后安全 JSON object 编辑器；
- 支持 string、number、integer、boolean、enum、object 和 array；
- required、类型和 JSON 解析在发送前校验；未知 Schema 关键字不静默丢字段，自动进入原始 JSON 模式；
- 所有调用仍走阶段 B 的稳定 message id、submission 和 fold，不建立管理旁路。

### C3 任务级控制

- 只有“本人发起 + 未终结 + member_active”的回合显示 cancel；
- 只有目标 Agent Describe 声明支持且 turn_id 可用时显示 steer；
- interrupt 与 cancel 分开呈现；
- cancel、steer、interrupt 的 submitting、accepted、terminal、uncertain 和失败状态可解释；
- 切频道和刷新不改变控制对象。

### C4 Actor 级控制

- queue 从 Actor 详情发起并提供文本参数；
- stop、restart 需要显式风险确认；
- terminate 必须输入完整 Actor id 确认；
- 高风险操作提交后显示账本结果，不以 OBS bound/presence 代替结果；
- 操作完成后刷新名册，但 presence 只作为辅助事实。

### C5 审批完善

- 审批显示请求方、动作、影响说明、过期时间和处理状态；
- response_schema/resolve_schema 生成结构化字段，用户填写内容随 resolve payload 原样发送；
- 无 Schema 时支持 JSON object，解析失败不能发送；
- 过期审批禁用；already_closed、request_not_found、not_in_audience、forbidden 都显示中文原因；
- 终态显示 decision、处理者和结构化结果；刷新后由账本恢复 settled 状态。

### C6 长任务状态与恢复

- 未出现 terminal 的回合保持运行/排队/等待，不因 process progress 伪造完成；
- processing 中的 turn_id 可恢复任务控制上下文；
- `expires_at` 和 TypeMeta `max_pending_ms` 只显示时间提示；超时前端不伪造失败；
- 页面刷新、断线 replay 和重复 feed 后任务、控制请求与审批都只保留一个账本事实；
- 控制请求本身也是独立 RequestTurn，能够显示 provisional、结构化 terminal 和异常。

## 4. 明确不属于阶段 C

- 创建、退役频道和增删/restart 频道成员的治理 UI（阶段 D）；
- Actor/频道模板、overlay、profile、endpoint 和设备（阶段 E）；
- 文件、KV 资源和定时动作（阶段 E）；
- 正式启用 observe 产品入口；
- 修改真实 atoll 来新增 approval response schema、membership/self 投影或 provider 状态投影；
- 为每一种业务能力手写专用页面。通用 Schema 表单不能表达时安全降级为 JSON。

## 5. 状态与模块设计

```text
feed actor.describe turn
  → capability index(channel + actor)
  → Actor 详情 / TypeMeta / 动态表单
  → 普通 submit
  → submission + RequestTurn + terminal

open self request
  → cancel eligibility
  → WS cancel receipt
  → 原 request cancelled terminal

open Agent request + processing.turn_id + Describe controls
  → steer / interrupt
  → 新控制 RequestTurn
  → merged / preempted / queued / failed / completed
```

计划模块：

- `src/model/capabilities.js`：Describe 解包、账本重建、TypeMeta 规范化、风险与支持判断；
- `src/model/dynamic-form.js`：Schema/payload_fields 到字段模型、类型转换、校验与 JSON 降级；
- `src/model/task-controls.js`：cancel/steer/interrupt eligibility、turn_id、等待提示；
- `src/ui/ActorDetails.jsx`：能力详情、调用表单和高风险确认；
- `Timeline`：任务级 cancel/steer/interrupt 与增强审批；
- `App`：控制状态编排，所有动作绑定原 channel/request/actor。

## 6. Mock 场景

| 场景 | 必须证明 |
|---|---|
| `actor-capability` | 完整 Describe、Schema 表单、错误文档与普通调用 |
| `long-running` | 可恢复 processing、turn_id、cancel、steer、interrupt 和 queue |
| `control-conflict` | cas_mismatch、already_closed、unsupported 与控制 uncertain |
| `actor-lifecycle` | stop、terminate、restart 二次确认与结构化结果 |
| `approval-schema` | Schema 字段、结构化 resolve payload 和终态 |
| `approval-expired` | expires_at 已过期且不能提交 |
| `approval-conflict` | already_closed/not_in_audience/forbidden 的保真展示 |

Mock 控制口需要支持开始/完成长任务、外部关闭审批、切换 Actor 支持能力和注入控制帧故障。产品代码不得读取控制口。

## 7. 后端缺口与发布验证

- approval resolve Schema 没有标准字段，本阶段兼容 `response_schema|resolve_schema` 并保留 JSON 降级；建议后端后续规范化；
- Agent 标准控制 TypeMeta 当前只声明描述和 allowed kinds，缺少 payload_fields/schema/error_codes；Web 使用已知标准控制 payload 作为兼容层，但仍以 Describe 是否出现该类型决定入口；
- stop/terminate/restart 没有统一 provider 状态 OBS，terminal 是动作结果权威，名册 presence 不是服务承诺；
- Mock 可以完成全部日常 UI 开发；真实运行时仍需验证 provider 控制、cancel 热路径、CAS 并发和真实 Schema 翻译。

## 8. 验收矩阵

| ID | 用户可见验收 | 自动证据 | 完成 |
|---|---|---|---|
| C-01 | 点击 Actor 可加载并从账本恢复 Describe | capability 单测 + C-BR-01 | ✓ |
| C-02 | TypeMeta 的参数、耗时、错误和恢复建议可理解 | capability 单测 + C-BR-01 | ✓ |
| C-03 | Schema/payload_fields/JSON 降级均保真校验 | dynamic-form 单测 + C-BR-02 | ✓ |
| C-04 | 动态能力调用沿用稳定 submission/fold | submission/mock 单测 + C-BR-02 | ✓ |
| C-05 | cancel 仅对本人开放任务出现，receipt 后等待原终态 | task-control/mock 单测 + C-BR-03 | ✓ |
| C-06 | cancel 的关闭、越权、断线和超时可解释 | mock/submission/control-action 单测 + C-BR-04 | ✓ |
| C-07 | steer 使用 processing.turn_id，结果不预判 | task-control/mock 单测 + C-BR-05 | ✓ |
| C-08 | queue 和 interrupt 与 cancel 语义分离 | capability/mock 单测 + C-BR-05/06 | ✓ |
| C-09 | stop/restart 二次确认，terminate 输入 Actor id | C-BR-07 | ✓ |
| C-10 | 高风险动作只在 Actor 详情且以 terminal 为结果 | C-BR-07 | ✓ |
| C-11 | 审批 Schema 输入原样进入 resolve terminal | dynamic-form 单测 + C-BR-08 | ✓ |
| C-12 | 过期、重复、并发和权限错误保留原事实 | mock 单测 + C-BR-09 | ✓ |
| C-13 | 刷新/重连后长任务、turn_id 和控制资格恢复 | control-action/fold 单测 + C-BR-10 | ✓ |
| C-14 | DESIGN、BUILD-SPEC、TESTING、Manifest 与总计划一致 | JSON、链接、旧状态与文档审计 | ✓ |
| C-15 | 阶段 A/B 回归、阶段 C Chromium 和生产构建全通过 | `npm run test:all` | ✓ |

## 9. 完成门槛

1. 第 8 节十五项均有当前工作树中的直接证据；
2. 阶段 C 所有入口均由 Describe、任务归属、终态和频道访问状态共同决定；
3. 高风险动作不能绕过确认，cancel 不能与 interrupt 混用；
4. Mock 场景可确定性重置，不依赖长睡眠；
5. `npm run test:all`、`git diff --check`、JSON、文档链接和旧状态搜索全部通过；
6. 真实后端缺口与发布 smoke 明确保留，不以 Mock 通过冒充服务端完成。

## 10. 完成审计（2026-08-17）

| 范围 | 当前工作树直接证据 | 结论 |
|---|---|---|
| C1/C2 能力详情与动态调用 | `capabilities`、`dynamic-form`、`mock-phase-c` 单测；C-BR-01/02；Actor 详情显示 notes、耗时、错误和恢复建议 | 已证明 |
| C3 任务级控制 | `task-controls`、`control-actions`、`mock-phase-c`；C-BR-03/04/05；cancel receipt 与 terminal 分离，steer 使用 turn_id | 已证明 |
| C4 Actor 级控制 | C-BR-06/07；queue/interrupt 独立回合，stop/restart/terminate 风险确认不可绕过 | 已证明 |
| C5 审批完善 | `dynamic-form` 与 Mock resolve 契约；C-BR-08/09 覆盖 Schema、过期、四类错误和外部处理 | 已证明 |
| C6 长任务恢复 | fold/feed cache、control-action 持久化；C-BR-10 刷新后保持一个回合和全部控制资格 | 已证明 |
| Manifest 与 Mock | Manifest 共 30 项/30 场景，6 项阶段 C 能力已标记完成；7 个阶段 C 场景可 reset | 已证明 |
| 全量自动化 | `npm run test:all`：25 个 Vitest 文件、70 项测试；24 条 Playwright（阶段 C 10 条）；Vite build 通过 | 已证明 |
| 静态与文档 | `git diff --check`、Manifest JSON、禁用旧接口搜索、11 份 Markdown 链接检查均通过 | 已证明 |
| 真实服务端边界 | §7 保留 provider cancel、CAS 并发、真实 Schema 翻译与 approval Schema 载体 smoke | 已证明未冒充 |

施工中的真实浏览器测试还发现并修复了四项原实现问题：周期 OBS 刷新覆盖动态表单输入；非频道结构化 `payload.value` 被空表格吞掉；`cancelled:true` 被误写成普通超时；resolve forbidden 使审批卡消失。Describe renderer 同时统一为从 `payload.value` 解包，阶段 A/B 回归未受损。

阶段 C 至此完成，下一阶段为阶段 D“频道治理”。
