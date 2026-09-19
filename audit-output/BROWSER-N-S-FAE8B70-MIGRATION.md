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
| `notification-policy.spec.js` | 2 failed | readable-event row 已物化但没有对应物理 `reading.observation`；final line 154 的 unread 期待与 fixture audience 关系门控不相容，待合同裁决。 |
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
| 当前已确认真实产品缺口（失败，不是旧 selector/import 误报） | 9 |
| fixture/合同语义待决失败 | 1 |
| fixture 删除 | 0 |

迁移后的单 spec 运行结果：

- `N-im-read-fallback.spec.js`: **1 passed, 3 failed**；N3 通过，N1/N2/N4 分别暴露尾部几何、频道切换 owner、过滤读权威缺口。
- `notification-high-water.spec.js`: **4 failed**；四条都已进入真实 `main.jsx → WorkspaceApp.jsx`，失败由频道切换崩溃或当前持久化/读行缺口造成。
- `notification-policy.spec.js`: **2 failed**；旧 `[data-entry-id]` 已迁至真实 `[data-presentation-row-id]`；readable event 的失败是 DOM→Reading observation，final line 154 另受 fixture audience/合同语义门控影响。
- `offline-composer-recovery.spec.js`: **1 passed (13.9s)**。
- `performance-budget.spec.js`: **3 passed (27.6s)**。
- `reading-position-session.spec.js`: **1 failed**；已进入真实 reading owner，失败为频道切换时 `feed.disconnectHistory owner 尚未连接`。

合计：**5 passed / 10 failed**；其中 9 条已确认产品缺口，1 条为 fixture/合同语义待决。失败均保留，未用删除断言、跳过场景或改产品来伪造绿色。

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
| rail follows presented lifecycle roots and persists only unacknowledged exact identities | lifecycle processing/tool/control 等 transport root 不应冒充用户提醒；可读 final root 按 exact identity 跨刷新保留。 | 验证 `notification-policy` 的事件分类、root identity、presentation receipt 与持久化 rail 的边界。 | **RED（fixture/合同语义待决）**：实际 lifecycle final 的 audience 是 `project-agent` 而非当前 root actor `root-project`，关系门控使 `.unread-total` 不出现 `1`；不能直接交产品 rail owner。 |
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

`cbd8591` 的 disconnect 幂等修复已生效：最终 15-test 轮没有 `feed.disconnectHistory owner 尚未连接`，频道切换也不会再直接清空 workspace。Composer owner 的 Tiptap guard 复验同样没有 uncaught；N2 越过切换继续暴露通知合同失败。当前 9 个已确认产品 RED 与 1 个 fixture/合同待决失败应分开处理：

- following/tail receipt 时序：N1、N2；物理 owner 已保持 `gap=0`，但可见尾部 arrival 仍短暂产生 related badge。
- filter/rail authority：N4；raw rail 没有建立 authority，过滤外 unread 不保留。
- high-water/replica projection：notification-high-water 四条；rail snapshot/hydration 缺失或 high-water 不推进。
- lifecycle/readable presentation：notification-policy 的 readable-event 是 DOM→Reading observation 缺口；final root line 154 受 fixture audience/合同语义待决，不计入产品 RED。
- reading-session admission：F7；频道往返不再崩溃，但原 browsing row 未恢复到可见 owner。

除 final root 的 fixture/合同待决项外，其余均是产品 owner 的公开边界问题；本分区没有通过修改 fixture、增加兼容 owner、删除断言或改动 `src/` 来掩盖失败。

## notification owner 独立验收（提交前后）

验收只读产品代码，未改 spec、fixture、断言或 `src/`。同一 7 条目标 case（N2、N4、4 条 high-water、F7）分别运行于 owner 提交前、`a721412` 后和最终 `71dcb38` 后：

| 阶段 | 状态 | 结果 |
|---|---|---|
| 提交前（证据目录 `test-results-notification-owner-pre-20260920`，`a721412` 于证据完成后提交） | 预期行为基线 | **0/7 passed**；N2/N4/high-water/F7 全 RED。 |
| `a721412` `fix(notification): commit frozen channel confirmations` 后（`test-results-notification-owner-post-20260920`） | frozen boundary / authority revision 候选 | **0/7 passed**；7 条失败边界与提交前一致。 |
| `71dcb38` `fix(notification): reset cursor authority on world change` 后（`test-results-notification-owner-final-20260920`） | world cursor reset 完整候选 | 浏览器仍 **0/7 passed**；但新增 `tests/notification-state-contract.test.js` 为 **5/5 passed**，说明仅 unit persistence contract 变绿。 |

每条场景的预期状态转移与观察结果：

| 场景 | 预期状态转移 | 提交前 | `71dcb38` 后 |
|---|---|---|---|
| N2 | `c0` following → 离开；project arrival 计入 `unread=3`；切回并真实到底 → `badge/jump=0`；随后 6 次 following arrival 每帧保持 0；离开后 raw unread 仍 0。 | `whileAway=3`、`gap=0`、`afterLeaving=0`，但 following 帧出现 badge `1→5`。 | `whileAway=3`、`gap=0`、`afterLeaving=0`，仍出现 badge `1/3/2`；无 off-tail。 |
| N4 | actor filter 安装 → rail `authorityReady=true`；6 个 steward approval ack；outside unrelated row 保持 counted。 | rail `channels=[]`，`authorityReady=false`、outside false。 | 相同；cursor reset 未建立过滤 rail authority。 |
| high-water 1 | approvals 2 →切回确认 `readSeq=25, highWater=27, counts=0`；刷新不复活；未来 arrival → `highWater=28, counts=0`。 | afterAcknowledgement 的公开 rail channel 缺失。 | 相同，仍缺失。 |
| high-water 2 | reload hydration 先恢复 badge `2`；尾部确认至 `highWater=27`；二次 reload 保持 0。 | reload 后 badge `2` 未恢复。 | 相同。 |
| high-water 3 | filtered tail 只推进当前可见 boundary，rail channel `highWater=27, counts=0`，离开后不吞其他 scope。 | `atFilteredTail.rail.channels[0]` 缺失。 | 相同。 |
| high-water 4 | following mounted tail 呈现 arrival 后 `highWater > beforeBoundary` 且 counts=0。 | 10s 内 high-water 仍未推进。 | 相同。 |
| F7 | cold/cached 启动均 following 最新；browse 后 c0→project→c0 回返应恢复同一 `firstVisible.id` 与位置。 | 曾出现 `before=112 / after=111` 单行漂移。 | 回返等待 60s 超时，目标 row 未进入唯一 owner 可见区域。 |

结论：`a721412`/`71dcb38` 的单元级 frozen confirmation 与 cursor authority reset 证据成立，但没有通过这组真实浏览器 owner 验收；N2、N4、high-water、F7 的产品交接仍保持 RED，不能以 unit 绿色替代公开 UI 状态转移。

## 2026-09-20 notification owner chain oracle（同 HEAD 可重跑）

为把 0/7 的首个分歧固定在可重跑证据中，新增测试侧观察器 `tests/browser/notification-owner-oracle.spec.js`。它不导入产品模块、不安装兼容 owner、不改 fixture 或已有断言；每条记录同一条状态链：

`input → cursor/highwater (localStorage) → replica (atoll-channel-replica-v1 rows/meta) → presentation (唯一 reading owner) → rail (公开 diagnostics/DOM) → reading (公开 trace)`。

运行命令（当前冻结 HEAD，独立 mock/web 端口）：

```text
ATOLL_TEST_WEB_PORT=15310 ATOLL_TEST_MOCK_PORT=18910 npx playwright test \
  tests/browser/notification-owner-oracle.spec.js \
  --reporter=line --output=test-results-notification-owner-oracle-pre-20260920
```

结果：**7/7 oracle tests passed**（7 条都产生完整链证据；“passed”只表示观测器完成，不代表产品合同通过）。每条首个分歧如下：

| case | 首个分歧 | 链上证据与公开 owner |
|---|---|---|
| N2 | **rail** | `following-arrival` 期间唯一 owner `gap=0/mode=following`，但 34 帧中 related badge 出现 `1 → 4` 后才归零；input 已入 replica（19 rows）、cursor 已写 high-water 36。公开 owner：following presentation receipt → notification rail 时序。 |
| N4 | **rail** | filtered-tail 时 cursor high-water=63、replica 已含 `-unrelated-` 和 approval rows，但 `rail.snapshot('c0')={channels:[]}`，无 `authorityReady`。公开 owner：actor-filter rail authority/projection。 |
| H1 | **rail** | future-ack 时 cursor high-water=30、replica head=32，公开 rail channel 缺失且 high-water=0（预期公开边界 28）。公开 owner：replica/runtime cursor 已耐久，rail projection 未建立。 |
| H2 | **rail** | second-hydration 时 cursor high-water=29、replica rows/meta 已恢复，公开 rail 仍 `channels=[]`/high-water=0。公开 owner：hydration 后 rail authority 发布。 |
| H3 | **rail** | filtered-tail 时 cursor high-water=29、replica head=29，公开 rail channel 缺失/high-water=0（预期边界 27）。公开 owner：filtered boundary → rail projection。 |
| H4 | **rail** | following-after-arrival 时 cursor high-water=28、replica head=28，唯一 owner 仍 `gap=0`，但公开 rail high-water=0。公开 owner：presented-follow receipt → rail high-water。 |
| F7 | **presentation** | return-after-switch 时目标 `c0-history-request-112` 已在 replica（head=848、80 cached rows），但不在唯一 reading owner 的 visible IDs；公开 owner：reading-session/admission → virtualized presentation。 |

证据目录：`test-results-notification-owner-oracle-pre-20260920/`，每条附件为 `notification-owner-oracle-{N2,N4,H1,H2,H3,H4,F7}.json`，含 input、cursor、replica、presentation、rail、reading 全量摘要及 `firstDivergence`。因此当前 0/7 的产品分歧可在同一 HEAD 直接重跑，并与下一次 notification owner 提交逐条对比。

## 2026-09-20 notification owner 新协议后同 HEAD 复验

在共享 HEAD `6060588`（包含 oracle 提交 `34d6f0c`；本次检查未发现 notification 产品文件相对前轮新增变更）立即重跑：

```text
ATOLL_TEST_WEB_PORT=15320 ATOLL_TEST_MOCK_PORT=18920 npx playwright test \
  tests/browser/notification-owner-oracle.spec.js \
  --reporter=line --output=test-results-notification-owner-oracle-post-6060588-20260920
```

结果仍为 **7/7 oracle tests passed；产品合同 0/7 通过**。与 pre oracle 相比首分歧没有移动：

| case | frozen boundary / replica | presentation / rail 观察 | 首个分歧 |
|---|---|---|---|
| N2 | following arrival 后 cursor high-water=36，replica head=36 | 唯一 owner `gap=0/mode=following`；42 帧中 related 在 52ms=`1`、149ms=`3`、224ms=`2`，随后归零；公开 rail channel 仍缺失 | **rail** |
| N4 | filtered tail cursor c0=63，replica head=63，`-unrelated-` 与 approval rows 均在 | owner `gap=0`；公开 rail `channels=[]`、无 `authorityReady`，无法证明 scope 外 unread | **rail** |
| H1 | input→ack→reload→future ack 的 c0.project cursor 为 25→29→29→30；replica head=32 | ack/reload/future 的 owner 均可见尾部（gap=0），但公开 rail high-water=0/无 channel；预期 public boundary 27→28 未投影 | **rail** |
| H2 | hydrate→ack→second hydrate 的 c0.project cursor 为 25→29→29；rows/meta head=29 | 二次 hydrate 后公开 rail 仍 `channels=[]`/high-water=0；未建立可核对的 frozen rail boundary | **rail** |
| H3 | filtered tail cursor c0.project=29，replica head=29 | filtered owner `gap=0`、可见行已挂载；公开 rail high-water=0，离开后仍无 channel snapshot | **rail** |
| H4 | following before/after cursor c0.project=25→28，replica head=28 | arrival 后 owner `gap=0`、3 个 visible rows；公开 rail high-water 仍为 0，presented-follow 未发布 | **rail** |
| F7 | cold/browse/return cursor=844，replica head=848，目标 `c0-history-request-112` 存在于 replica | return 后 owner 仍 browsing/gap=0，但目标 row 不在 visible IDs；cached refresh 进入 following 且 snapshot 时 visible=0 | **presentation** |

因此新协议提交没有改变本组公开状态转移；N2 的瞬时 badge、H1–H4 的 frozen cursor/replica 与 rail 缺口、F7 的 presentation visibility 均保持原产品交接。证据目录为 `test-results-notification-owner-oracle-post-6060588-20260920/`。

## `77760c8` frozen owner receipts + 当前 HEAD 复验

在 `77760c8`（`fix(notification): require frozen owner receipts`）及其当前产品 HEAD（含 `07ed014 fix(notification): fence tail owner teardown`，审计 HEAD 为 `a1a72f4`）上，沿用未修改的 `34d6f0c` oracle 逐条运行 N2/N4/H1–H4/F7。运行期间曾有一次并发编辑造成 `useConversationProjection` 的 `controller is not defined`，该轮只作为竞态噪声丢弃；稳定源码逐条复验目录为 `test-results-notification-owner-oracle-post-77760c8-stable-{N2,N4,H1,H2,H3,H4,F7}-20260920/`。

稳定结果：**7/7 oracle 观测完成**。frozen owner receipts 对首分歧的影响如下：

| case | 本轮链状态 | 首个稳定分歧 / 与前轮相比 |
|---|---|---|
| N2 | following arrival 45 帧全为 `gap=0`，related/total/pending/jump 全 0；cursor=34、replica head=34 | **瞬时 rail badge 已关闭**（此前 `1→4`）；公开 `rail.snapshot` 仍 `channels=[]`，但最终 DOM rail 为 0，因此 oracle 不再报 transient 分歧。 |
| N4 | filtered-tail cursor c0=57、replica head=57，unrelated 与 approval rows 已在，owner `gap=0` | **rail**：仍无 `authorityReady`（`channels=[]`），scope 外 unread 无公开 raw rail 证据。 |
| H1 | future-ack cursor c0.project=28、replica head=28，两个 future approval visible，owner `gap=0` | **rail**：公开 channel/high-water 仍缺失/0；冻结 receipt 已推进 cursor，但未建立 rail projection。 |
| H2 | second hydration cursor=27、replica head=27，rows/meta 已恢复但 visible=0 | **rail**：reload 后公开 rail 仍 `channels=[]`/high-water=0。 |
| H3 | filtered-tail cursor c0.project=25、replica head=27，visible 仍为旧 history rows，DOM related=2 | **cursor/highwater（首分歧前移）**：冻结 receipt 拒绝未获完整 owner 边界的 filtered ack；前轮先落在 rail 缺失。 |
| H4 | following-after-arrival cursor=26、replica head=26，新 approval 在 visible owner，`gap=0` | **rail**：presentation 已到位但公开 high-water=0，receipt→rail 发布仍缺口。 |
| F7 | return 后仍 browsing、`gap=3866`，replica head=844；目标 `c0-history-request-112` 不在 return visible IDs（102–105） | **presentation**：已有 replica row 仍未恢复到原 browsing visible position；cached refresh snapshot visible=0。 |

结论：`77760c8` 确实关闭 N2 的 following transient badge，并让 H3 的首断点更早暴露为 frozen cursor 边界；N4/H1/H2/H4 的 rail authority/high-water 投影、F7 的 browsing presentation 仍未解决。N2 的用户可见 badge 已稳定为 0，但公开 rail diagnostics provider 仍未建立，不能将其误记为完整 rail 合同通过。

## 当前产品 HEAD 的 DOM rail 分层复验（`2265cfa` / `cfc26a7`）

`2265cfa`（expose rail high-water handoff）及后续当前 HEAD 上再次运行 `34d6f0c` oracle，7/7 观测完成。此处把左侧频道数字与底部 jump 作为用户可见主判据；`rail.snapshot(...).channels=[]` 只记为诊断 provider 缺失，不再单独判为用户 rail 错误。

| case | 用户可见 DOM 主证据 | 诊断/合同结果 | 分层裁决 |
|---|---|---|---|
| N4 | filtered-tail oracle：c0 `.unread-related=0`、`.unread-total=0`、pending=false、jump=0，owner `gap=0`；可见 approval rows 已挂载 | 原 N4 合同实际先走到 raw rail 断言才失败：`authorityReady=false/outsideFilterPreserved=false`；没有先出现用户 badge/jump 错 | **无可见 rail 错；仅 raw diagnostic/provider 缺口** |
| H1 | 原合同在 diagnostics 前已验证：离开时 project related=2；ack/reload=0；future arrival=1；future ack=0。oracle future-ack DOM 全 0/jump0 | 失败点为 `rail.channels[0]` 缺失；cursor/replica 已到 28 | **无可见 rail 错；仅 diagnostics projection 缺口** |
| H2 | 原合同 reload 后 project related=2，ack 后及二次 reload related=0；这些 DOM 断言均先于 diagnostics 断言 | 失败点为 hydrated rail channel 缺失；cursor/replica=27 | **无可见 rail 错；仅 diagnostics projection 缺口** |
| H3 | 原合同离开期间 project related=2，filtered tail 与离开后 related=0；oracle filtered owner `gap=0`、DOM final 0/jump0 | 失败点为 filtered `rail.channels[0]` 缺失；当前 cursor 已推进 27 | **无可见 rail 错；仅 diagnostics projection 缺口** |
| H4 | oracle following-after-arrival：new row 在 visible owner，`gap=0`，project related=0/total=0/pending=false/jump=0 | 原合同先在 high-water diagnostics poll（0）超时，尚未进入末尾 DOM 断言；oracle 补证 visible DOM 没有 badge/jump | **无可见 rail 错；仅 diagnostics/high-water 可观测性缺口** |
| F7 | 当前 oracle return-after-switch 快照 visible IDs 含 `c0-history-request-112`（与 111–114 同屏） | 严格 `reading-position-session.spec.js` 仍在 line 145 的目标可见等待超时；说明 admission/时序仍不稳定，不能以单次 oracle 快照宣称完成 | **仍为 presentation visibility/timing 产品问题** |

补充：所有当前 oracle 快照的 `rail.diagnostic.channels` 仍为空，这是 provider 未发布的 instrumentation 限制；本节没有把它冒充成用户可见 badge 错误。证据：`test-results-notification-owner-oracle-post-2265cfa-20260920/`、`test-results-notification-dom-N4-2265cfa-20260920/`、`test-results-notification-dom-highwater-2265cfa-20260920/`、`test-results-notification-dom-F7-2265cfa-20260920/`。

## 第七轮 Luna Max：`5aef9f4` Outbox P0 后复验

目标 HEAD 为 `5aef9f4`（当前工作树产品入口；含 `451d7b2` tail backlog freeze、`0145d6d` persisted unread suffix hydration、`2265cfa` rail high-water handoff）。沿用 `34d6f0c` oracle 真实浏览器重跑 N2/N4/H1–H4/F7，7/7 观测完成；证据：`test-results-notification-owner-oracle-post-5aef9f4-20260920/`。

DOM 主判据与 Outbox P0 闭合状态：

| case | DOM 左 rail / jump / reload 结果 | 结论 |
|---|---|---|
| N2 | following arrival 全部 `gap=0`、related/total/pending/jump=0；cursor 36、replica head 36 | **已闭合用户可见 badge 闪烁**；diagnostic channel 仍空，仅作定位。 |
| N4 | actor-filter tail c0 related/total/pending/jump 全 0，approval rows visible、gap=0 | **无可见 rail 回归**；raw authority/outside preservation 仍无法由空 diagnostics 证明。 |
| H1 | DOM 已完成 unread `2 → 0 → reload 0 → future 1 → ack 0`；cursor/replica 到 30/32 | **reload/ack 不复活的用户路径通过**；公开 high-water snapshot 仍缺。 |
| H2 | reload 后 project unread=2，ack 后及二次 reload=0（原合同 DOM 断言先通过） | **hydration/ack 用户路径通过**；diagnostic channel 仍缺。 |
| H3 | 离开期间 related=2，filtered tail/离开后=0；cursor project=29、owner gap=0 | **filtered DOM 路径通过**；raw diagnostics 缺失。 |
| H4 | arrival 后新 approval 进入 visible owner，gap=0，related/total/pending/jump=0；cursor/replica=28 | **用户可见 following 路径通过**；公开 high-water poll 仍为 0。 |
| F7 | oracle return snapshot 未恢复目标 112（仍 latest 120）；严格原合同另触发 Hook-order `Should have a queue`/owner count=0 | **未闭合，首断点仍 presentation/reading owner**，并有当前 Composer dirty owner 的 Hook-order 截断。 |

readable_event 额外复验（`notification-policy.spec.js`）：final readable root 期待 `.unread-total=1` 但 DOM 始终无该 badge（真实可见 rail 缺口，不是 diagnostics）；独立 `c0.project-notification-readable-event` row 可见，但 `reading.observation.visibleRowIDs` 未包含它（presentation→reading handoff 缺口）。证据：`test-results-readable-event-5aef9f4-20260920/`。

因此 `451d7b2/0145d6d/2265cfa` 对 reload、ack 后不复活和 following DOM 数字已有用户路径收益；仍不能宣称 notification 合同全闭合：rail diagnostics/high-water provider 未发布、readable final badge 缺失、readable_event reading observation 缺失、F7 presentation owner 不稳定。全程没有修改产品、fixture、断言或 skip。

## 第八轮：readable_event / F7 reading 时序复验（执行起点 HEAD `05b1fff`，2026-09-20）

本轮只读当前真实浏览器入口；没有修改产品、fixture、既有断言或 skip。为避免把 diagnostics 空值当作产品事实，临时 probe 仅采集唯一 active reading owner 的 DOM hit-test、owner activation、`coldEntry` 的 history/presentation revision、reading trace 和左 rail DOM，采集完成后删除。`notification-owner-oracle.spec.js` 的 F7 合同也用同一 `34d6f0c` oracle 交叉重跑。

运行与结果：

```text
ATOLL_TEST_WEB_PORT=15371 ATOLL_TEST_MOCK_PORT=18971 npx playwright test tests/browser/zz-notification-reading-probe.spec.js --reporter=line
# readable_event + F7 timing probe: 2 passed
ATOLL_TEST_WEB_PORT=15374 ATOLL_TEST_MOCK_PORT=18974 npx playwright test tests/browser/zz-notification-reading-probe.spec.js --grep "readable final rail badge" --reporter=line
# final badge timing probe: 1 passed
ATOLL_TEST_WEB_PORT=15372 ATOLL_TEST_MOCK_PORT=18972 npx playwright test tests/browser/notification-owner-oracle.spec.js --grep "F7 input" --reporter=line
# F7 oracle: 1 passed (observation completed; contract result remains RED)
ATOLL_TEST_WEB_PORT=15370 ATOLL_TEST_MOCK_PORT=18970 npx playwright test tests/browser/notification-policy.spec.js --grep "tool, timer" --reporter=line
# notification-policy readable_event contract: RED at line 243
ATOLL_TEST_WEB_PORT=15373 ATOLL_TEST_MOCK_PORT=18973 npx playwright test tests/browser/notification-policy.spec.js --grep "rail follows presented" --reporter=line
# final readable badge contract: RED at line 154
```

readable_event 时序主证据（`test-results-browser-ns-reading-probe-05b1fff-20260920/.../readable-event-timing.json`）：

- 离开 `c0.project` 发送 request、nested tool、timer control、activity、readable_event 后，`c0` 仍只有一个 owner，`mode=following`；project 返回后 target `c0.project-notification-readable-event` 从首个 sample 起即在唯一 owner 的真实 hit-test 可见区域，`visibleIDs` 连续包含 target。没有出现双 owner、空层或 target 仅 CSS mounted 的假可见。
- project 的 Presentation 在整个稳定窗口为 `revision=4/sourceRevision=18`，history `presentationRevision=18`，8 rows 的最后一行就是 readable target；`coldEntry.result.presentationVisible=true`。因此当前 RED 不是 row admission/DOM 物化失败。
- reading trace 从 `trace.enabled` 后始终没有 `reading.observation`、`visibleRowIDs`、`installed-tail-ack` 或 `arrival-resolution` 事件；显式 `scrollIntoView` 后仍无这些事件。首个可见链断点为 **Presentation/DOM → reading observation handoff**。
- project 返回后 owner activation 先为一个值并在约 2.5s 后替换为第二个值；替换前后 owner 数均为 1、target 仍可见、Presentation revision 未变。替换恰与 history demand 短暂进入 `pending/loading` 同步，记录为共享工作树下的时序信号，不把它冒充为 badge 根因。

readable final badge 主证据（`test-results-browser-ns-readable-final-badge-20260920/.../readable-final-badge-timing.json`）：在 c0 上依次注入 request → processing → progress → final，并在 final 后再等 1.5s；project 左侧 `.unread-related`、`.unread-total`、`.unread-pending` 和底部 jump 始终为 `0/0/false/0`，而原合同 line 154 期望 `.unread-total=1`。这是实际用户可见 rail badge 缺口，不是空 `rail.snapshot` provider 诊断；公开 owner 交给 notification policy/rail projection。

F7 时序主证据（`test-results-browser-ns-reading-probe-05b1fff-20260920/.../f7-return-timing.json`）及 oracle（`test-results-browser-ns-f7-oracle-current-20260920/.../notification-owner-oracle-F7.json`）：

- cold latest：唯一 owner，`mode=following`，target 不适用；Presentation `revision=2/sourceRevision=42`，最新 120 可见。
- browsing before switch：同一 owner 切到 `mode=browsing`、`inputEpoch=1`、`gap≈1803`，`c0-history-request-112/113/114` 均真实可见；这证明滚动输入和目标 anchor 已被读取。
- c0 → c0.project → c0 回返后的 55 个 100ms samples：唯一 owner 一直存在且保持 `mode=browsing`，但 target 112 始终在视口上方（约 `top=-938,bottom=-720`），可见的是 120/approval/summary；Presentation 稳定为 `revision=7/sourceRevision=80`，而 replica 已含 target，head=848。无 `reading.observation` 事件，rail DOM 仍 `0/0/false/0`。
- 同 HEAD 的 F7 oracle `firstDivergence` 明确为 **presentation**：cursor `readSeq/high-water=844`，replica 80 rows、head=848 且包含 target，唯一 owner visible IDs 不含 target。不是 fixture、旧 DB、cursor 或空 diagnostics 问题；公开 owner 为 reading-session/admission → virtualized presentation。

共享 dirty Hook 隔离：当前工作树另有未提交 `WorkspaceApp.jsx`/Composer 改动；一次原始 final-badge 合同运行曾输出 React Hook-order / `Should have a queue` console，但最终仍独立落在 line 154 badge 缺失。readable_event 与 F7 timing probe 均 `pageerror=[]`，F7 oracle 也完成，未观察到 Hook 截断或 owner=0；因此 Hook 日志只作为共享工作树旁证，不作为本轮 readable badge 或 F7 首断点。启动期 401 console 亦未升级为 page error。

本轮裁决：readable_event 的 row/presentation 已绿，唯一用户可见缺口是 final readable root 的 rail badge；readable_event 的第二条合同仍红在 DOM→reading observation；F7 仍红在回返 presentation visibility。证据仅保留在测试结果目录，测试侧没有新增持久化探针。

共享分支在上述长采样期间继续前进；为核对最新产品入口，当前 HEAD `ef8f906`（`fix: gate waiting edit and restore interrupt pause`）立即重跑同一 F7 oracle：**1 passed（12.2s）**，`firstDivergence` 仍为 `presentation`，cursor `readSeq/high-water=844`、replica head `848` 且含 target 112，唯一 owner visible IDs 仍为 120/approval/summary。新证据：`test-results-browser-ns-f7-oracle-ef8f906-20260920/`。这次重跑未改变第八轮裁决。

当前 `ef8f906` 再跑 notification-policy 两条合同仍分别在 line 154（final readable badge）和 line 243（readable_event observation）失败；证据目录为 `test-results-browser-ns-readable-badge-current-ef8f906-20260920/` 与 `test-results-browser-ns-readable-current-ef8f906-20260920/`。该两次输出没有新的 Hook/pageerror 截断。

## 第九轮只读复验：Reading 候选与三个断点重分层（当前 HEAD `12e5e90`）

本轮没有修改产品、fixture、断言或 skip。当前 HEAD 逐条重跑了 notification-policy 两条合同和 `34d6f0c` F7 oracle；同时读取了新的 Reading 候选：`/tmp/reading-round7-5aef9f4`（基于 `5aef9f4`，仅有未提交的 `VendorListExecutor.jsx` anchor-retention/overscan diff，候选服务 `:15305`、mock `:20005`）。候选不等于当前产品 HEAD，结果仅作交叉证据。

### 三个问题分别裁决

1. **readable_event 的 DOM → Reading observation：仍 RED。** 当前真实合同在 line 243 超时，但本轮及候选浏览器采样都确认 `c0.project-notification-readable-event` 已进入唯一 active owner 的真实 DOM 可见区（候选 `ownerCount=1`、row hit-test 命中）；reading trace 仍只有 `trace.enabled`，没有 `reading.observation.visibleRowIDs`。候选没有移动这个首断点。`npx vitest run tests/reading-observation-settle.test.jsx tests/reading-session-ports.test.js` 在当前树和候选树均为 **4 passed / 4 failed**（settled/user authority、selection autoscroll、epoch invalidation 断言均未闭合）。

2. **final root badge：先核 disposition，再定责任。** 规范 canonical final（`payload.body.status=completed` 且含 text）被 `notificationDisposition` 分类为 `final`，`isRailNotifiableDisposition('final') === true`；独立 `human.note` readable event 分类为 `event`，rail predicate 为 false、viewport predicate 为 true。这一语义边界由纯模型 **12/12 passed** 验证，不能把 event 的 quiet rail 当作 badge 回归。

   但本轮浏览器动作返回的实际 final envelope 是 `sender=project-agent`、`audience=["project-agent"]`；`multi-channel` fixture 的 root actor 是 `root-project`。`channel-feed-runtime` 的 `notificationRelatesTo`/`unreadFor` 只对当前 human actor 关系计 rail，因此该 fixture final 对 root 不 related，DOM 没有 badge 是当前 fixture/合同不一致，而不是已证实的产品 rail bug。原断言 line 154 仍期待 `.unread-total=1`，但在 fixture audience 未改、且未明确“非 root audience 的 final 也应进 channel rail”之前，不向 notification 产品 owner 交接这条 badge 缺失；fixture/断言保持不改，待合同 owner 先决定 audience 语义。

3. **F7 row 112：当前 HEAD 仍是 presentation 首断点；候选只显示局部改善。** 当前 HEAD 的 `34d6f0c` oracle 观测成功但 `firstDivergence=presentation`：cursor read/high-water=844，replica head=848 且含 `c0-history-request-112`，回返唯一 owner 仍只把最新 120/approval/summary 放入 visible IDs，目标已 mounted 但在视口上方。证据：`test-results-browser-ns-round9-f7-12e5e90-20260920/`。

   Reading 候选的同一浏览器序列中，回返后唯一 owner 保持 `mode=browsing`，且 `c0-history-request-111/112/113/114` 均在物理可见区，说明 deferred content-anchor + 增大 retention 确实把 row 112 的 presentation 首断点向前闭合；但候选 focused settle tests 仍 4/4 RED，不能据此宣称 F7 产品修复已验收。当前公开 owner 仍是 reading-session/admission → virtualized presentation，候选只作为待 owner 复验的非合入证据。

本轮逐条运行结果：当前 HEAD 的 `notification-policy.spec.js --grep "rail follows presented"` 在 line 154 RED；`--grep "tool, timer, and public-event"` 在 line 243 RED；F7 oracle **1 passed（采集完成，契约首断点仍 RED）**。因此本轮最终分层是：readable_event = DOM→Reading handoff 产品缺口；final root badge = fixture audience/合同语义待决，不冒充产品 bug；F7 row 112 = 当前产品 presentation 缺口，Reading 候选仅局部改善。

## 第十轮只读复验：Reading 候选后的首断点（执行基线 `c6f9ea8`，2026-09-20）

本轮在共享工作树当前 `c6f9ea8` 加未提交的 `src/ui/timeline/VendorListExecutor.jsx` Reading anchor-retention 候选上复验；没有修改产品、fixture、断言或 skip。这里的候选不是已验收提交，结果只用于确认首个公开分歧，不能把候选局部行为写成产品已修复。

### readable_event：Presentation 已到 DOM，Reading handoff 仍 RED

命令：

```text
ATOLL_TEST_WEB_PORT=15580 ATOLL_TEST_MOCK_PORT=19980 npx playwright test tests/browser/notification-policy.spec.js --grep="tool, timer, and public-event" --workers=1 --reporter=line --output=test-results-browser-ns-round10-reading-15580-20260920
```

结果为 **1 failed**，失败仍在 `notification-policy.spec.js:243` 的 `reading.observation.visibleRowIDs` 断言。此前的 lifecycle、独立 root、row DOM 可见性已通过：`c0.project-notification-readable-event` 在唯一 active owner 中真实可见；候选没有产生对应 `reading.observation`。因此该首断点严格归 **Reading（Presentation/DOM → Reading observation handoff）**，不是 row presentation 未物化，也不是 rail/diagnostics provider。

候选的 focused unit 交叉复验：

```text
npx vitest run tests/reading-observation-settle.test.jsx tests/reading-session-ports.test.js --reporter=dot
# Test Files 1 failed | 1 passed (2), Tests 4 failed | 4 passed (8)
```

四个 RED 分别是 bookmark 缺 `blockID`、selection autoscroll 仍记录 `layout/settled=false`、input-free layout 仍为 `layout/settled=false`、epoch advance 后仍保留 `user` 而非 `settled`。这只说明候选尚未满足 Reading authority/settle 合同，不改变上述浏览器首断点。

### F7 row 112：候选没有移动 Presentation 首断点

命令：

```text
ATOLL_TEST_WEB_PORT=15581 ATOLL_TEST_MOCK_PORT=19981 npx playwright test tests/browser/notification-owner-oracle.spec.js --grep="F7 input" --workers=1 --reporter=line --output=test-results-browser-ns-round10-f7-15581-20260920
```

oracle 采集 **1 passed**（采集绿色不等于原合同绿色），但 `firstDivergence` 仍为 **`presentation` / `return-after-switch`**：cursor `readSeq=844`、`notificationHighWater=844`，replica `head=848`、80 rows 且包含 `c0-history-request-112`；唯一 owner 为 `mode=browsing`，目标已 mounted 但 `top=-938,bottom=-720,visible=false`，可见仍是 `120/approval/summary`。所以 input、cursor、replica 已到位，候选没有闭合回返后的 virtualized presentation admission/anchor 可见性。

### final root badge：继续按 fixture audience 语义待决

canonical lifecycle final 仍是模型上的 `final`（可进 rail），独立 `human.note` readable event 仍是 `event`（只进 viewport，不进 rail）。实际 fixture final 的 audience 是 `project-agent`，multi-channel root actor 是 `root-project`；runtime 先过当前 actor relation 再应用 rail predicate，因此 root `.unread-total=0` 不能在这组 audience 下单独证明产品 badge 回归。该条保持 **fixture/合同语义待决**，不向 notification 产品 owner 交接；只有合同明确 channel-wide audience 语义，或 fixture 改为 root audience 后仍无 badge，才重新开放产品分歧。

本轮最终分层：**Presentation** = F7 row 112 回返不可见；**Reading** = readable_event DOM 已见但无 observation（且候选 settle/authority 未闭合）；**fixture** = final root badge audience 不相容。三者不互相代偿，证据目录为 `test-results-browser-ns-round10-reading-15580-20260920/` 与 `test-results-browser-ns-round10-f7-15581-20260920/`。

## 第十一轮只读复验：Reading observation 与 F7 row112 独立完成门（产品基线 `418c31e`，2026-09-20）

Reading owner 的 `418c31e fix(reading): retain fold anchors through list reflow` 已进入当前 HEAD 祖先。本轮只读重跑，没有修改产品、fixture、断言或 skip；final root badge 继续沿用前轮已核定的 fixture audience 语义。

### readable_event observation：完成门仍未通过

```text
ATOLL_TEST_WEB_PORT=15680 ATOLL_TEST_MOCK_PORT=19990 npx playwright test tests/browser/notification-policy.spec.js --grep="tool, timer, and public-event" --workers=1 --reporter=line --output=test-results-browser-ns-round11-readable-15680-20260920
# 1 failed: notification-policy.spec.js:243
```

独立 readable row 的 lifecycle 与 `toBeVisible()` 仍先通过，失败仍是唯一 Reading owner 的 `reading.observation.visibleRowIDs` 没有包含 `c0.project-notification-readable-event`。因此 readable_event 的独立完成门仍 **RED**，首断点保持 **DOM/Presentation → Reading observation handoff**；不能用 F7 的 Presentation 变绿替代这条 Reading 证据。

### F7 row112 Presentation：独立完成门已通过

```text
ATOLL_TEST_WEB_PORT=15681 ATOLL_TEST_MOCK_PORT=19991 npx playwright test tests/browser/notification-owner-oracle.spec.js --grep="F7 input" --workers=1 --reporter=line --output=test-results-browser-ns-round11-f7-15681-20260920
# 1 passed (11.6s)
```

本次 `34d6f0c` oracle 的 `firstDivergence.stage=none-observed`。在 `return-after-switch`，cursor `readSeq/highWater=844`、replica `head=848` 且含 row112；唯一 browsing owner 的 visible IDs 为 `111/112/113/114`，row112 的物理边界约为 `top=102,bottom=320,visible=true`。因此 **F7 row112 的 Presentation/virtualized admission 完成门已闭合**。该 oracle 的 `reading.enabled=false`，所以只证明 row112 用户可见 Presentation，不宣称 Reading observation 或完整 session 合同已闭合。

严格的文档 session 合同仍需单独保留：

```text
ATOLL_TEST_WEB_PORT=15682 ATOLL_TEST_MOCK_PORT=19992 npx playwright test tests/browser/reading-position-session.spec.js --workers=1 --reporter=line --output=test-results-browser-ns-round11-reading-position-15682-20260920
# 1 failed: line 145 page.waitForFunction timeout (60s)
```

这条使用 `seed=29601` 的旧 bookmark/doc-session 往返场景，不能反向否定 row112 oracle 已通过；但它说明更宽的 “beforeSwitch firstVisible id 同位恢复” 合同仍 RED，继续交 Reading session/admission owner。两条门分别记录，不能以 row112 单次可见冒充完整 F7 session 通过。

### final root badge：仍为 fixture/合同语义待决

canonical final 与 standalone readable event 的 rail/viewport disposition 未改变；实际 final audience 仍是 `project-agent`，root actor 仍是 `root-project`。因此 `.unread-total=0` 继续按 fixture audience 与 line 154 预期不相容裁决，不登记 notification 产品 badge 回归。

本轮分层：**Reading** = readable_event observation 完成门 RED；**Presentation** = F7 row112 独立可见门 GREEN，但完整 doc-session 合同仍 RED；**fixture** = final root badge 待合同 audience 决策。证据目录：`test-results-browser-ns-round11-readable-15680-20260920/`、`test-results-browser-ns-round11-f7-15681-20260920/`、`test-results-browser-ns-round11-reading-position-15682-20260920/`。

## 第十二轮只读复验：四文件 Reading 提交后的 observation 与完整 F7（产品基线 `d6dcc43`，2026-09-20）

`d6dcc43 fix(reading): publish painted visible row IDs` 已提交四个 Reading 文件：`VendorListExecutor.jsx`、`reading-geometry.js`、`useBrowsingReadingController.js`、`useConversationProjection.js`。本轮没有修改产品、fixture、断言或 skip；共享树另有未提交 `useHistoryConsumer.js`/`history-underfill-lifecycle.spec.js` 旁支，未纳入本轮变更。未重复改判已 GREEN 的 F7 row112 Presentation oracle。

### readable_event observation：独立完成门 GREEN，整条 spec 的后续 rail 仍另红

```text
ATOLL_TEST_WEB_PORT=15780 ATOLL_TEST_MOCK_PORT=20080 npx playwright test tests/browser/notification-policy.spec.js --grep="tool, timer, and public-event" --workers=1 --reporter=line --output=test-results-browser-ns-round12-readable-15780-20260920
# 1 failed later at notification-policy.spec.js:306 (timer_result unread-related)
```

本次已越过 readable_event 自身的 line 243 完成门。附件 `notification-readable-event-visibility.json` 记录目标 row `c0.project-notification-readable-event` 的物理 rect `top=464.84,bottom=539.94`、`checkVisibility=true`，三处 hit-test 均由该 row 拥有；末段 `reading.observation` 的 `visibleRowIDs` 明确包含该目标。因此 **DOM/Presentation → Reading observation 完成门已 GREEN**。整条 spec 后续在独立 `timer_result` 期待 `.unread-related=1` 处失败，不得倒推为 readable_event observation 回归；该后续 rail 分歧单独交 notification owner。

### 完整 F7 reading-position：仍 RED，但已从等待超时收窄为一行 anchor drift

```text
ATOLL_TEST_WEB_PORT=15781 ATOLL_TEST_MOCK_PORT=20081 npx playwright test tests/browser/reading-position-session.spec.js --workers=1 --reporter=line --output=test-results-browser-ns-round12-reading-position-15781-20260920
# 1 failed at reading-position-session.spec.js:152
```

本次 line 145 的“目标未回到 viewport”等待已通过，失败收窄为 `beforeSwitch.firstVisible.id = c0-history-request-112`、`afterSwitch.firstVisible.id = c0-history-request-111`。也就是说目标链已回返到可见域，但 document-session 的 first-visible identity/offset 尚未保持；这是完整 Reading session/admission 的一行 anchor drift，不反向否定第十一轮已闭合的 F7 row112 Presentation 独立门。证据：`test-results-browser-ns-round12-reading-position-15781-20260920/`。

### Hook/order 与 fixture 隔离

两次浏览器运行的 Playwright 输出、error-context 与 trace 均没有 `Should have a queue`、Hook-order、pageerror 或 uncaught runtime error；可见失败均是合同 assertion。final root badge 继续按 `audience=["project-agent"]` 与 fixture root `root-project` 不相容裁为 fixture/合同语义待决，不登记产品 rail 回归。

本轮分层：**Reading observation** = GREEN；**Reading session** = F7 first-visible identity 仍 RED；**Presentation F7 row112** = 前轮独立门 GREEN，不重复改判；**fixture** = final root badge 待 audience 合同决策。证据目录：`test-results-browser-ns-round12-readable-15780-20260920/`、`test-results-browser-ns-round12-reading-position-15781-20260920/`。

## 第十三轮只读：F7 Reading session identity drift 首断点（产品基线 `d6dcc43`，2026-09-20）

本轮只针对完整 `reading-position-session.spec.js` 的 `112 → 111` 漂移做 observation-only probe；没有重跑已闭合的 `readable_event`，没有触碰 `timer_result` rail，也没有修改产品、fixture、断言或 skip。临时 probe 已在取证后删除，证据保留在 `test-results-browser-ns-round13-f7-probe-15881-20260920/` 的 `round13-f7-session-evidence.json`。

```text
ATOLL_TEST_WEB_PORT=15881 ATOLL_TEST_MOCK_PORT=20181 npx playwright test tests/browser/ztmp-round13-f7-session.spec.js --workers=1 --reporter=line --output=test-results-browser-ns-round13-f7-probe-15881-20260920
# 1 passed (9.4s), observation-only probe; temporary test removed after capture
```

按 session 链逐项裁决：

| 链段 | before switch | return c0 | 裁决 |
| --- | --- | --- | --- |
| activation | `8deb9df8-43df-404f-bfb1-bebfea80ded5` | `54746dca-0c44-47e7-bbff-7a7a2bdd3020` | A→B→A 新 activation 是预期生命周期，不是首断点 |
| inputEpoch | `1`（user observation） | `0`（新 activation 的 layout observations） | epoch 没有沿旧 activation 错配，非首断点 |
| anchor / viewport | row112 `top=-64.5,bottom=153.6875` | row111 `bottom=0.9375`，row112 `top=0.9375` | **首个可观察分歧**：row112 identity 仍在，但精确 row-local offset 未保持，first-visible 变 112→111，0/100/250/500/1000ms 均稳定 |
| visibleRows | `[112,113,114]` | Reading trace 最终仍为 `[112,113,114]`；DOM 为 `[111,112,113,114]` | admission / painted visible IDs 已到位，不是 receipt 缺失 |
| history / presentation receipt | head `848`、presentation revision `80`；回返 rows `39`、source revision `80` | 同一稳定数据，未出现 c0 history demand | replica、cursor、presentation receipt 无分歧 |

回返时 mode 仍为 `browsing`，owner `scrollTop=6139`、`scrollHeight=8495`、`clientHeight=487`；page errors 为空，console 只有启动期两个 `401 Unauthorized`，没有 Hook/order、`Should have a queue` 或 uncaught runtime error。`localStorage` 中 `view-session` 的 `mode=following/bookmark=null` 是持久化边界的既定 scrub，live reading map 仍保留 browsing session，不能把它当成 receipt 回归。

因此首断点属于现有 **Reading session / `VendorListExecutor` typed position restore** owner：row identity、activation、epoch、visible admission 与数据 receipt 都已连贯，只有旧 bookmark 的 `rowViewportOffset`（before 为 `-64.5`）在新 activation 的 position-row restore 后没有保持，最终把 row111 的底边留在 viewport 内约 `0.9375px`。最小机制建议已交 `reading_tail_owner`：在 activation return 记录 captured bookmark offset 与实际 applied offset，核对 `position-row` → Virtuoso 的 offset 符号/语义，并排除 `initialTopMostItemIndex` mount 或后续 layout 对精确 offset 的覆盖；补充 owner-level offset telemetry，不放宽 first-visible assertion。

本轮结论：F7 row112 Presentation 独立门仍 GREEN；完整 Reading session 仍 RED，公开 owner 为 `reading_tail_owner`。不登记 notification/rail 产品问题，也不把空 diagnostics 当成产品证据。

## 第十四轮只读裁决：`timer_result` 是 fixture audience 错配（2026-09-20）

本轮回到 FAE8B70 迁移后的 `notification-policy.spec.js` timer 合同，只读核对真实 principal、channel actor 与三帧 lifecycle envelope；产品代码不改，Feed 不增加 `project-agent → human` 猜测。旧 fixture 的 `c0.project` membership 是 `principal=root`、当前 human actor=`root-project`；timer helper 却把 fire、wake 和 readable terminal result 的 audience 全部写成 `project-agent`。

逐帧语义如下：

| frame | sender / audience（旧） | 正确分层 | 裁决 |
| --- | --- | --- | --- |
| canonical fire `timer:c0.project-notification-result` | `project-agent → [project-agent]` | agent-self canonical seed/control | 保留；`notification-policy` 与 Presentation 的 timer seed 需要该闭合形状 |
| wake request `…-wake` | `project-agent → [project-agent]` | transport/control，不产生 rail | 保留；不应改成用户消息 |
| readable terminal `…-wake-done` | `project-agent → [project-agent]` | 面向当前 human 的可读结果，需显式关联 `root-project` | **fixture 错配**；Feed 的 `notificationRelatesTo` 对 root-project 合理返回 false，不能推断关联 |

旧 fixture 因此在 line 306 缺 `.unread-related=1`；这不是产品传播缺口。最小 fixture 修复仅把 `timer_result` terminal 的 audience 改为 `[selfActorId]`（当前值 `root-project`），fire/wake 继续保持 agent-self audience。这样既保留 canonical timer seed，又让 terminal reply 直接携带真实 human audience。

真实 Chromium 复验：

```text
# pre-fix
ATOLL_TEST_WEB_PORT=15981 ATOLL_TEST_MOCK_PORT=20281 npx playwright test tests/browser/notification-policy.spec.js --grep="tool, timer, and public-event" --workers=1 --reporter=line --output=test-results-browser-ns-round14-timer-pre-15981-20260920
# 1 failed at line 306: .unread-related expected 1, element absent

# fixture-only fix
ATOLL_TEST_WEB_PORT=15982 ATOLL_TEST_MOCK_PORT=20282 npx playwright test tests/browser/notification-policy.spec.js --grep="tool, timer, and public-event" --workers=1 --reporter=line --output=test-results-browser-ns-round14-timer-post-15982-20260920
# 1 passed (9.5s)
```

post 运行同时保留 timer control quiet、readable terminal rail=`1` 与 terminal Presentation row 可见；没有改断言、产品、skip 或让 Feed 猜测 actor 关系。归类：**fixture 修复完成；notification 产品 owner 不新增回归**。

## 第十五轮：N–S 剩余红项的真实 Chromium 复验与分层（产品入口 `e0142f7`，2026-09-20）

本轮遵守执行合同：不改 `src/`、vendor、package，不删 skip；只对 fixture/selector 与产品回归分别取证。`timer_result` fixture 修复与 F7 独立门已按前轮结论处理，本轮先重跑 N1–N4，再选剩余 `notification-policy` lifecycle final 红项核定首个 owner。

### N1–N4：N4 的红只落在 diagnostics，不是用户 rail

```text
ATOLL_TEST_WEB_PORT=16001 ATOLL_TEST_MOCK_PORT=20301 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep="N1 有积压" --workers=1 --reporter=line --output=test-results-browser-ns-round15-n1-16001-20260920
# 1 passed

ATOLL_TEST_WEB_PORT=16002 ATOLL_TEST_MOCK_PORT=20302 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep="N2 别的频道" --workers=1 --reporter=line --output=test-results-browser-ns-round15-n2-16002-20260920
# 1 passed

ATOLL_TEST_WEB_PORT=16003 ATOLL_TEST_MOCK_PORT=20303 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep="N3 页面不可见" --workers=1 --reporter=line --output=test-results-browser-ns-round15-n3-16003-20260920
# 1 passed

ATOLL_TEST_WEB_PORT=16004 ATOLL_TEST_MOCK_PORT=20304 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep="N4 成员过滤" --workers=1 --reporter=line --output=test-results-browser-ns-round15-n4-16004-20260920
# 1 failed at line 400: raw rail authorityReady=false / outsideFilterPreserved=false
```

N4 的 observation-only `34d6f0c` oracle（`test-results-browser-ns-round15-oracle-n4-16014-20260920/`）把链路固定为：输入全部落入 Replica（`headSeq=65`，含 `c0-unrelated-…` 与 6 个 approval），notification cursor/high-water 已写到 `65`，唯一 filtered Presentation owner `gap=0` 且 approval rows 真实可见；左侧 `.unread-related/.unread-total/.unread-pending` 与 jump 均为 `0/0/false/0`。唯一分歧是 `window.__ATOLL_DIAGNOSTICS__.rail.snapshot('c0')` 返回 `channels=[]`，即当前树未发布 diagnostics provider。按本轮合同，空 diagnostics 只能定位，不能冒充用户可见 rail 错；N4 保留为测试/observability contract RED，不向产品 owner 派发，也不放宽 N4 行为断言。

### lifecycle final：fixture audience + 过时 selector，而非产品回归

当前 `notification-policy.spec.js` 的第一条合同在 fixture 原状下于 line 154 期待 `.unread-total=1`（证据 `test-results-browser-ns-round15-policy-final-16016-20260920/`）。逐帧核对发现两处测试侧不一致：

1. `notification_lifecycle` 的 canonical request/processing/progress 是 agent-owned ledger；可读 terminal final 必须显式面向当前 human actor。fixture membership 给 `c0.project` 的 actor 是 `root-project`，因此 final audience 从 `[project-agent]` 修为 `[selfActorId]`；Feed 不猜测 agent→human 关系。
2. 当前公开 Channel rail 只渲染个人 unread `.unread-related`；`.unread-total` 仅表示 pending/unknown（见 `WorkspaceLayout.jsx`），不承载数字。line 154/166 的 `.unread-total` 是迁移后遗留 selector，不是产品缺失 badge。

修复仅限测试侧：`mock/server.mjs` 将 `phase === 'final'` 的 audience 指向 `selfActorId`，保留 queued/processing/progress 的 agent audience；`notification-policy.spec.js` 的 final/reload 断言改读 `.unread-related`，没有弱化 capability 或删除 persistence/visibility 断言。真实浏览器验证：

```text
ATOLL_TEST_WEB_PORT=16020 ATOLL_TEST_MOCK_PORT=20320 npx playwright test tests/browser/notification-policy.spec.js --grep="rail follows presented lifecycle" --workers=1 --reporter=line --output=test-results-browser-ns-round15-policy-final-selector-post-16020-20260920
# 1 passed (13.9s)

ATOLL_TEST_WEB_PORT=16015 ATOLL_TEST_MOCK_PORT=20315 npx playwright test tests/browser/notification-policy.spec.js --grep="tool, timer, and public-event" --workers=1 --reporter=line --output=test-results-browser-ns-round15-policy-16015-20260920
# 1 passed
```

fixture-only probe `test-results-browser-ns-round15-final-probe-full-16019-20260920/` 记录 final envelope `audience=[root-project]`、DOM `related=1,total=∅`；该 probe 文件已删除，结果只作为证据。由此本轮没有新增已确认 notification 产品红：N1–N3、lifecycle final、timer/readable-event 用户路径均绿；N4 仍只是空 diagnostics provider 的测试可观测性缺口。未修改产品 owner，也未使用 skip/隐藏 UI 取得绿色。

## 第十六轮：N4 空 diagnostics 是过时 raw oracle，公开用户链 GREEN（HEAD `141f7a3`，2026-09-20）

本轮先按“卡住必须可解释”检查 N4 的首个分歧：真实用户链已经从 live input 落到 Replica、进入 filtered Presentation，并在 following tail 完成 DOM observation/confirmation；没有 pending、unknown、jump 或可见 badge。`src/model/diagnostics.js` 的 rail provider 是默认无 provider 的可选只读本地快照，当前 `channel-feed-runtime` 没有注册生产 provider；历史 provider 随 `a4f0020` 数据面收口移除，当前 Workspace owner 直接消费 runtime 的 `unreadFor`/公开 history handoff。故 `channels=[]` 不是用户卡住状态，也不构成缺失的产品 owner。

旧 N4 raw 断言同时要求 `authorityReady=true` 与 `outsideFilterPreserved=true`。后者与通知状态合同不符：合同将 `highWater` 定义为频道级 attention boundary，并明确 filtered-tail 的确认可以覆盖 filter 外事实（`audit-output/NOTIFICATION-STATE-CONTRACT.md` §2.2、§3）；它不是逐条/逐 filter 的 unread 保留证明。该 raw 断言因此归类为 **过时实现/诊断 oracle**，不是产品回归。

测试合同已作最小修订：N4 标题和说明改为“频道级确认覆盖过滤外事实”，删除仅依赖 diagnostics provider 且要求逐 filter retention 的 raw poll；保留 DOM 行为断言（following、gap、scope badge、jump、离开后状态），并继续把 rail snapshot、Reading trace、local reads 写入 `N4-actor-filter.json` 作 FAE 对照。没有删除场景、skip 或放宽用户行为门。

真实 Chromium 复验：

```text
ATOLL_TEST_WEB_PORT=16104 ATOLL_TEST_MOCK_PORT=20404 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep="N4 成员过滤" --workers=1 --reporter=line --output=test-results-browser-ns-round16-n4-16104-20260920
# 1 passed (9.4s)
```

证据 `test-results-browser-ns-round16-n4-16104-20260920/`：42 帧，`settledAtTail={mode:following,gap:0,related:0,other:0,pending:false,jump:0}`，filter 外到达期间无 tail notice；离开后仍 `related=0,other=0,pending=false,jump=0`。附件中的 `rail={version:1,channels:[]}` 仅保留为诊断事实，不再冒充用户 rail 错。仅修改本 spec 与两份审计报告；未改 `src/`、vendor、package、fixture，未删 skip。

## 第十七轮：四条 high-water 与 N4/H4 均把首断点钉在 rail authority（HEAD `8feb531`，2026-09-20）

本轮重跑了当前冻结的 `notification-high-water.spec.js` 四条，以及 observation-only owner oracle 的 N4/H4。结果不能沿用第16轮“空 diagnostics 仅是过时 raw”的结论：四条 high-water 都直接把 rail snapshot 当作当前 public handoff，四条均在 `rail.channels[0]` 缺失处失败；DOM 行为先于该断言均已通过。临时只读采集随后删除，证据保留在 `test-results-browser-ns-round17-highwater-observation-16203-20260920/`。

| case | 用户可见 DOM（采集阶段） | cursor / notification high-water；Replica meta head | rail diagnostics |
|---|---|---|---|
| persistence | project `2→0→0(reload)→1(future)→0`；following、gap≤1、pending/jump=0 | project `27` after ack；reload `29`、future unread `29`、future ack `30`；Replica meta head `29→29→30→32`（额外 control rows 不计 rail） | 每阶段 `{version:1,channels:[]}`，无 channel/authority |
| hydration | hydrated unread `2`，ack 后 `0`，二次 reload `0`；following/gap0 | project `25→27→27`；Replica meta head `27→29→29` | 同上 |
| filtered | filtered tail / 离开后 related,total,pending,jump 全 `0/0/false/0` | project `29→29`；Replica meta head `29→29` | 同上 |
| presented-follow | before/after DOM `0/0/false/0`，following、gap0 | project `25→28`；Replica meta head `27→28` | 同上 |

四条正式合同命令：

```text
ATOLL_TEST_WEB_PORT=16201 ATOLL_TEST_MOCK_PORT=20501 npx playwright test tests/browser/notification-high-water.spec.js --workers=1 --reporter=line --output=test-results-browser-ns-round17-highwater-16201-20260920
# 4 failed：四条均为 rail.channels[0] undefined；DOM 断言先通过
```

N4/H4 owner oracle 在同一 HEAD **2 passed（oracle 本身只采集）**，但 `firstDivergence` 均为 rail：

- **N4 filtered-tail**：c0 cursor/readSeq=`25`、notification high-water=`61`，Replica `headSeq=61`（44 rows，包含 unrelated 与 approvals），filtered Presentation `mode=following/gap=0`、approval 30/31 可见，DOM `related/total/pending/jump=0/0/false/0`；rail `present=false, authorityReady=false, channels=[]`。
- **H4 following-after-arrival**：c0.project cursor/readSeq=`25`、notification high-water=`28`，Replica `headSeq=28`（arrival row 已在），Presentation `mode=following/gap=0`、新 approval 可见，Reading visible IDs 含新 row，DOM `0/0/false/0`；rail 仍 `present=false, authorityReady=false, channels=[]`，首断点 reason=`rail high-water 0 < expected 1`。

因此第16轮结论在当前冻结 high-water 合同下被修正：filter 外逐条 retention 仍不是本轮要求，但**rail channel authority/high-water projection 是真实 notification owner 合同**，不是可删除的测试细节。首个公开 owner 边界为 `channel-feed-runtime` → `registerRailDiagnosticProvider` 当前未接入；其前置 cursor、Replica、Presentation、DOM/Reading 均已有证据。该回归交 `notification_owner`，不归 fixture/selector，不改产品实现。

为避免测试被“删 raw”假绿，N4 已恢复仅要求 `channelPresent=true && authorityReady=true` 的 authority 门，保留 DOM 与 scalar high-water 语义，不恢复过时的 `outsideFilterPreserved` 逐 filter 断言。当前 N4 复验故意 **1 failed**，证据 `test-results-browser-ns-round17-n4-16204-20260920/`：44 帧、DOM `0/0/false/0`、Replica/confirmation 链已完成，末尾 authority 轮询仍 `{channelPresent:false,authorityReady:false}`。
