# 阶段 D：频道治理

状态：已完成
日期：2026-08-17
上位文档：[产品交互总任务](PRODUCT-INTERACTION-MASTER-PLAN.md)
产品基线：[用户交互总规格](USER-INTERACTION-SPEC.md)

## 1. 阶段目标

阶段 D 的目标是：**让频道成员在不离开协作账本的前提下，完成频道创建、查看、退役和 human/agent/tool 编排，并能看懂“请求已接受、账本已完成、OBS 已出现、成员关系已建立、服务已就绪”这些彼此独立的事实。**

阶段 D 连续完成产品设计、状态模型、前端、Mock、单元测试和真实 Chromium 验收。模板编辑、profile/endpoint 编辑、设备、文件和自动化属于阶段 E。

## 2. 真实后端契约

| 用户动作 | 消息类型 | 目标 Actor | 严格 payload | 最终成功证据 |
|---|---|---|---|---|
| 创建根级子频道 | `channel.create` | c0 registrar seat | `{name, template?, overrides?}` | terminal `completed` + OBS channel + membership + `open=true` |
| 创建当前频道的子频道 | `channel.create` | 当前频道 `coreactor` | 同上 | 同上，父级由消息所在频道决定 |
| 查看频道详情 | `channel.get` / `channel.describe` | registrar 或当前频道 `coreactor` | `{channel_id}` | terminal 中的 ChannelRow；OBS 只提供摘要和 open measure |
| 退役频道 | `channel.retire` | c0 registrar 或频道 coreactor | `{channel_id}` | terminal `completed` + OBS 消失/retired + 当前频道停止写入 |
| 添加 human | `channel.introduce_actor` | 当前频道 `system` | `{kind:"human", principal}` | terminal `{instance_id, created}` + roster/membership 收敛 |
| 添加 agent | 同上 | 当前频道 `system` | `{kind:"agent", decl_id, principal?}` | terminal + roster；显式 principal 可选 |
| 添加 tool | 同上 | 当前频道 `system` | `{kind:"tool", decl_id}` | terminal + roster；禁止 principal |
| 移除 Actor | `channel.remove_actor` | 当前频道 `system` | `{instance_id}` | terminal `{removed}` + roster/membership 收敛 |
| 重启 Actor | `channel.restart_actor` | 当前频道 `system` | `{instance_id}` | terminal `{restarted}`；同一实例恢复 serving/presence |

所有 payload 均为闭集。`system`、`svcactor`、`coreactor`、registrar seat，以及维持父子频道关系的 foundation peeractor 是受保护 Actor；前端不提供破坏按钮，后端仍以 `protected_actor` 为最终权威。

## 3. 产品入口和布局

- 左侧频道栏提供“新建频道”，默认父级为当前可写频道；c0 中创建根级子频道。
- 中间频道标题提供“管理频道”，打开治理抽屉，不挤压或替换消息账本。
- 抽屉包含“概览、成员、危险操作”三个连续区域；关闭后返回原消息上下文。
- 创建结果显示独立收敛阶段：请求已提交、账本确认、频道可观察、成员关系、服务就绪。任一步未完成时保留已完成事实并允许继续等待/打开，不把部分成功写成失败。
- human 候选来自 `/obs/space/principals`；agent/tool 候选来自 `/obs/space/decls`。系统声明默认过滤。
- 移除、重启和退役必须先展示影响说明并进行明确确认；退役要求输入当前频道名称。

## 4. 状态与恢复

治理动作仍是普通 RequestTurn，receipt 只表示 transport 接受，terminal 才是业务操作结果。页面刷新后以频道账本重新构建 terminal；登录初始化、WS 重连以及频道/成员/设备治理事件会使频道目录、membership 和 roster 的 OBS 投影失效并触发合并刷新。前端不再周期扫描整个频道树。

创建流程状态：

```text
editing → submitting → accepted → ledger_completed
  → observable → membership_visible → serving → ready
                             ↘ partial / failed
```

Actor 流程状态：

```text
submitting → accepted → ledger_completed → roster_converged
                                      ↘ failed / convergence_pending
```

## 5. 错误反馈

- `invalid_args` / `bad_payload`：保留表单并定位输入问题；
- `permission_denied` / `unauthorized_sender` / `forbidden`：说明当前身份无治理权限；
- `conflict_exists`：频道同级名称冲突；
- `protected_actor`：标准或 foundation Actor 不能移除/重启；
- `not_found`：目标已变化，刷新频道或名册；
- `not_serving` / `receiver_unavailable` / `result_unknown`：展示已完成事实并继续通过 OBS/账本核对。

## 6. 阶段边界

阶段 D 不提供模板 CRUD、声明 CRUD、overlay、profile/endpoint 编辑、设备绑定、KV、文件、附件和定时动作。创建表单可选择已有模板，但模板管理属于阶段 E。

## 7. 验收矩阵

| ID | 用户可见验收 | 自动证据 | 完成 |
|---|---|---|---|
| D-01 | c0 使用 registrar，普通频道使用 coreactor 创建子频道 | model/unit + `D-BR-01` | ✓ |
| D-02 | 名称、父级和模板表单遵循真实闭集 payload | model/unit + `D-BR-01` | ✓ |
| D-03 | 创建过程分别展示 terminal、OBS、membership、serving | model/unit + `D-BR-02` | ✓ |
| D-04 | 投影延迟时不误报失败，刷新后可继续收敛 | Mock + `D-BR-03` | ✓ |
| D-05 | 概览展示 id、父级、owner、状态、serving 和子频道 | `D-BR-04` | ✓ |
| D-06 | 退役需精确确认，退役后不可写但保留历史 | model/unit + `D-BR-05` | ✓ |
| D-07 | principal 与 declaration 候选来自 OBS 并过滤不可用项 | model/unit + `D-BR-06` | ✓ |
| D-08 | 添加 human 使用 principal，结果与 roster/membership 收敛 | Mock + `D-BR-06` | ✓ |
| D-09 | 添加 agent/tool 使用 decl_id，kind 必须匹配 | Mock + `D-BR-07` | ✓ |
| D-10 | 移除使用 `instance_id`，成功后名册收敛 | contract + `D-BR-08` | ✓ |
| D-11 | 重启使用 `instance_id` 并反馈 serving/presence | contract + `D-BR-09` | ✓ |
| D-12 | 标准/foundation Actor 无危险操作入口，后端拒绝仍可读 | model/unit + Mock | ✓ |
| D-13 | 权限、冲突、声明、启动和受保护错误可理解且保留上下文 | Mock + `D-BR-10` | ✓ |
| D-14 | Manifest、BUILD-SPEC、TESTING、总文档同步 | static audit | ✓ |
| D-15 | 阶段 A–C 回归、D Chromium、生产构建和代码卫生全通过 | `npm run test:all` | ✓ |

## 8. 完成门槛

只有 D-01 至 D-15 全部有当前工作树证据，真实 Chromium 连接 Mock 完成连续验收，且真实服务端仍需验证的并发、权限和 serving 边界被明确保留，阶段 D 才能标记完成。

## 9. 完成审计（2026-08-17）

| 要求 | 当前工作树证据 | 结论 |
|---|---|---|
| 后端契约 | 对照 `../atoll/platform/lagoon/contracts.go`、`registrar.go`、`internal/sysactor/operate.go`、`home/opentry.go` 和 lifecycle/e2e 测试；修正 remove/restart 为 `instance_id`，c0 不再伪造 coreactor | 已证明 |
| 产品与状态模型 | `src/model/channel-governance.js` 和 5 项单测覆盖名称、路由、闭集 payload、保护规则、创建与 Actor 双层收敛 | 已证明 |
| 频道治理 UI | 左栏创建入口、标题管理入口、概览/成员/危险操作抽屉、用途/模板、详情、退役和部分成功进度均已接入 | 已证明 |
| Actor 治理 UI | principals/decls OBS 候选，human/agent/tool，重启/移除确认，owner/标准 Actor 保护，名册与 serving 状态 | 已证明 |
| Mock | 33 个场景中的 4 个阶段 D 场景；严格字段、真实目标 Actor、权限拒绝、投影延迟、protected_actor 和 OBS 收敛 | 已证明 |
| Manifest | 阶段 D 共 4 项能力，全部 `implementation=complete`，引用 D-BR-01..10 和实际场景 | 已证明 |
| 全量自动化 | `npm run test:all`：26 个 Vitest 文件、75 项测试通过；30 项 Playwright 通过；Vite build 通过 | 已证明 |
| 静态门禁 | legacy API/subscribe/font 搜索无结果；`git diff --check`、Manifest JSON 与 D capability 审计通过 | 已证明 |

施工中的真实浏览器测试发现并处理了三类问题：现有 Mock 把 remove/restart 错写成 `actor_id`；c0 名册伪造了真实后端不存在的 coreactor；新增 human 的可见身份是实例 `alice-home` 而不是 principal `alice`。前两项修正了产品/Mock 契约，第三项校正了验收断言，并保留 UI 同时显示实例与 principal 的模型能力。

Mock 不能证明真实进程装配、设备 placement、并发 owner/core 权限和退役后的持久化边界；这些项目已保留在 TESTING §16 的发布前真实服务端 smoke，不冒充阶段 D 的 Mock 证据。

阶段 D 至此完成。下一阶段为阶段 E“空间治理、资源和自动化”。
