# `fae8b70` top-level Vitest A–D restore matrix

基线：`fae8b7010afd1b3a950bc455ba6a577b65378cda`。当前产品树：
`a8c91651315f9c2f225c11472f589e7cb605a772`。范围是 `tests/` 顶层、basename
以 A、B、C 或 D 开头的 `*.test.js` / `*.test.jsx`；不含
`tests/browser/`。

## 计数与口径

- 基线共 **42 套件、365 个 test/it 声明**；42 套件都已读取并逐套件作出裁决。
- **37 套件已迁移或已作“当前 owner / 有意删除”裁决**。其中“迁移”允许一个旧套件拆到多个当前 owner 测试；不要求保留旧文件名或旧导出。
- **5 套件待补当前 owner 证据**：`agent-information-architecture`、`app-agent-probe-lifecycle`、`atoll-session`、`channel-create-modal`、`devices-panel`。它们的旧 import 失败不是删除理由，也没有在本轮伪造旧模块兼容层。
- 当前 owner 候选中的 **8 条真实缺口/红证据** 已保留：7 条定向运行失败（activity boot reset、edit hold compact closure、两条 agent-selection current-owner 语义、channel access hide 规则、directory invalidation、Workspace 标题焦点）及 1 条 `artifacts` 的 `version_of` 关系缺口（以 `it.fails` 明示）。这些不能靠放宽断言或恢复旧 store 消除。
- 本轮只增加测试/报告；没有恢复 `fold.js`、旧 capability/activity/access/artifact/session/store API，也没有修改 vendor/package。

“已迁移”表示断言落在当前生产 owner；“有意删除”表示旧能力在当前产品合同中不再存在，测试只记录边界，不把旧行为伪装成仍可用。

## 套件裁决

| 基线套件 | 当前 owner 证据 / 裁决 | 结论 |
|---|---|---|
| `activity.test.js` | `feature-search.test.js`；搜索与可见频道已迁移，跨频道 Operation index 无当前 owner | 迁移；Operation Center 是产品缺口 |
| `actor-display.test.js` | 同名当前测试 | 迁移 |
| `agent-activity.test.js` | `agent-activity.test.js`、Workspace timer 测试；boot reset 有红证据 | 迁移 / 缺口 |
| `agent-control.test.js` | `agent-control.test.jsx` → `WaitingLayer`；hold resume / compact closure 各留红证据 | 迁移 / 缺口 |
| `agent-information-architecture.test.jsx` | Waiting/row/Composer owner 有分散证据，完整 21 条尚无一套当前 UI 证据 | 待处理 |
| `agent-probe-lifecycle.test.js` | 同名 `agent-probe-lifecycle.test.js` | 迁移 |
| `agent-selection.test.js` | `agent-selection.test.js`、`model-selector.test.jsx` → Composer + `projectAgentParameters`; 两条旧“最近交互/terminal 扫描”语义为红证据 | 迁移 / 缺口 |
| `app-agent-probe-lifecycle.test.jsx` | 当前 owner 是 `useAgentProbes`，但没有 App 组合层的替代套件 | 待处理 |
| `app-shell-composer-port.test.jsx` | `composer-command-port.test.js` + `src/model/composer-model.test.js`；唯一 committed command port、stale cleanup、能力门已测 | 迁移 |
| `app-shell-terminal-split.test.jsx` | Workspace terminal toggle/route/rail 测试；标题焦点交接保留红证据 | 迁移 / 缺口 |
| `artifact-preview-resolve.test.jsx` | `file-preview-stack.test.jsx`、`resources.test.jsx`、file-reference 测试 → `useAttachmentTransactions` | 迁移 |
| `artifacts.test.js` | `artifacts.test.jsx` → Replica + `feature-search`；`version_of` 关系以 `it.fails` 保留 | 迁移 / 产品缺口 |
| `atoll-session.test.jsx` | 旧 `useAtollSession` 已被 IdentityBoundary/Wire owner 吸收，尚无替代 hook 套件 | 待处理 |
| `attachment-picker.test.jsx` | `attachment-picker.test.jsx` → `useAttachmentTransactions`/FilesFeature | 迁移 |
| `browsing-fold-lease.test.js` | 同名当前测试 | 迁移 |
| `capabilities.test.js` | `capability-manifest.test.js` + Composer/agent-parameters；旧 `capabilityIndexFromState` 不恢复 | 迁移 / 旧 projection 有意删除 |
| `channel-access.test.js` | 当前 `createSessionAccess/accessMode` owner 的同名迁移测试；hide 规则留红证据 | 迁移 / 缺口 |
| `channel-create-modal.test.jsx` | 治理 port 有局部测试，但完整创建对话框/四步收敛没有当前替代 | 待处理 |
| `channel-feed-startup.test.jsx` | `channel-feed-runtime.test.jsx`、feed/arrival/checkpoint 测试；启动 27 条旧 UI 场景尚未全量重建 | 迁移 / 局部证据 |
| `channel-files.test.js` | `channel-files.test.jsx` → attachment transaction/files feature | 迁移 |
| `channel-governance.test.js` | `workspace-governance-features.test.jsx` + Composer system command；治理结果仍由当前 port 收敛 | 迁移 / 局部证据 |
| `channel-list.test.jsx` | Workspace rail/unread/Agent timer 测试；node update 分支无当前 owner | 迁移 / node update 产品缺口 |
| `channel-name-cache.test.js` | `channel-name-cache.test.js` → `createSessionAccess` + `useWireSession` 的 localStorage label owner | 迁移 |
| `channel-navigation.test.js` | `workspace-channel-navigation.test.jsx` → `WorkspaceLayout` keydown owner | 迁移 |
| `channel-replica.test.js` | 同名当前测试 | 迁移 |
| `code-block.test.jsx` | 同名当前测试 | 迁移 |
| `cold-entry-diagnostics.test.jsx` | 同名当前测试 | 迁移 |
| `content-plan-blocks.test.jsx` | 同名当前测试 | 迁移 |
| `content-plan-semantics.test.jsx` | 同名当前测试 | 迁移 |
| `content-plan.test.js` | 同名当前测试 | 迁移 |
| `contract-fixtures.test.js` | 同名当前测试 | 迁移 |
| `control-actions.test.js` | 旧 localStorage control store 已按 B11 有意删除；当前 terminal/Waiting 是 ledger + session-local UI，不恢复持久化副本 | 有意删除 |
| `conversation-behavior-fuzz.test.js` | 同名当前测试 → ReadingSession + Presentation | 迁移 |
| `conversation-presentation-react.test.jsx` | 同名当前测试 | 迁移 |
| `conversation-viewport.test.js` | 同名当前测试 → ReadingSession | 迁移 |
| `cursors.test.js` | old cursor owner 已拆为 Replica notification/arrival policy；现有 live-arrival/notification browser/unit 证据覆盖边界，36 条旧 cursor API 不恢复 | 迁移 / 旧 API 有意删除 |
| `device-profile.test.js` | 同名当前测试 | 迁移 |
| `devices-panel.test.jsx` | current files/device feature 有生产 port，但没有 DevicesPanel 当前 UI 套件 | 待处理 |
| `diagnostics.test.js` | 同名当前测试 | 迁移 |
| `directory-invalidation.test.js` | 追加到 `channel-feed-runtime.test.jsx`；当前 runtime 不再调用旧目录 invalidation writer，定向红证据保留 | 迁移 / 产品缺口 |
| `dynamic-f3.test.jsx` | Composer model/command port、model selector、attachment/file tests 分别承接；不恢复旧 Timeline/Fold fixture | 迁移 / 局部证据 |
| `dynamic-form.test.js` | 当前固定协议 slash command + `createComposerCommandRequest`；动态 JSON-schema form 已删除，不恢复 `dynamic-form.js` | 迁移 / 有意删除旧 API |

## 产品系统面专项

### Activity Center

旧 `activity.js` 同时承载搜索、WorkItem、artifact 和 Operation 的第二份跨频道事实。当前只保留 `feature-search`（由 Replica/Presentation 派生）与 rail 的 Agent activity/timer 投影；没有独立 Operation owner，也不能用旧 `buildOperationIndex` 重新造 store。结论：搜索与 rail 已迁移；“未收敛跨频道 Operation Center”是明确产品缺口，待产品决定 owner/落位后再建当前测试。

### node version/update

基线 `channel-list.test.jsx` 的 `update` prop、升级确认、verifying/succeeded 状态在当前 `WorkspaceLayout`/`WorkspaceApp` 没有对应 port 或 UI。当前仅有协议版本不兼容终止页 `VersionIncompatible`，它不是 node update。结论：这是产品缺口；不能把旧 `update` prop 或版本 store 复活，也不把旧测试改成无意义的 snapshot。

### channel restart

当前 Composer owner 已闭合：`/restart` 是 `system-target` command，目标 Agent 进入 payload.member，唯一 audience 是 `system`，并且没有目标/权限时被 command availability 拦截。证据在 `tests/composer-command-port.test.js`；未恢复旧 AppShell 命令转发或 Agent 自重启路径。

## 定向验证

```text
npx vitest run tests/capability-manifest.test.js tests/composer-command-port.test.js
Test Files  2 passed (2)
Tests       10 passed (10)
```

A–D 当前 owner 候选合跑时，已知红项均保留为产品/架构证据；本矩阵不把红项改成 skip，也不以 import 失败为删除理由。
