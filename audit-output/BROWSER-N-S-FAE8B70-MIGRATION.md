# Browser N–S 分区迁移与逐 test 裁决

基线：`fae8b70` 及其当前工作树生产入口。范围只覆盖 `tests/browser` 中 basename 为 N–S 的六个 spec；没有删除 test、fixture、import 或失败证据，也没有修改产品实现。

## 2026-09-20 disconnect/Composer guard 后冻结复验（当前裁决）

本节取代下方早先在 `cbd8591` disconnect 修复前记录的“当前裁决”。复验使用真实入口和同一 15 条 case；`cbd8591` 已在当前 HEAD 的祖先中。复验期间工作树含 Composer owner 的 Tiptap 生命周期 guard（仅产品 owner 的工作树候选，本测试侧没有编辑它），因此结果同时验证了 disconnect 修复后的剩余合同。

命令与证据目录：

```text
ATOLL_TEST_WEB_PORT=15260 ATOLL_TEST_MOCK_PORT=18900 npx playwright test \
  tests/browser/N-im-read-fallback.spec.js \
  tests/browser/notification-high-water.spec.js \
  tests/browser/notification-policy.spec.js \
  tests/browser/offline-composer-recovery.spec.js \
  tests/browser/performance-budget.spec.js \
  tests/browser/reading-position-session.spec.js \
  --reporter=line --output=test-results-browser-n-s-post-composer-guard-20260920
```

结果：**15 tests，5 passed，10 failed（3.3m）**；没有 skip、删 case、删 fixture 或弱化断言。`--list` 仍为 **15 tests / 6 files**，六个 spec 均通过 `node --check`。最终轮没有出现 `feed.disconnectHistory owner 尚未连接` 或 Tiptap `editor.view.dom`/`schema=null` uncaught；针对 N2 的单测也越过频道切换，继续在真实 tail-notice 合同断言处失败，证明断开 owner 截断点已被隔离。

| spec | 结果 | 当前失败边界 |
|---|---:|---|
| `N-im-read-fallback.spec.js` | 1 passed / 3 failed | N3 通过；N1/N2 在唯一 owner `gap=0` 时仍出现 related badge；N4 raw rail `authorityReady=false` 且过滤外 unread 未保留。 |
| `notification-high-water.spec.js` | 4 failed | 频道切换可继续，但 high-water rail snapshot/hydration 未建立或未推进；没有再被 disconnect/Composer 崩溃截断。 |
| `notification-policy.spec.js` | 2 failed | final readable root 没有产生预期 rail unread；readable-event row 已物化，但没有对应物理 `reading.observation`。 |
| `offline-composer-recovery.spec.js` | 1 passed | 离线 draft/recipient/reconnect exactly-once 仍通过。 |
| `performance-budget.spec.js` | 3 passed | huge ledger、waiting queue、mobile browsing 均通过。 |
| `reading-position-session.spec.js` | 1 failed | 频道往返已不再清空 workspace，但回返后原 browsing row 未在 reading owner 中恢复到可见位置。 |

独立 Composer/Tiptap 结论：旧候选（仅有 `cbd8591`）曾在切频道被动 effect 读取未挂载或已销毁 EditorView，抛出 `[tiptap error]: The editor view is not available` 并清空 root；当前 guard 复验不再观察该 uncaught。N2 仍 RED 的原因是切回后真实通知 receipt/rail 时序（`noticeFrames` 有 related=1–3），不是 Composer selector 或 fixture。Composer 相关产品修复仍由公开 owner `src/ui/composer/Composer.jsx` 负责，测试侧没有改动 `src/`。

## 总数与当前裁决

| 维度 | 数量 |
|---|---:|
| spec 总数 / 已读 / 已迁 / 未处理 | 6 / 6 / 6 / 0 |
| test 总数 / 已读 / 已迁 / 未处理 | 15 / 15 / 15 / 0 |
| 当前真实入口通过 | 5 |
| 当前真实产品缺口（失败，不是旧 selector/import 误报） | 10 |
| fixture 删除 | 0 |

迁移后的单 spec 运行结果：

- `N-im-read-fallback.spec.js`: **1 passed, 3 failed**；N3 通过，N1/N2/N4 分别暴露尾部几何、频道切换 owner、过滤读权威缺口。
- `notification-high-water.spec.js`: **4 failed**；四条都已进入真实 `main.jsx → WorkspaceApp.jsx`，失败由频道切换崩溃或当前持久化/读行缺口造成。
- `notification-policy.spec.js`: **2 failed**；旧 `[data-entry-id]` 已迁至真实 `[data-presentation-row-id]`，失败为频道切换崩溃及 readable event 未物化。
- `offline-composer-recovery.spec.js`: **1 passed (13.9s)**。
- `performance-budget.spec.js`: **3 passed (27.6s)**。
- `reading-position-session.spec.js`: **1 failed**；已进入真实 reading owner，失败为频道切换时 `feed.disconnectHistory owner 尚未连接`。

合计：**5 passed / 10 failed**。失败都保留为产品缺口，未用删除断言、跳过场景或改产品来伪造绿色。

冻结头聚合复核（`ATOLL_TEST_WEB_PORT=15220 ATOLL_TEST_MOCK_PORT=18870 npx playwright test <六个 spec> --reporter=line`）：**15 tests，5 passed，10 failed（3.2m）**；与逐 spec 裁决一致。

## 真实入口迁移边界

当前生产链路是：

`src/main.jsx → src/app/WorkspaceApp.jsx → createChannelFeedRuntime → ConversationSurface → ReadingContainerHandoff/VendorListExecutor`。

因此各证据已绑定如下当前文件：

- N 读侧证据：`main.jsx`、`WorkspaceApp.jsx`、`channel-feed-runtime.js`、`history-demand.js`、`notification-policy.js`、`ConversationSurface.jsx`、`ReadingContainerHandoff.jsx`、`VendorListExecutor.jsx`；viewport 统一使用 `reading-owner.js` 的 canonical owner，具体 DOM 是唯一的 `.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list`。
- notification high-water：通过真实登录、频道点击、rail badge、reading owner、刷新和未来到达行为进入 `main.jsx` → `WorkspaceApp.jsx` → feed runtime；证据来自可见行为和公开 DOM owner。
- notification policy：IndexedDB 已从不存在的旧 `atoll-feed-v8/channelMeta` 迁到实际 `atoll-channel-replica-v1/{rows,meta}`；presentation identity 已从不存在的 `data-entry-id` 迁到实际 `data-presentation-row-id`；scope 已从旧 `@我` 迁到实际 `与我相关/全部`。
- offline composer：旧 `<select aria-label="添加 @ 收件人">` 已迁到真实消息编辑器 `role=textbox[name=消息]` 的 `@st → role=option steward` recipient flow；draft 断言按 contenteditable 的真实 text contract。
- performance waiting：旧 `目标 Agent.selectOption` 已迁到实际 `选择 Agent → 选择目标 Agent → menuitem steward`。
- reading position：缓存已从旧 `atoll-feed-v8` 迁到实际 `atoll-channel-replica-v1.rows`；通过真实冷进入、唯一 owner 的滚动、频道往返和刷新行为核对 `view-session.v3`/reading session。

## 逐 test 合同、价值与运行裁决

### N-im-read-fallback.spec.js

| test | UX 合同 | 能力 / 架构价值 | 裁决 |
|---|---|---|---|
| N1 有积压跳到最新即同时清零，且停在底部连续到达 20 条时两处计数恒为 0 | 用户回到底部后 jump、频道徽标和 pending 必须同时归零；继续实时到达不可闪出未读。 | 验证唯一 reading owner 的物理 tail、append 后几何稳定，以及 presentation receipt 驱动的通知 high-water，而不是显示层压零。 | **RED（产品缺口）**：最终轮唯一 owner 始终 `gap=0`、`mode=following`（47/47 tail frames、无 off-tail），但连续 arrival 仍出现 related badge 1–5；afterLeaving 为 0。几何/selector 已排除，剩余是 following receipt/rail 清零时序。证据：`test-results-browser-n-s-post-composer-guard-20260920/.../N1-following-tail.json`。 |
| N2 别的频道到达计入未读，切回并到底后一次清零 | 离开频道期间未读隔离；回到该频道真实到底后一次清零，当前频道不被兜底污染。 | 验证 channel feed runtime 的 active-channel 边界、独立 cursor/high-water 与 reading lifecycle disconnect/connect。 | **RED（产品缺口）**：`cbd8591` 后切换可完成；Composer guard 后真实 owner 继续执行，但回到 `c0.project` 的 following tail 在 39 帧中仍出现 related badge 1–3（无 off-tail，离开后为 0）。不是旧 selector/fixture，也不再是 disconnect 或 Tiptap 截断。证据：`.../N2-other-channel.json`。 |
| N3 页面不可见时到达计入未读，恢复可见并在底部后清零 | 页面 hidden 时提醒不能丢；恢复可见且到底后清零。 | 验证 `visibilitychange`、可见性 gate、实时到达与 receipt 的组合，不依赖旧层结构。 | **PASS**（迁移后 1/1）。 |
| N4 成员过滤视图真实到底时本 scope 计数为 0，过滤外未读始终保留 | actor filter 内的已看项清零；filter 外 unrelated item 必须继续提示。 | 验证 scope projection 与 raw rail truth 分离，防止把所有频道通知粗暴清零。 | **RED（产品缺口）**：最终轮 raw rail 为 `channels=[]`（等价 `authorityReady=false`），`outsideFilterPreserved=false`；唯一 owner/当前 selectors 均已工作。证据：`.../N4-persistence-failure.json`。 |

### notification-high-water.spec.js

| test | UX 合同 | 能力 / 架构价值 | 裁决 |
|---|---|---|---|
| tail acknowledgement survives channel switches and reload while a future row notifies | 切频道、刷新后已读不复活；未来 row 才产生一条新提醒并可再次清零。 | 直接约束 `channel-feed-runtime` 的 `notificationHighWater`、`acknowledgeNotifications` 与 replica checkpoint 的耐久性。 | **RED（产品缺口）**：切换与 Composer guard 均通过，但 afterAcknowledgement 的公开 rail snapshot 没有 channel row，high-water/readSeq 无法兑现；不是旧入口或 selector。 |
| cached hydration cannot resurrect a tail-acknowledged notification | 冷启动 hydration 不得把已确认尾部重新显示为未读。 | 验证 `atoll-channel-replica-v1` rows/meta hydration 与 cursor/high-water 的恢复顺序。 | **RED（产品缺口）**：真实两次 approval 的初始未读在 reload 后没有恢复为预期 `2`；当前 hydration/high-water 契约未兑现，非旧 DB 名或 selector。 |
| a filtered tail acknowledges the channel notification boundary | 在过滤 scope 的尾部确认只推进该可见边界，不吞掉其他 scope。 | 验证 filtered projection、channel boundary 和 exact presentation receipts 的组合。 | **RED（产品缺口）**：切换与 filter 操作可完成，但 `atFilteredTail.rail.channels[0]` 缺失，无法证明 boundary/high-water；不是旧 selector，需修复公开 rail authority。 |
| a continuously followed related arrival advances only after the mounted tail presents it | following 状态只有 mounted tail 真正呈现新 related row 后才前进 high-water。 | 验证 append/render/receipt 的时序，防止“数据已到但用户未见”即 ack。 | **RED（产品缺口）**：切换可完成，但 10s 内 `notificationHighWater` 未从初值推进；mounted tail presentation receipt 未兑现。 |

### notification-policy.spec.js

| test | UX 合同 | 能力 / 架构价值 | 裁决 |
|---|---|---|---|
| rail follows presented lifecycle roots and persists only unacknowledged exact identities | lifecycle processing/tool/control 等 transport root 不应冒充用户提醒；可读 final root 按 exact identity 跨刷新保留。 | 验证 `notification-policy` 的事件分类、root identity、presentation receipt 与持久化 rail 的边界。 | **RED（产品缺口）**：频道切换可完成，但 readable final 后 `.unread-total` 没有出现 `1`；当前 lifecycle→rail readable root 没有物化为未读。 |
| tool, timer, and public-event notifications follow independent readable roots | tool/timer/public event 各自独立 readable root；只有物理可见 row 触发对应提醒。 | 验证事件 taxonomy 不把独立 readable body 合并/吞掉，并把可见性绑定真实 presentation row。 | **RED（产品缺口）**：`c0.project-notification-readable-event` row 已在真实 DOM 出现，但没有被唯一 owner 的 `reading.observation.visibleRowIDs` 记录；不是旧 `data-entry-id` 选择器误报。 |

### offline-composer-recovery.spec.js

| test | UX 合同 | 能力 / 架构价值 | 裁决 |
|---|---|---|---|
| offline draft restores after reload and sends exactly once when reconnected | 离线仍可编辑；刷新保留正文与 steward recipient；恢复连接后只发送一次并清空编辑器。 | 验证 composer draft durability、recipient snapshot、本地 outbox 与 reconnect dedupe 的真实链路。 | **PASS**（迁移后 1/1，6.1s）。 |

### performance-budget.spec.js

| test | UX 合同 | 能力 / 架构价值 | 裁决 |
|---|---|---|---|
| huge ledger paints the latest message before and after reload with a bounded rendered window | 14k+ ledger 冷/热启动都快速显示最新消息，DOM window 有上界。 | 验证真实 history admission、VendorListExecutor/virtualized presentation 的性能与 reload 冷热路径。 | **PASS**。 |
| a full waiting queue remains visible and operable | 8 条等待消息全部可见，可折叠再展开而不丢操作。 | 验证 waiting layer 的队列状态、交互可操作性和非 timeline 内容区的架构隔离。 | **PASS**（真实 Agent menu flow）。 |
| mobile repeated history browsing keeps content visible and the rendered window bounded | 390px 移动视口反复浏览历史仍有内容、rendered window 有界。 | 验证 responsive profile 与历史虚拟窗口在连续滚轮下的可用性。 | **PASS**。 |

### reading-position-session.spec.js

| test | UX 合同 | 能力 / 架构价值 | 裁决 |
|---|---|---|---|
| F7 reading position is document-session memory: cold and cached page starts use latest | 冷进入和 cache reload 都从最新 tail 开始；文档 session 内临时浏览位置可跨频道往返保留；旧 legacy bookmark 不得成为启动 authority。 | 验证 `view-session.v3` preferences/readings 分层、`reading-session` startup policy、replica cache 与唯一 reading owner 的边界。 | **RED（产品缺口）**：切换已完成且 workspace 不再清空，但回到 `c0` 后原 browsing row 未在 60s 内回到唯一 owner 可见区域；reading-session/virtualized admission 仍缺口。 |

## 静态与入口校验

- `npx playwright test <六个 spec> --list`：列出 **15 tests**。
- 六个迁移后的 spec 均通过 `node --check`。
- target specs 中不再引用旧 `src/App.jsx`、`AppShell.jsx`、`useChannelFeed.js`、`cursors.js`、`useReadingSession.js`、`LegendMessageList.jsx`、`atoll-feed-v8`、`channelMeta`、`data-entry-id`、`@我` 或旧 recipient `<select>`；入口证明来自真实 DOM/行为。
- 每个 browser login 都核对当前 workspace heading、可见 timeline、`state-open`、无可见 `.top-error`；N/notification/reading/performance 额外核对唯一 active reading owner。N1 对 mounted row 数量、ID 唯一性、布局宽高和 DOM 顺序取证；offline 对编辑器 focus/text/send-one-shot 取证；performance waiting 对 8 条队列消息的顺序和输入 focus 取证。
- 失败证据和断言均保留；本轮没有调整 `src/` 产品实现，也没有删除或弱化 fixture。

## 运行时共同缺口（当前复验）

`cbd8591` 的 disconnect 幂等修复已生效：最终 15-test 轮没有 `feed.disconnectHistory owner 尚未连接`，频道切换也不会再直接清空 workspace。Composer owner 的 Tiptap guard 复验同样没有 uncaught；N2 越过切换继续暴露通知合同失败。当前 10 个 RED 应按公开 owner 分组交接：

- following/tail receipt 时序：N1、N2；物理 owner 已保持 `gap=0`，但可见尾部 arrival 仍短暂产生 related badge。
- filter/rail authority：N4；raw rail 没有建立 authority，过滤外 unread 不保留。
- high-water/replica projection：notification-high-water 四条；rail snapshot/hydration 缺失或 high-water 不推进。
- lifecycle/readable presentation：notification-policy 两条；final readable root 不产生预期 unread，readable-event 虽有 row 但没有 physical reading observation。
- reading-session admission：F7；频道往返不再崩溃，但原 browsing row 未恢复到可见 owner。

这些均是产品 owner 的公开边界问题；本分区没有通过修改 fixture、增加兼容 owner、删除断言或改动 `src/` 来掩盖失败。
