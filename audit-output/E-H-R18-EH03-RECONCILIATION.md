# E–H round 18 — EH03 public-owner reconciliation

审计基线：当前 HEAD `9761bd6`。本轮只同步 E–H case ledger 并记录公开 owner 复现；没有修改 `src/`、vendor、package、lockfile，也没有重建治理或 Activity owner。

## 结论

**ACCEPT：EH03-01、EH03-02、EH03-03。** `668bd55` 已经证明两条治理过滤 case；旧 ledger 没有同步，仍把它们列成 REGRESSION。本轮复跑当前公开治理 owner，均通过。EH03-03 原先的 reconnect settled-retention 红证据也不再复现：`ChannelFeedRuntime` 现在按同一 `channelId + parent_id(requestId)` 保留并收敛 durable work，Activity Center/搜索通过现有公开 owner 返回原始 SourceRef，不新增索引或兼容层。

旁证：HEAD 已包含既有 Replica redaction owner/test（`7095f07`），EH08-12 的原始 IndexedDB 3-case 也通过；因此总账当前为 **253/256 strict proven**，仅 EH09-08/09/14 保留 expected-red fixture evidence。

## Case ledger

### EH03-01 — Channel Context 隐藏标准 Actor

- **基线旧行为 / setup → action → result：** 旧 `ChannelGovernance` fixture 给出包含业务成员、`system`、`registrar`、`svcactor` 的 raw roster；用户进入公开“成员”页；标准 system/peer actor 不出现在业务成员列表，普通 Root/业务成员仍可见。
- **用户能力：** 管理员能看到可管理的业务成员，而不会把连接系统身份误当成可管理成员。
- **不变量：** 标准 identity 按 actor id 或 declaration id 识别并过滤；过滤不能由 fixture 预清洗；普通 actor 不能随过滤一起消失。
- **当前公开 owner / entry point：** `ChannelAdministrationPanel` → `ChannelMembers` → `isVisibleActor`（`src/model/actor-visibility.js`）。治理 panel 消费 raw `port.roster`，没有恢复旧 `ChannelGovernance`。
- **公开证据：** `tests/f5-management.test.jsx` 保留 raw roster 并通过 DOM 查询 Root/system/registrar/svcactor；`tests/management-actors.test.js` 与 `src/model/actor-visibility.test.js` 保留普通 actor。`668bd55` 的 4-file/11-test closure run 通过；本轮组合复跑的 9-file/28-test run 也通过。
- **处置：** **PROVEN-MERGED / ACCEPT。** 既有产品 owner 修复为 `b57f72e`；本轮只读复核和同步 ledger。

### EH03-02 — 添加成员候选排除 genesis declaration

- **基线旧行为 / setup → action → result：** 旧添加流程同时给出普通 `demo:agent` 与 genesis `svcactor` declaration；用户打开公开候选 SelectMenu；普通 declaration 可选，genesis/system declaration 不得成为业务成员候选。
- **用户能力：** 管理员能选择合法业务参与者，同时不会把 genesis service declaration 引入频道治理。
- **不变量：** declaration eligibility 在现有治理 owner 的 predicate 中决定；不能通过删除 fixture 候选或恢复旧 API 获得假绿。
- **当前公开 owner / entry point：** `ChannelAdministrationPanel` → `ChannelMembers` → `isManageableDeclaration`（`src/model/actor-visibility.js`）。
- **公开证据：** raw declarations 同时保留 `demo:agent` 与 `svcactor`；公开 SelectMenu 只显示合法候选。`tests/f5-management.test.jsx`、`tests/management-actors.test.js`、`src/model/actor-visibility.test.js` 以及 `668bd55` closure run 通过；本轮组合复跑通过。
- **处置：** **PROVEN-MERGED / ACCEPT。** 既有产品 owner 修复为 `b57f72e`；本轮未改治理产品。

### EH03-03 — Activity 与搜索返回规范 SourceRef，并保持 durable activity 生命周期

- **基线旧行为 / setup → action → result：** 旧复合 fixture 同时覆盖 Activity Center/Operation Center 与 Global Search。用户打开活动或搜索结果并点击“返回来源”；结果必须使用规范 `SourceRef` 返回正确频道/视图/对象，而不是从标题或当前频道猜测。旧生命周期还要求同一 durable request 在同 boot reconnect 后可由 history terminal 收敛；boot 变化或 history-only processing 不能重新制造活性。
- **用户能力：** 从全局活动/搜索结果回到真实来源；重连期间不误报旧活动，但可以在同一运行世界中准确结束同一请求；无权威操作事实时不给出假操作入口。
- **不变量：**
  - Activity facts 由 `WorkspaceApp.activityPort` 从可见频道 `selectFeatureTaskFacts` 与 `feed.agentActivity` 投影；`WorkspaceRightPanel`/`ActivityFeature` 只消费该 port。
  - Activity row 将已有 `item.source` 原样交给唯一公开 `commands.open`，不得从文案、channel name 或 `{target: requestId}` 重造来源。
  - `ChannelFeedRuntime.observeAgentActivity` 以 `channelId + parent_id` 作为同一 message/request key；terminal 没有当前 key 时不结算；同 boot history terminal 可结束保留工作，boot 变化后 history-only processing 不复活。
  - `operationsUnavailable` 优先于 rows；没有后端事实时显示不可用状态并且没有可点击 operation row。
- **当前公开 owner / entry point：**
  - Activity：`WorkspaceLayout` rail → `WorkspaceApp.activityPort` → `WorkspaceRightPanel(panel="activity")` → `ActivityFeature`/`ActivityRows`。
  - Activity lifecycle：`src/model/channel-feed-runtime.js` 的 `agentActivity` snapshot/attach/reconnect owner。
  - Search：`SearchFeature` / `src/model/feature-search.js` 的 canonical SourceRef。
- **公开证据：**
  - `tests/activity-center-accessibility.test.jsx`：精确断言活动 row callback 收到同一个 `source` object；操作事实 unavailable 时不渲染缓存/伪造 row、不提供“返回来源”按钮；入口 accessible name、panel focus、Escape、回源均通过。
  - `tests/feature-search.test.js`：跨频道 search index 的 artifact/work-item/turn SourceRef 与去重规则通过。
  - `tests/agent-activity.test.js`：live 代次生成 active；断线隐藏；同 boot 的 exact live work 允许 history terminal settle；boot 改变后清空，history-only processing 不 revive；housekeeping 忽略。
  - 真实入口 `tests/browser/workspace-activity-center.spec.js`：Activity Center 从 live Workspace Feed 组合并回到来源、频道切换后不保留旧 panel、无进行中操作与 drop/disconnect 时进入明确 unavailable state；`ATOLL_TEST_WEB_PORT=16373 ATOLL_TEST_MOCK_PORT=19832 npx playwright test ... --workers=1` 为 **2 passed (8.6s)**。
  - 本轮 unit 定向组合（治理、search、runtime、Activity accessibility、timer/filter）为 **9 files / 28 tests passed**。
- **处置：** **PROVEN-MERGED / ACCEPT。** UI owner 来自既有 `dfce865`，same-boot runtime 修复来自既有 `e09169e`；本轮没有改产品或新建 owner。`668bd55`/旧 ledger 的 OWNER-MAPPED 只代表旧快照，不能继续覆盖当前 HEAD 的严格证据。

## 总账同步与未决项

- 将 EH03-01/02 从 REGRESSION、EH03-03 从 OWNER-MAPPED 更新为 `PROVEN-MERGED`。
- 将 HEAD 已有 `7095f07` redaction evidence 对应的 EH08-12 从 REGRESSION 更新为 `PROVEN-MERGED`；本轮未改 Replica 产品。
- 当前统计：PROVEN-DIRECT 74、PROVEN-MERGED 179、owner-covered 253、REGRESSION 0、OWNER-MAPPED 0、FIXTURE-BLOCKED 3、NO-OWNER 0。
- 仍未闭合且保留原断言的只有 EH09-08 stale-refresh、EH09-09 channel-reset、EH09-14 rejected attachment fixture；没有删除、skip、私有 export 或兼容 API。
