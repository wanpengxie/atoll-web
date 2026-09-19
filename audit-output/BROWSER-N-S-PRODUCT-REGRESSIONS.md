# Browser N–S 产品分歧交接包（f6cebbb）

本文件只交接可复现的产品分歧；没有修改 `src/`、没有加兼容 owner，也没有通过放宽 case 隐藏失败。所有入口均由真实浏览器从 `/` 登录后进入当前 workspace。

## 2026-09-20 当前复验交接

最终冻结轮使用 `cbd8591` disconnect 修复及当前 Composer owner 的 Tiptap 生命周期 guard 候选，命令如下：

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

**15 tests：5 passed / 10 failed（3.3m）**。最终轮没有 `feed.disconnectHistory owner 尚未连接`，也没有 Tiptap `editor.view.dom`/`schema=null` uncaught；N2 专门复验已从频道切换继续执行至真实通知断言。证据目录保留 trace、screenshots、JSON attachments；没有跳过、删除或弱化 case。

当前需要产品 owner 处理的公开边界：

| 分歧 | 影响 case | 当前证据与首个公开 owner |
|---|---|---|
| following tail receipt 短暂显示 related unread | N1、N2 | 唯一 owner 的 `gap=0`，但 20/6 条 arrival 期间 badge 仍为 1–5；`ConversationSurface → ReadingContainerHandoff → VendorListExecutor` 与 notification receipt 时序。 |
| actor-filter rail authority 未建立 | N4 | raw rail `channels=[]`/`authorityReady=false`，outside filter unread 不保留；feed runtime rail snapshot 与 actor-filter projection。 |
| high-water snapshot、hydration、following advancement 不兑现 | notification-high-water 1–4 | 切换可完成但公开 rail channel snapshot 缺失、reload 后 2 条 unread 不恢复、following high-water 不推进；channel-replica hydration → feed runtime cursor/high-water → rail projection。 |
| readable root 的 rail/observation 不完整 | notification-policy 1–2 | final root 未出现 unread；readable-event row 已物化但没有 `reading.observation.visibleRowIDs`；notification policy 与 ConversationSurface presentation admission。 |
| document-session browsing row 未恢复 | reading-position-session | c0→project→c0 不再崩溃，但原 browsing row 60s 内未回到唯一 owner 可见区域；reading-session startup/admission owner。 |

Composer/Tiptap 说明：旧 disconnect 修复后的 N2 曾在 `Composer.jsx` passive effect 访问未挂载/已销毁 EditorView，导致 root 清空；当前 owner guard 候选后该 uncaught 不再出现。该 guard 属产品 owner 工作树，不是本测试包的改动；N2 当前 RED 已回到 notification receipt 合同，不能归因于 fixture。

## notification owner 提交前后独立验收

目标为 N2、N4、四条 high-water 与 F7；测试侧保持同一 spec、fixture、断言。提交前目录为 `test-results-notification-owner-pre-20260920`，`a721412` 后为 `test-results-notification-owner-post-20260920`，最终 `71dcb38` 后为 `test-results-notification-owner-final-20260920`。三阶段浏览器结果均为 **0/7 passed**。

`a721412` 的 frozen confirmation 改善未改变公开 UI 状态：N2 仍在 `gap=0` following tail 显示 related badge，N4 仍 `authorityReady=false`/outside unread false，high-water rail snapshot/hydration/advancement 仍缺失，F7 仍无法恢复 browsing row。`71dcb38` 的 cursor authority reset 使新增 `tests/notification-state-contract.test.js` 达到 **5/5 unit passed**，但没有改变上述浏览器结果；unit persistence 绿色不能替代真实 owner 状态转移。

验收状态转移合同：

- N2：离开频道 `unread=3` → 切回真实到底 `badge/jump=0` → 6 次 following arrival 每帧 0；实际提交前后均为 `whileAway=3`、`gap=0`、`afterLeaving=0`，中间仍出现 badge（前：1/5；后：1/3/2）。
- N4：安装 actor filter → `authorityReady=true` → scope 内 approval 清零且 outside row counted；提交前后 raw rail 都是 `channels=[]`。
- high-water：H1 预期 `readSeq=25/highWater=27`、未来 row 后 `28`；H2 reload 恢复 `2` 再确认不复活；H3 filtered boundary `27`；H4 following arrival 推进 high-water。提交前后分别表现为 rail channel 缺失、reload badge 缺失、filtered snapshot 缺失、high-water 10s 不推进。
- F7：cold/cached latest → browse → c0↔project→恢复同一 first-visible row/位置；提交前单行漂移，最终提交后回返 60s 超时。

因此以上公开 owner 分歧仍需产品处理；测试侧不以 unit 结果、徽标暂时压零或修改 fixture 关闭交接。

## 可重跑最小 oracle：0/7 首个分歧（2026-09-20）

测试侧新增 `tests/browser/notification-owner-oracle.spec.js`，只读真实浏览器公开事实，不改产品、fixture 或既有断言。命令：

```text
ATOLL_TEST_WEB_PORT=15310 ATOLL_TEST_MOCK_PORT=18910 npx playwright test \
  tests/browser/notification-owner-oracle.spec.js \
  --reporter=line --output=test-results-notification-owner-oracle-pre-20260920
```

观测器 **7/7 完成**；按 `input → cursor/highwater → replica → presentation → rail → reading` 的顺序，首个产品分歧仍为 **7/7 RED**：

| case | 首个分歧 | 复验事实 |
|---|---|---|
| N2 | rail | following `gap=0` 下 34 帧出现 related `1→4` 瞬时未读；之后归零。cursor/replica 已到位。 |
| N4 | rail | cursor=63、replica 已含 unrelated 与 approval；公开 rail `channels=[]`、无 authority。 |
| H1 | rail | cursor=30、replica head=32；future ack 公开 rail high-water=0/无 channel。 |
| H2 | rail | cursor=29、rows/meta 已 hydrate；二次 reload 公开 rail 仍无 channel/high-water。 |
| H3 | rail | filtered tail cursor=29、replica head=29；公开 filtered rail high-water=0。 |
| H4 | rail | following arrival cursor=28、replica head=28、owner gap=0；公开 rail high-water 未推进（0）。 |
| F7 | presentation | `c0-history-request-112` 在 replica（head=848）但回返后不在唯一 owner visible IDs。 |

这组 oracle 的绿色仅表示证据采集成功，不能替代原有 0/7 合同断言。产品交接保持：N2/N4/H1–H4 由 notification rail/high-water authority owner 处理；F7 由 reading-session/presentation admission owner 处理。证据保存在 `test-results-notification-owner-oracle-pre-20260920/`。

## 新协议后立即复验（HEAD `6060588`）

沿用 `34d6f0c` oracle，在共享 HEAD `6060588` 立即重跑 7 条：

```text
ATOLL_TEST_WEB_PORT=15320 ATOLL_TEST_MOCK_PORT=18920 npx playwright test \
  tests/browser/notification-owner-oracle.spec.js \
  --reporter=line --output=test-results-notification-owner-oracle-post-6060588-20260920
```

观测器 **7/7 完成**，但产品合同仍 **0/7**。N2 的 following tail 在 `gap=0` 时仍出现 related `1/3/2` 的瞬时帧；N4 的 cursor/replica 已到 c0=63/head=63，但公开 rail 无 authority；H1/H2/H3/H4 的 cursor 与 replica 已推进或恢复（分别为 30/29/29/28，replica head 32/29/29/28），公开 rail high-water 仍为 0 或 channel 缺失；F7 的 `c0-history-request-112` 已在 replica head=848，但回返后的唯一 owner visible IDs 仍不包含该 row。首个分歧保持 **N2/N4/H1–H4=rail，F7=presentation**，没有被新协议推迟或转移。

该轮未修改产品、fixture、断言或 skip；证据位于 `test-results-notification-owner-oracle-post-6060588-20260920/`。

## `77760c8` frozen owner receipts 后复验

在 `77760c8` 及当前 HEAD（另含 `07ed014` teardown fence）用未修改的 `34d6f0c` oracle 逐条重跑 7 条。一次并发源码编辑造成的 `controller is not defined` 仅作为竞态噪声丢弃；稳定逐条运行均完成，证据在 `test-results-notification-owner-oracle-post-77760c8-stable-{N2,N4,H1,H2,H3,H4,F7}-20260920/`。

- **N2：receipt 修复有效。** 45 个 following、`gap=0` 帧全部保持 badge/jump=0，之前 related `1→4` 的瞬时 rail 分歧关闭；cursor=34、replica head=34。公开 `rail.snapshot` 仍为空，故只关闭用户可见瞬时分歧，不能宣称 rail authority 已完整。
- **N4：仍 rail。** filtered tail c0 cursor=57、replica head=57，unrelated/approval row 已落地，但 `channels=[]`/无 `authorityReady`。
- **H1：仍 rail。** future ack c0.project cursor=28、replica head=28，owner visible/gap=0；公开 high-water 仍 0。
- **H2：仍 rail。** second hydration cursor/replica=27，公开 rail channel/high-water 仍缺失。
- **H3：首断点前移到 cursor/highwater。** filtered tail cursor 仍 25、replica head=27、DOM related=2；冻结 receipt 拒绝未满足完整 owner 边界的 ack。前轮首断点是 rail provider 缺失。
- **H4：仍 rail。** new approval 已进入 visible owner（cursor/replica=26，gap=0），但公开 high-water=0。
- **F7：仍 presentation。** replica 已有 head=844，回返仍 browsing/gap=3866，目标 row 112 未恢复到 visible（当前可见 102–105）。

因此 frozen owner receipts 的实质收益是 N2 瞬时 badge 消失及 H3 更早暴露 cursor boundary；N4/H1/H2/H4 的公开 rail 投影和 F7 的 presentation admission 仍需各自公开 owner 处理。全程未改产品、fixture、断言或 skip。

## DOM 主证据与 diagnostics 分层（当前 HEAD `2265cfa` / `cfc26a7`）

重新跑 oracle 及原 N4/high-water/F7 合同后，不能把空 `rail.snapshot` 直接算成用户 rail 回归：

- **N4：** c0 左侧 `.unread-related/.unread-total/.unread-pending/jump` 均为 0，filtered owner `gap=0`；原测试在 raw `authorityReady/outsideFilterPreserved` 断言失败。结论是无用户可见 badge 错，只有 diagnostics/raw projection 缺失。
- **H1：** 真实 DOM 已经历 related `2 → 0 → 1 → 0`，再在 `rail.channels[0]` 缺失处失败；无用户可见 badge 错。
- **H2：** reload 后 project related=2、ack 后和二次 reload=0 的 DOM 断言先通过，再在 rail snapshot 缺失处失败；无用户可见 badge 错。
- **H3：** 离开时 related=2、filtered tail/离开后=0 的 DOM 断言先通过；当前 cursor 已推进 27，失败仍是空 diagnostics channel；无用户可见 badge 错。
- **H4：** diagnostics high-water poll 先超时；独立 oracle 随后确认 arrival 已进 visible owner 且 related/total/pending/jump 全 0、gap=0；无可见 badge 错，缺的是可观测 high-water 发布。
- **F7：** oracle 的 return snapshot 曾看到目标 row 112 与 111–114 同屏，但严格原合同 line 145 仍超时，故仍保留为 presentation admission/timing 问题，不能归入 rail。

产品交接应据此拆分：N4/H1–H4 当前主要是公开 diagnostics/provider 可观测性缺口（不是左侧数字或 jump 错）；F7 是 reading-session/presentation visibility 稳定性缺口。证据目录：`test-results-notification-owner-oracle-post-2265cfa-20260920/` 及对应 DOM 合同输出目录。未修改产品、fixture、断言或 skip。

## 第七轮 Luna Max：HEAD `5aef9f4` 与 readable_event

沿用 `34d6f0c` oracle，N2/N4/H1–H4/F7 **7/7 观测完成**（目录 `test-results-notification-owner-oracle-post-5aef9f4-20260920/`）。DOM 用户可见结论：

- N2 following arrival 的 gap=0 帧中 related/total/pending/jump 全 0，之前 transient badge 已闭合。
- N4 filtered tail 的 c0 rail 数字与 jump 全 0；H1 DOM `2→0→reload 0→future 1→ack 0`；H2 reload unread=2、ack/二次 reload=0；H3 离开时 2、filtered tail/离开后 0；H4 arrival 后新 row visible、gap=0、badge/jump 全 0。以上均不是用户可见 rail 数字错误；空 `rail.snapshot` 只记 instrumentation/provider 缺口。
- H1–H4 原合同仍在 diagnostics/high-water 断言失败，故“DOM 通过”不等于公开 rail/high-water 合同完成。
- F7 仍是 presentation/reading owner 问题：oracle return 未稳定恢复 row 112，严格合同还观察到 Hook-order `Should have a queue` 与 reading owner=0 截断。

readable_event 是本轮真实可见回归：`notification-policy` 的 final readable root 没有产生预期左 rail `.unread-total=1`；独立 readable-event row 本身可见，但没有 `reading.observation.visibleRowIDs` 记录，故首断点在 presentation→reading handoff，不是空 diagnostics 误报。证据目录：`test-results-readable-event-5aef9f4-20260920/`。

裁决：Outbox P0 相关提交已改善 reload、ack 不复活和 following DOM 计数，但 notification owner 尚未全闭合；需公开 owner 处理 rail/high-water provider、readable final badge、readable_event reading observation 与 F7 presentation stability。未修改产品、fixture、断言或 skip。

## R1（历史记录，已由 `cbd8591` 关闭）：频道切换时 history owner 尚未连接

这条历史分歧不再是当前复验结果：`cbd8591` 后频道切换可以继续进入真实页面；最终轮未记录该错误。以下步骤和栈保留作修复前 provenance，不应作为当前 RED 计数。

- 影响 case：N2、notification-high-water 1/3/4、notification-policy 1、reading-position-session（共 6 个 RED case 的共同截断点）。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15199 ATOLL_TEST_MOCK_PORT=18858 npx playwright test tests/browser/reading-position-session.spec.js --reporter=line`
  2. 登录 `root/root`，等待 `state-open` 和唯一 `.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list`。
  3. 点击真实频道按钮 `# c0.project`。
  4. 预期 `main h1` 为 `c0.project`，当前结果 workspace 消失，`main h1` 不存在。

- 基线能力：用户可在频道间切换并继续查看/保持读位置；通知 ack 和 refresh contract 依赖这个切换边界。
- 首个公开 owner 边界：wire state callback `useWireSession.onState` 调用公开 feed port 的 `disconnectHistory`；`WorkspaceApp` 的 owner guard 抛出 `feed.disconnectHistory owner 尚未连接`。不是 selector、fixture 或旧入口加载错误。
- 证据：Playwright console 记录 `[Unhandled error] Error: feed.disconnectHistory owner 尚未连接`；同一 run 在切换前已经显示真实 c0 heading、connection open 和唯一 reading owner。
- 交接：由产品 owner 决定 disconnect/connect 的生命周期顺序；本分区不改 `WorkspaceApp` 或 wire session。

## R2：Following append 后唯一 reading owner 离开物理尾部

当前复验更新：该条的旧 off-tail 现象没有再出现；最终 N1 为 **47/47 `gap<=2`、0 off-tail**，但 arrival 期间仍出现 related badge 1–5，故合同仍 RED。现首个分歧边界从几何 owner 下移到 following presentation receipt/high-water 清零时序。证据：`test-results-browser-n-s-post-composer-guard-20260920/N-im-read-fallback-N1-有积压跳到最新即同时清零，且停在底部连续到达-20-条时两处计数恒为-0/N1-following-tail.json`。

- 影响 case：N1。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15213 ATOLL_TEST_MOCK_PORT=18863 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep 'N1 有积压' --reporter=line`
  2. 登录后把真实 owner 滚到底，使用 mock control 仅产生真实 approval arrivals（不调用滚动修正）。
  3. 连续产生 20 条；每帧读取唯一 owner 的物理 gap 和频道/jump badges。
  4. 预期 gap 始终 ≤2、badges/jump 始终 0；当前 `mode=browsing`，gap 可从 224 增至 4480，产生 off-tail frames。

- 基线能力：用户停在尾部时连续新消息保持尾随，不被虚假“有新消息”打断。
- 首个公开 owner 边界：`ConversationSurface` 发布的唯一 reading owner → `ReadingContainerHandoff` → `VendorListExecutor` append/presentation geometry；notification rail 仍有真实 arrival，偏差首先出现在 owner 的物理 tail。
- 证据：`N1-following-tail.json` 保留了 arrival frames、gap、mode、notice frames 和离开尾部后的 counts；test 不调用 reachBottom 伪造通过。
- 交接：由 reading owner/geometry owner 修复 append 后物理尾随；本分区不新增第二容器或滚动 writer。

## R3：actor filter 的 raw rail authority 未建立，过滤外 unread 未保留

- 影响 case：N4。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15213 ATOLL_TEST_MOCK_PORT=18863 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep 'N4 成员过滤' --reporter=line`
  2. 登录 c0，启用 `只看我与 steward 的往来`，在唯一 owner 尾部。
  3. 注入一个 `related=false` outside arrival，再注入 6 个 steward approvals。
  4. 预期 installed steward scope 全部 ack，outside row 仍 counted；当前 `authorityReady=false`、`outsideFilterPreserved=false`。

- 基线能力：scope 内已读不能吞掉 scope 外提醒。
- 首个公开 owner 边界：channel feed runtime 的 rail snapshot / actor-filter projection 与 reading receipt 的 authority handoff；DOM selector 已是当前 `data-presentation-row-id`/唯一 owner。
- 证据：`N4-persistence-failure.json` 含 rail、reading、local reads 原始快照；断言在 raw rail truth 上失败，不接受徽标“压零”作为替代。
- 交接：由 notification/reading authority owner 修复过滤边界；本分区不另建 rail 状态。

## R4：cached hydration 未恢复已 ack 的 high-water

- 影响 case：notification-high-water 2。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15214 ATOLL_TEST_MOCK_PORT=18864 npx playwright test tests/browser/notification-high-water.spec.js --grep 'cached hydration' --reporter=line`
  2. 对 c0.project 注入两次真实 approval，确认 badge 为 2；刷新后再次等待 `state-open`。
  3. 预期 badge 仍为 2，进入尾部确认后刷新不复活；当前刷新后的初始 badge 不存在。

- 基线能力：冷启动不能丢失未读，也不能复活已确认未读。
- 首个公开 owner 边界：`channel-replica` rows/meta hydration → feed runtime notification cursor/high-water → rail projection；不再访问旧 `atoll-feed-v8/channelMeta`。
- 证据：迁移后 test 通过真实 IndexedDB `atoll-channel-replica-v1`、真实 badge、真实 reload 验证；失败不是旧 DB 名或 selector。
- 交接：由 replica/runtime persistence owner 决定 checkpoint hydration 顺序；本分区不恢复旧 store。

## R5：readable event 没有物化为当前 presentation row

当前复验更新：`data-presentation-row-id="c0.project-notification-readable-event"` 已在真实 DOM 物化；RED 现在发生在下一条合同——唯一 reading owner 的 `reading.observation.visibleRowIDs` 没有包含该 row。首个 owner 仍是 ConversationSurface/presentation admission 与 reading observation handoff，不是旧 selector。

- 影响 case：notification-policy 2。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15215 ATOLL_TEST_MOCK_PORT=18865 npx playwright test tests/browser/notification-policy.spec.js --grep 'tool, timer' --reporter=line`
  2. 通过 mock control 发送 lifecycle `readable_event`，确认 rail quiet；点击真实 `# c0.project`。
  3. 预期可见 `[data-presentation-row-id="c0.project-notification-readable-event"]` 并有 reading observation；当前该 row 未物化。

- 基线能力：独立 readable public event 可见且拥有独立通知 root，不能被 transport/activity event 合并或吞掉。
- 首个公开 owner 边界：`ConversationSurface` 的 presentation projection / `VendorListExecutor` row admission；当前 row identity 已是实际 `data-presentation-row-id`。
- 证据：在切换崩溃前的 lifecycle assertions 已通过；失败定位在当前 row materialization，不是旧 `[data-entry-id]`。
- 交接：由 presentation admission owner 决定 readable event 的公开 row 形状和可见性；本分区不把 mock payload 直接注入 DOM。

## R6：高水位公开投影与 hydration 未兑现

- 影响 case：`notification-high-water.spec.js` 四条。
- 当前复验：切换后 workspace 可继续渲染，但 case 1/3 的 `rail.snapshot(...).channels[0]` 缺失；case 2 reload 后预期 `2` 条未读没有恢复；case 4 的 following arrival 后 `notificationHighWater` 在 10s 内没有推进。失败发生在真实 `atoll-channel-replica-v1`/rail diagnostics 合同，不是旧 store、旧 selector 或 Composer 截断。
- 首个公开 owner 边界：channel-replica rows/meta hydration → feed runtime notification cursor/high-water → rail projection；过滤 tail 的 boundary 也必须经该 owner 发布。
- 交接：由 replica/runtime notification owner 修复 hydration 顺序、公开 channel snapshot 和 presented-tail receipt 的推进；本分区不恢复 `atoll-feed-v8` 或增加测试 fallback。

## R7：lifecycle final readable root 未进入 rail

- 影响 case：`notification-policy.spec.js` 的 `rail follows presented lifecycle roots...`。
- 当前复验：processing/tool/control 等 quiet 断言与真实 channel switch 均通过；发送 lifecycle `final` 后 `.unread-total` 没有达到预期 `1`，所以最终 readable root 没有成为未读 rail 项。
- 首个公开 owner 边界：notification policy 对 final root 的分类与 channel-feed rail projection；不是 Composer 或 fixture。
- 交接：由 notification policy/rail owner 保持 exact readable identity，并让未展示的 final root 进入可持久化 unread projection。

## R8：document-session browsing row 往返未恢复

- 影响 case：`reading-position-session.spec.js`。
- 当前复验：cold start/cached latest assertions 先通过，c0→c0.project→c0 的 heading 也通过；回返后原 `beforeSwitch.firstVisible.id` 在 60s 内没有重新出现在唯一 reading owner 的可见区域，测试超时。
- 首个公开 owner 边界：reading-session startup/admission 与 canonical reading owner 的 virtualized row admission；不是旧 `LegendMessageList` 或旧 DB 名。
- 交接：由 reading-session/admission owner 修复文档 session 内 browsing anchor 的跨频道回返恢复；不改测试成滚底或删除 anchor assertion。

## 第八轮只读复验：readable_event badge 与 F7 handoff（执行起点 HEAD `05b1fff`，2026-09-20）

本轮使用临时 observation-only probe 采集真实 DOM hit-test、唯一 active owner、owner activation、`coldEntry` history/presentation revision、reading trace 和左 rail DOM；probe 已在运行后删除。另用 `34d6f0c` notification owner oracle 重跑 F7。未改产品、fixture、断言或 skip。

### readable_event：两个断点分开裁决

- `notification-policy.spec.js` 的 readable_event 合同仍在 line 243 超时，但 probe 证明 `c0.project-notification-readable-event` 从首个 project sample 起就在唯一 owner 的真实可见区域，`ownerCount=1`，`mode=following`，`Presentation revision=4/sourceRevision=18`、history `presentationRevision=18` 稳定，target 连续通过 element hit-test。故旧 R5“row 未物化”已关闭。
- reading trace 只有 `trace.enabled`，没有 `reading.observation`/`visibleRowIDs`/`installed-tail-ack`/`arrival-resolution`；显式滚动 target 后仍如此。首个产品 owner 边界是 **Presentation/DOM → reading observation handoff**，不是空 diagnostics。
- final readable root 的用户可见 badge 另由独立 probe 复验：c0 上 request → processing → progress → final 后立即和 1.5s settle，project `.unread-related/.unread-total/.unread-pending/jump=0/0/false/0`；原合同 line 154 要求 `.unread-total=1`，所以这是实际 rail badge RED。空 `rail.snapshot` 不参与该判断。公开 owner：notification policy → rail projection。

### F7：input/replica 已到位，回返 presentation 仍红

F7 timing probe 中 browsing 前 `c0-history-request-112/113/114` 均真实可见；回返 55 个 100ms samples 内 owner 始终单一、`mode=browsing`，但 target 112 始终在视口上方，visible 只含 120/approval/summary。回返时 Presentation `revision=7/sourceRevision=80` 稳定、replica head=848 且已含 target，cursor=844；因此不是 input、replica、cursor 或 rail diagnostics 分歧。当前 34d6f0c oracle 的 `firstDivergence=presentation`，公开 owner：reading-session/admission → virtualized presentation。

### 共享工作树错误隔离

当前共享树含未提交 `WorkspaceApp.jsx`/Composer 变更；一次独立 final-badge 合同运行出现 React Hook-order / `Should have a queue` console，但该运行仍确定性落在 line 154 badge 缺失。readable_event/F7 timing probe 均无 pageerror，F7 oracle 完整采集且 ownerCount 未为 0；Hook 仅记为共享 dirty 旁证，不能用来解释 readable badge 或 F7 首断点。启动期 401 console 也没有 pageerror。

本轮证据目录：`test-results-browser-ns-reading-probe-05b1fff-20260920/`、`test-results-browser-ns-readable-final-badge-20260920/`、`test-results-browser-ns-f7-oracle-current-20260920/`；可重跑命令和逐阶段 activation/revision 详见迁移报告对应第八轮节。notification owner 交接保持：final readable badge 归 notification policy/rail projection；readable_event observation 归 DOM→reading handoff；F7 归 reading-session/presentation admission。 

共享分支随后推进到当前 HEAD `ef8f906`；立即重跑同一 F7 oracle 仍为 **1 passed**，`firstDivergence=presentation`，cursor=844、replica head=848 且含 target 112，visible owner 仍只显示 120/approval/summary。新证据目录：`test-results-browser-ns-f7-oracle-ef8f906-20260920/`；未改变上述公开 owner 裁决。

当前 `ef8f906` 的 notification-policy 两条合同也仍保持 RED：line 154 final readable badge 缺失、line 243 readable_event observation 超时；对应目录为 `test-results-browser-ns-readable-badge-current-ef8f906-20260920/`、`test-results-browser-ns-readable-current-ef8f906-20260920/`，没有新的 Hook/pageerror 截断。

## 结论

以上当前 R2–R8 覆盖最终 10 个 RED case 的真实分歧；历史 R1 disconnect 已关闭，Composer/Tiptap guard 的 uncaught 也未在最终轮复现。5 个 PASS case（N3、offline、performance 三条）已在同一真实入口通过，未以 mock success 替代用户行为。
