# 阶段 A：产品契约与可靠 Mock

状态：已完成
日期：2026-08-17
上位文档：[产品交互总任务](PRODUCT-INTERACTION-MASTER-PLAN.md)
产品基线：[用户交互总规格](USER-INTERACTION-SPEC.md)

## 1. 阶段目标

阶段 A 的目标只有一个：**建立一套可信、可重复、可验证的产品契约与 Mock 测试底座，使阶段 B–E 的前端开发不依赖启动真实 atoll 服务，同时不会因为 Mock 偏差把错误产品行为实现进去。**

阶段 A 不是“完成全部产品 UI”，也不是“只写完设计文档”。它包含必要的设计和基础设施施工：先固定产品能力与真实协议的映射，再把该映射落实为分层 Mock、场景控制、契约检查和真实浏览器测试。

## 2. 输入基线

阶段 A 只接受以下事实来源，优先级由高到低：

1. `../atoll` 当前代码中的 wire、OBS、registrar、actor introspection 和文件数据面契约；
2. [产品交互总任务](PRODUCT-INTERACTION-MASTER-PLAN.md)中的能力范围和 Mock/真实服务端边界；
3. [用户交互总规格](USER-INTERACTION-SPEC.md)中的产品旅程；
4. 两份复杂状态技术附录；
5. 旧的 BUILD-SPEC、TESTING 和现有实现，仅作为迁移输入，不得覆盖以上基线。

## 3. 阶段交付物

### A1. 产品规格基线

- 产品交互总任务；
- 用户交互总规格；
- 频道访问状态附录；
- 消息与结构化终态附录；
- 文档之间的阶段命名、范围和下一步没有冲突。

### A2. Capability Manifest

建立机器可读的 `contracts/product-capabilities.json`，覆盖阶段 A–E 的产品能力。每项至少登记：

- 稳定能力 ID 和所属阶段；
- 用户任务和 UI 区域；
- 真实后端入口及目标 Actor；
- 前置权限、成员和生命周期条件；
- receipt 与最终成功证据；
- Mock 场景；
- 浏览器验收 ID；
- 是否必须做真实服务端契约验证；
- 当前实现状态。

Manifest 必须通过 schema/语义测试；未知阶段、重复 ID、缺失成功证据或引用不存在场景均视为失败。

### A3. 三层 Mock

Mock 必须形成清晰的三层边界：

1. **协议层**：严格校验 HTTP、WS v2、OBS 和文件 ticket 形状；
2. **领域状态层**：维护 principal、membership、频道、Actor、feed、请求、审批、资源、定时器和生命周期；
3. **场景控制层**：选择初始场景、推进虚拟时间、注入故障、读取去敏后的内部状态和重置。

Mock 业务变化必须先改变领域状态，再由协议层投影为 receipt、feed、OBS 或文件响应。测试控制接口不得成为产品 UI 的数据来源。

### A4. 必需场景

阶段 A 至少可重复提供：

| 场景 ID | 必须证明的行为 |
|---|---|
| `first-login` | 登录后没有成员频道，不暴露 lobby，能够看到可发现频道 |
| `multi-channel` | 至少两个成员频道，账本、未读和动态消息彼此隔离 |
| `message-flow` | submit receipt、延迟入账、provisional、工具活动和终态完整出现 |
| `approval` | 待审批、成功处理、重复处理和过期 |
| `network-drop` | 断线、重连、按 cursor 回放且不重复展示 |
| `permission-revoked` | 当前频道成员资格撤销后停止写入并收敛 UI |
| `channel-retired` | 频道退役后 OBS、feed 和写权限一致收敛 |
| `projection-delay` | receipt、feed、OBS 可独立延迟，UI 不把未知结果判为失败 |

每个场景必须可通过启动参数或控制接口选择；相同 seed 和虚拟时间输入产生相同业务序列。

### A5. 语义纠偏

- 登录后的 root 不接收也不显示 `c0.lobby` feed；
- 空间频道树不等于“我的频道”；membership 必须是独立领域事实；
- feed 只推送给有读取资格或显式 observe 的连接，不全频道广播；
- `system`、`registrar`、`svcactor` 是 Mock 中真实存在的标准 Actor，但产品默认隐藏；
- 普通频道管理走该频道 coreactor；空间治理走 c0 registrar seat；
- receipt 只表示动作被接受，feed/OBS 收敛才是业务完成证据；
- Mock 的错误码、字段闭集和结构化结果与真实 atoll 契约一致。

### A6. 契约漂移检查

测试中保存由真实 atoll 源码确认的最小 JSON fixtures，至少覆盖：

- WS frame、receipt、error、feed 和 observe_ended；
- OBS channels、profile、actors、principals、daemons 和 decls；
- registrar 结构化成功与稳定失败结果；
- actor.describe；
- resource file ticket。

Mock 对这些 fixtures 的解析或生成出现字段漂移时，测试必须失败。fixture 只覆盖 JSON 契约，不声称替代真实服务端的并发、持久化和安全验证。

### A7. 真实浏览器 E2E

浏览器测试必须运行真实 Vite 页面并连接 Mock，而不是仅用 Node WebSocket 调协议。至少断言：

- 登录和会话恢复；
- “我的频道 / 空间”分组正确且没有 lobby；
- 切换频道后标题、消息、输入上下文和名册同步改变；
- Mock 动态消息只进入对应频道；
- 发送状态经历提交、接受和入账；
- 审批按钮状态和错误提示正确；
- 断线重连、权限撤销和频道退役有用户可见反馈；
- 标准系统 Actor 不显示。

测试使用可观察条件等待，不使用固定长睡眠冒充完成证据。

## 4. 非目标

以下内容属于阶段 B–E，阶段 A 只在 Manifest 和 Mock 中为其建立可靠契约与场景，不要求完成正式产品 UI：

- 完整频道访问 UI 和结构化终态修复（阶段 B）；
- describe、任务控制和高级审批 UI（阶段 C）；
- 频道治理 UI（阶段 D）；
- 空间治理、资源、文件和自动化 UI（阶段 E）。

为了完成阶段 A 浏览器验收而做的最小 UI 纠偏可以进入阶段 A，但不得借此宣称后续阶段完成。

## 5. 完成标准与证据

阶段 A 只有在下列全部成立时才完成：

- [x] A1 四类规格存在且相互一致；
- [x] A2 Manifest 覆盖 A–E，语义校验测试通过；
- [x] A3 Mock 三层在代码目录和依赖方向上可识别；
- [x] A4 八个必需场景可选择、重置并确定性复现；
- [x] A5 七条语义纠偏均有自动测试；
- [x] A6 契约 fixtures 与漂移测试通过；
- [x] A7 真实浏览器 E2E 全部通过；
- [x] `npm test` 通过；
- [x] `npm run build` 通过；
- [x] TESTING.md 给出一条命令式复现路径；
- [x] 最终审计逐项引用文件、测试输出或浏览器截图作为证据。

任何一项缺失、仅有计划或只能人工想象，都不能把阶段 A 标记为完成。

## 6. 执行顺序

```text
固定阶段 A 定义
  → Capability Manifest
  → 三层 Mock 设计与模块边界
  → 领域状态和场景控制施工
  → 语义纠偏与场景测试
  → 契约 fixtures / 漂移检查
  → 真实浏览器 E2E
  → 完成标准逐项审计
```

上述顺序是阶段 A 内部工作顺序，不创建新的阶段编号。

## 7. 完成审计（2026-08-17）

| 要求 | 权威证据 | 结论 |
|---|---|---|
| A1 产品规格 | `PRODUCT-INTERACTION-MASTER-PLAN.md`、`USER-INTERACTION-SPEC.md`、两份 `interaction-specs` 附录；阶段名称统一为 A–E | 已证明 |
| A2 Capability Manifest | `contracts/product-capabilities.json` 共 24 项，覆盖 A–E；`tests/capabilities.test.js` 4 项通过 | 已证明 |
| A3 三层 Mock | `mock/protocol.mjs`、`mock/domain.mjs`、`mock/scenarios.mjs`，由 `mock/server.mjs` 单向组合 | 已证明 |
| A4 场景与确定性 | 13 个场景可通过环境变量/reset 选择；`mock-scenarios` 与 `e2e.mock` 覆盖 reset、seed、虚拟时间、故障和 projection delay | 已证明 |
| A5 语义纠偏 | `channel-access`、`mock-scenarios`、`mock-governance`、`e2e.mock` 和浏览器测试覆盖 lobby、membership、投递资格、系统 Actor、治理路由与 receipt/feed 分离 | 已证明 |
| A6 契约漂移 | `tests/fixtures/atoll-contract-v2.json` 与 `tests/contract-fixtures.test.js` 覆盖 WS、六类 OBS、registrar、describe 和 file ticket | 已证明 |
| A7 真实浏览器 | `tests/browser/phase-a.spec.js` 在 Chromium 中执行 4 条用例、10 个验收编号，全部通过 | 已证明 |
| 全量自动化 | `npm run test:all`：16 个 Vitest 文件、47 项测试通过；4 项 Playwright 通过；Vite build 通过 | 已证明 |
| 复现说明 | `docs/TESTING.md` 提供安装、单命令、场景、控制 API、人工点验和真实后端边界 | 已证明 |

阶段 A 至此完成。后续产品功能施工从阶段 B 开始，不回头重新定义阶段 A。
