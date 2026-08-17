# 阶段 B：修复当前产品正确性

状态：已完成
日期：2026-08-17
上级计划：[产品交互总任务](PRODUCT-INTERACTION-MASTER-PLAN.md)
前置阶段：[阶段 A：产品契约与可靠 Mock](PHASE-A.md)

## 1. 阶段定义

阶段 B 的目标只有一个：**让用户当前已经能够执行的频道浏览、发消息、查看处理过程和处理审批，在 Mock 与真实 atoll 契约下都不会对频道权限、自己的 Actor 身份或请求结果作出错误判断。**

阶段 B 同时包含产品设计、状态模型、前端施工、Mock 场景、自动测试和浏览器验收。只有本文件第 7 节的全部证据成立，阶段 B 才算完成。

## 2. 为什么必须先做阶段 B

阶段 A 建立了可信契约与测试底座，但当前产品仍存在以下正确性风险：

- 空间中可见的频道可能被误当成“我的频道”或可写频道；
- 断线、频道停服、权限撤销和频道退役在组件中被混成同一种不可用；
- 真实 OBS 的 human Actor 行没有 principal 字段，前端可能无法识别“我”；
- feed 早于 receipt 时，当前 self Actor 学习和 pending 对账会失败；
- request 以 correlation 而不是 request id 为主键，同一业务链可能互相覆盖；
- 五种 provisional 被压扁成 processing，命名空间 provisional 被当成孤儿；
- 第二个冲突终态可能覆盖第一终态，response/activity 先到时不能恢复归并；
- successful terminal 没有 text 时显示空白，结构化结果不可理解；
- 切换频道后，异步 receipt、pending 或审批动作可能错误使用新的 active channel；
- 普通频道没有 registrar 席位，管理命令必须识别 coreactor，不能写死 c0 名册结构。

## 3. 阶段范围

### B1 频道访问事实

- 统一 existence、runtime、relationship、freshness 四个维度和 mode selector；
- 左栏明确分为“我的频道”和“空间”；
- 断线时成员频道进入 stale，停服时进入 unavailable，二者均保留缓存但禁止写入；
- 权限撤销后立即禁用写入并从“我的频道”降级；
- 完整 OBS 确认退役后清除未读、移出协作列表并给出可理解提示；
- incomplete/失败 OBS 不得把缺失频道误判为退役；
- lobby 与标准内部 Actor 不进入普通产品列表；
- Observer 状态进入模型，但生产后端未装配 Observer 时不展示可操作入口。

### B2 self Actor 映射

- 优先读取未来可能出现的 OBS `declared.principal`；
- 每次 submit 在发送前生成稳定 message id，并在发送前登记；
- request feed 与该 id 对账后学习 `channel_id → self_actor_id`，无论 feed 与 receipt 谁先到；
- self 映射按 principal、频道和 contract version 持久化；
- 成员资格撤销或 principal 变化后不再把旧映射当作当前权威；
- self 未知时普通消息仍可发送，但审批、“我”、排除自己和精确未读不得静默猜测。

### B3 请求与回合模型

- 客户端 submission 与账本 RequestTurn 分层；
- submit 前生成稳定 id；transmitting、accepted、uncertain、rejected、landed 语义分明；
- receipt 或 feed 任意先到均只显示一个请求；
- timeout/发送后断线显示“发送结果待确认”，不谎报确定失败；
- pending 永远绑定发送时 channel id，切频道不串线；
- request id 是回合主键，correlation 支持一对多；
- response/activity 优先按 parent_id，乱序项可在 request 到达后归并；
- 第一条 terminal 是权威终态，后续冲突只记录 anomaly；
- activity.turn.ended 和 provisional 永不伪造终态。

### B4 完整 provisional 与结构化终态

- 保留 received、queued、processing、deferred、unavailable 的原值、顺序和 payload；
- 合法命名空间 provisional 作为业务进行态展示；
- terminal 后到达 provisional 不重新打开回合；
- completed text、空文本、空成功、对象、数组、registrar 包装结果和 Actor describe 均有非空展示；
- failed 同时保留 reason、error_code、detail 和其他结构化诊断；
- 通用结构化展示默认遮蔽敏感字段，并允许复制脱敏 JSON；
- 大数组先显示摘要，避免一次展开阻塞主时间线。

### B5 普通频道管理 Actor 解析

- system actor 由保留 Actor id `system` 识别；
- c0 的 registrar 由 `decl_id=atoll-internal:registrar-seat` 识别；
- 普通频道的上级治理入口由 `decl_id=coreactor` 识别，不能假设 Actor 实例 id；
- `/channels` 在 c0 发给 registrar，在普通频道发给 coreactor；
- 缺少对应 Actor 时明确报错，不向任意 tool 猜测发送。

### B6 文档基线收敛

- 更新 DESIGN：删除“所有 present 频道都是频道栏”“feed 足以发现全部成员频道”“OBS 已提供 principal”等旧假设；
- 更新 BUILD-SPEC：以阶段 B 的 access、fold、submission 和 renderer 模型为当前实现；
- 更新 TESTING：加入阶段 B 单元、Mock、浏览器和真实服务端最小验证；
- capability manifest 的阶段、实现状态、场景和浏览器证据与实际一致。

## 4. 明确不属于阶段 B

- 正式启用 observe/unobserve 产品入口（生产 Observer 尚未装配）；
- cancel、steer、interrupt、queue、stop、terminate、restart 的完整任务控制体验（阶段 C）；
- Actor describe 的主动能力面板和动态表单（阶段 C；阶段 B 只保证其终态可渲染）；
- 创建/退役频道和增删/重启 Actor 的正式管理界面（阶段 D；阶段 B 只修正现有命令路由和结果展示）；
- 模板、资源、文件、设备和定时器（阶段 E）；
- 修改 atoll 服务端来补 membership 投影或 principal 字段。

## 5. 后端缺口下的产品裁决

真实 atoll 当前没有 `/obs/space/memberships`，channel actors 的 human 行也没有 principal。阶段 B 不伪造这两个事实：

- Mock 的 membership OBS 是带 `mock_extension:true` 的测试扩展；
- 真实后端用当前会话 feed、成功业务 receipt 和本地 stale 证据逐步确认 member；`owner_principal` 只表示频道所有者，不能单独当作 membership；
- 没有历史、不是 owner、也从未发送过消息的成员频道，在后端补显式 membership 前无法被完整发现，作为已确认的服务端能力缺口保留；
- self Actor 使用“客户端 id → request feed sender.id”对账学习；在第一次本人 request feed 前保持未知；
- UI 明确显示“正在确认频道身份”，不得把任一 human 行猜成当前用户。

## 6. 交付物

- 本阶段唯一说明：`docs/PHASE-B.md`；
- 更新后的共享规格：频道访问状态、消息与结构化终态；
- 频道访问 tracker/reducer 和持久化；
- request-id 主键 fold、乱序归并、anomaly 模型；
- submission 状态与跨频道正确对账；
- 通用/registrar/describe 结构化 renderer；
- 普通频道 management actor resolver；
- 阶段 B Mock 场景和控制动作；
- 阶段 B 单元、契约和真实 Chromium E2E；
- DESIGN、BUILD-SPEC、TESTING、capability manifest 同步更新。

## 7. 验收矩阵

| ID | 用户可见验收 | 自动证据 | 完成 |
|---|---|---|---|
| B-01 | 成员、空间、stale、unavailable、denied、retired 不混淆 | channel-access 单测 + B-BR-01/02/03 | ☑ |
| B-02 | 断线保留缓存且禁写，重连后恢复 | access/wire 单测 + B-BR-02 | ☑ |
| B-03 | 权限撤销与退役分别收敛，partial OBS 不误删 | access/Mock 单测 + B-BR-03 | ☑ |
| B-04 | self 映射支持 feed 先于 receipt，未知时不猜测 | roster/submission 单测 + B-BR-04 | ☑ |
| B-05 | request id 主键、correlation 一对多、乱序归并 | fold 单测 | ☑ |
| B-06 | 五种核心和命名空间 provisional 完整保留 | fold/renderer 单测 + B-BR-05 | ☑ |
| B-07 | 第一终态不被冲突/迟到状态覆盖 | fold anomaly 单测 + B-BR-05 | ☑ |
| B-08 | receipt/feed 任意顺序不重复，断线/超时进入 uncertain | submission/Mock 单测 + B-BR-06/07 | ☑ |
| B-09 | pending 与审批动作不因切频道串线 | App 浏览器测试 B-BR-08 | ☑ |
| B-10 | 文本、空成功、结构化、registrar、describe、failed 均可理解 | renderer 单测 + B-BR-05/09/10 | ☑ |
| B-11 | 敏感字段默认遮蔽，大结果摘要展示 | renderer 单测 + B-BR-09 | ☑ |
| B-12 | c0/普通频道管理 Actor 按 decl_id 正确解析 | resolver 单测 + B-BR-10 | ☑ |
| B-13 | lobby 和标准 Actor 始终不进入业务列表 | roster/access 单测 + B-BR-01 | ☑ |
| B-14 | DESIGN、BUILD-SPEC、TESTING、manifest 无旧假设 | 文档审计与搜索 | ☑ |
| B-15 | 全量测试、真实 Chromium 和生产构建通过 | `npm run test:all` | ☑ |

## 8. 完成门槛

阶段 B 完成时必须同时满足：

1. 第 7 节十五项全部有当前工作树中的直接证据；
2. 两份交互规格的实现状态更新为与阶段 B 交付一致；
3. capability manifest 中阶段 B 的实现状态和验收 ID 可由测试反查；
4. `npm run test:all`、`git diff --check` 和文档/JSON 解析检查通过；
5. 使用 Mock 在真实 Chromium 中完成阶段 B 连续验收；
6. 对第 5 节的真实后端缺口不作虚假“已解决”声明。

## 9. 完成审计（2026-08-17）

| 验收域 | 当前工作树中的直接证据 | 结论 |
|---|---|---|
| B-01..03 访问事实 | `src/model/channel-access.js`；`tests/channel-access.test.js`；B-BR-01..03 覆盖断线、停服、partial、明确撤权和退役 | 已证明 |
| B-04 self Actor | `src/model/roster.js` 在发送前登记 id；request feed 学习 sender；`real-backend-shape` 移除 Mock 扩展；roster 单测与 B-BR-04 | 已证明 |
| B-05..07 fold | `src/model/fold.js`；`tests/fold-phase-b.test.js` 覆盖一对多、response/activity 先到、五种核心和业务 provisional、迟到与冲突终态 | 已证明 |
| B-08..09 submission | `src/model/submissions.js` 与 App 原频道闭包；receipt/feed 延迟和丢失场景；B-BR-06..08 同时覆盖 pending 与审批切频道 | 已证明 |
| B-10..11 terminal | `src/ui/StructuredResult.jsx`；结构化/空/失败/describe 场景；B-BR-09 验证脱敏和 25 项摘要，B-BR-10 验证 registrar | 已证明 |
| B-12 管理 Actor | `src/model/management-actors.js`、resolver 单测及普通频道 `/channels` 浏览器测试 | 已证明 |
| B-13 内部对象隔离 | lobby 过滤、`roster-visibility` 单测及 B-BR-01 | 已证明 |
| B-14 文档与 Manifest | DESIGN、BUILD-SPEC、TESTING、两份交互附录和 7 个阶段 B Manifest 能力已同步；JSON 与搜索检查通过 | 已证明 |
| B-15 全量门槛 | `npm run test:all`：21 个 Vitest 文件、60 项通过；14 项 Playwright 通过；Vite production build 通过；`git diff --check` 通过 | 已证明 |
| 后端边界真实性 | `real-backend-shape` 不提供 membership OBS/principal；生产 Observer 入口保持关闭；真实运行时 smoke 明确保留为发布前检查 | 未伪造 |

阶段 B 至此完成。下一阶段是阶段 C“完成核心协作”，不在阶段 B 中提前混入主动能力面板或任务控制施工。
