# Browser G–M `fae8b70` migration ledger

基线：`fae8b7010afd1b3a950bc455ba6a577b65378cda`。本分区只覆盖 basename 为 G–M 的
14 个 browser spec、32 个 Playwright runtime case；执行入口是当前真实 `/` AppShell，
不是旧 prototype harness。当前工作树可能包含其他分区的并行改动；本报告只裁决本分区
spec 与证据。没有修改 `src/`、vendor、package/lockfile，也没有删 test、删 skip 或把
失败改成假绿。

## Aggregate

| 维度 | 数量 |
|---|---:|
| baseline spec / runtime case | 14 / 32 |
| current spec / runtime case | 14 / 32 |
| 当前真实入口通过 | 21（最终全组轮） |
| 当前产品回归/缺口 | 11（最终全组轮） |
| skipped / deleted | 0 / 0 |
| fixture 删除或改写 | 0 / 0 |

最终冻结轮（独立 mock/web 端口）使用：

```text
ATOLL_TEST_MOCK_PORT=19872 ATOLL_TEST_WEB_PORT=15172 npx playwright test \
  tests/browser/history-presentation-admission-prototype.spec.js \
  tests/browser/history-reveal-prototype.spec.js \
  tests/browser/history-start-boundary.spec.js \
  tests/browser/history-underfill-lifecycle.spec.js \
  tests/browser/horizontal-table-scroll.spec.js \
  tests/browser/input-resize-observer-loop.spec.js \
  tests/browser/jump-latest-ownership.spec.js \
  tests/browser/layout-responsive.spec.js \
  tests/browser/legend-production-admission.spec.js \
  tests/browser/live-tail-entry.spec.js \
  tests/browser/member-filter-timeline.spec.js \
  tests/browser/mobile-ux-isolation.spec.js \
  tests/browser/model-selector-manual.spec.js \
  tests/browser/model-selector-portal.spec.js --reporter=line
```

结果是 **32 tests，21 passed，11 failed（3.4m）**。失败均在当前公开入口上保留了可见行为、
布局/几何、键鼠或数据语义断言；单独重跑 same-turn terminal（当前 presentation-row
owner）为 PASS。历史 reveal 的空帧和 history admission/underfill 的失败没有用等待
诊断事件替代用户可见结果；模型 selector 的失败先附带真实 dialog 几何，再在缺少
可选模型项处失败。

## Case ledger

`owner` 是当前生产 owner；`result` 是上述 Chromium 全组轮的逐 case 裁决。每行保留
baseline 用户动作、能力/不变量和真实当前边界。`REGRESSION` 表示可复现的产品缺口，
不是旧 selector/import 误报；`PASS` 表示当前 owner 已验证。

| # | Baseline exact case | 用户动作 → 能力 / 不变量 | Current owner / public entry | Result / evidence | Disposition |
|---:|---|---|---|---|---|
| 1 | `history-presentation-admission-prototype.spec.js:36` — `prototype: one history intent stages sparse matches and publishes one real prepend` | 登录、筛选 steward/Claude、上滚一次；历史 sparse admission 必须在同一 reading surface prepend，anchor/布局不跳且不重复 | `main.jsx → WorkspaceApp → createChannelFeedRuntime/useHistoryConsumer/useConversationProjection → ConversationSurface → VendorListExecutor`; `.timeline-message-list` | **REGRESSION**：可见 baseline row 数保持 4，未发生预期 prepend；证据先记录 visible rows/anchor/active list，再记录 history events | 保留红测，交 history admission/presentation owner |
| 2 | `history-reveal-prototype.spec.js:204` — `normal-flow history reveal prototype has one spatial owner and no blank paint` | 真实 history reveal 期间唯一 active layer/list，行可见，不能出现空白帧、断开节点或重复 surface | 同上；`.timeline-reading-layer.is-active .timeline-message-list` | **REGRESSION**：最新复核出现至少一帧 `visibleRows=0`；不以私有 reveal token 代替 blank-paint 结果 | 保留红测，交 reading/presentation owner |
| 3 | `history-reveal-prototype.spec.js:257` — `trusted wheel takes over an active reveal without replay or scroll compensation` | trusted wheel 介入 reveal 后必须进入 browsing，不能由 app 重放 scroll writer 或空白补偿 | ReadingIntent + root reading owner；真实 wheel / `.timeline-message-list` | **REGRESSION**：wheel 后仍为 `following`，并观察到 3 次 `scrollTo` 写入；键鼠事件真实但 owner handoff 未发生 | 保留红测，交 reading intent/scroll owner |
| 4 | `history-reveal-prototype.spec.js:294` — `status identity, background isolation, bounded queue, and reduced motion stay explicit` | background history、status identity、reduced motion 不得吞掉现有行；surface/布局仍唯一且可见 | History status + ConversationSurface/VendorListExecutor | **PASS**：status identity、active layer/list、visible rows 与 reduced-motion 尾部通过 | 已迁并验证 |
| 5 | `history-reveal-prototype.spec.js:355` — `activation replacement drops an in-flight reveal token without replay` | 切换 `c0 → c0.project → c0` 时旧 reveal 不得回放到新频道；目标 heading/list 和返回数据必须出现 | WorkspaceApp channel handoff + feed runtime/history owner | **PASS**：真实目标 heading/list 建立，返回 c0 后只恢复 c0 rows；没有观察到旧 reveal replay 或断开 owner 错误 | 已迁并验证 |
| 6 | `history-start-boundary.spec.js:62` — `authoritative history start is an ordinary scrolling item without disabling list anchoring` | 滚到历史起点；boundary 是普通 flow item，可见、可回滚，不能用 fixed/absolute 或 ResizeObserver loop | History boundary presentation + canonical reading owner | **PASS**：起点 row、marker 位置、回滚后单一 marker、resize-loop evidence 通过 | 已迁并验证 |
| 7 | `history-start-boundary.spec.js:233` — `an open history frontier prepends without transferring boundary geometry between rows` | open frontier prepend 后已有 row identity/height/位置保持；boundary 不转移给旧 row | `useHistoryConsumer/useConversationProjection → VendorListExecutor`; presentation row identity | **PASS**：已有 row connected、height 保持、boundary count=0 | 已迁并验证 |
| 8 | `history-underfill-lifecycle.spec.js:16` — `identity-pending all-scope underfill stays silent and resumes from scheduler progress` | 深历史上滚遇到 underfill；请求 owner 必须唯一、无 pending/status 泄漏，回到可见 history 1 并继续进度 | History demand/consumer + VendorListExecutor; visible `.timeline-message-list` | **REGRESSION**：settle 后 `c0 history 1` 不可见；evidence 记录 historyOneVisible=false、demand/pending/settle，而不是等待私有 scheduler 事件 | 保留红测，交 history demand/admission owner |
| 9 | `horizontal-table-scroll.spec.js:204` — `wide Markdown table keeps native horizontal reading position through background App updates` | 宽 Markdown 表格 Shift+wheel 横向滚动；background pulse/dense update 不得重置 native scrollLeft，也不能由 App 写 scrollLeft | ConversationSurface + MarkdownContent `.markdown-table-scroll` | **PASS**：native horizontal position、trusted event、node identity/connected、无 app scrollLeft writer 通过 | 已迁并验证 |
| 10 | `input-resize-observer-loop.spec.js:71` — `the detector is live: a deliberate loop is seen on both production channels` | detector 故意制造 RO loop；browser 与 app diagnostic channel 必须能观察 loop，而 Playwright channel 保持干净 | Browser ResizeObserver + production diagnostics bridge | **PASS**：deliveries、browser/app loop diagnostics 与 Playwright no-error channel 均通过 | 已迁并验证 |
| 11 | `input-resize-observer-loop.spec.js:188` — `no ResizeObserver loop on the production path — long-running-history` | 真实 long-running history 增长、输入区 resize、滚动/ pulse 后最终 settle；不能出现 RO loop 或未 settle measurement | Composer + ConversationSurface ResizeObserver boundary | **PASS**：deliveries>0，loops/diagnostics/unsettled 均为空 | 已迁并验证 |
| 12 | `input-resize-observer-loop.spec.js:188` — `no ResizeObserver loop on the production path — huge-history` | huge ledger 同样必须保持输入/scroll/pulse 几何稳定且无浏览器/app RO loop | Composer + ConversationSurface + bounded VendorListExecutor | **PASS**：真实 huge-history path settle，无 loop/diagnostic/unsettled | 已迁并验证 |
| 13 | `jump-latest-ownership.spec.js:76` — `browsing reader jump-latest writes once, reaches the installed tail, then acknowledges unseen` | browsing 时 live pulse 产生 jump；用户 click 后一次 current owner scroll 写入，回到 tail/following，unseen 清零 | ConversationSurface + useLiveArrivalReceipts + root `.timeline-message-list` / `.timeline-jump-latest` | **REGRESSION**：jump button 不出现；evidence 先记录 jumpVisible=false、writer/frames，未把缺 button 改成等待私有 receipt | 保留红测，交 live-tail/jump owner |
| 14 | `jump-latest-ownership.spec.js:116` — `a visible reader already at tail acknowledges append and resize without publishing unseen` | 已在 tail 的 reader 收到 append/pulse 后仍 following、gap≤1、无 jump/unseen | Reading owner + live arrival receipt | **PASS**：tail geometry、mode、rows/evidence 通过 | 已迁并验证 |
| 15 | `jump-latest-ownership.spec.js:138` — `same-turn terminal arrival joins committed tail evidence without a resize callback` | 同 turn terminal 到达必须以当前 presentation row identity 加入已提交 tail；不能靠旧 request-id carrier 或 RO callback | ConversationSurface presentation row owner + terminal receipt | **PASS**（独立 rerun）：以 `[data-presentation-row-id]` 查当前 row，唯一出现、gap≤1、following；不再使用 stale `[data-request-id]` | 已迁 current identity |
| 16 | `layout-responsive.spec.js:19` — `LAYOUT-01 Actor 详情保留名册头部，能力表单拥有独立布局区` | 详情页名册 header、capability form、focus/布局区域分别可见且不相互覆盖 | WorkspaceLayout + Actor details / capability surface | **PASS**：真实 actor details header/form bounds 与 focus 通过 | 已迁并验证 |
| 17 | `layout-responsive.spec.js:48` — `LAYOUT-02 320px 下频道列表、工作区和 Context 是可返回的单表面` | 320px 下 channel list/workspace/context 可进入并返回；不产生横溢出 | SurfaceShell + SidePanel + ConversationSurface | **PASS**：single returnable surface、viewport geometry、no horizontal overflow | 已迁并验证 |
| 18 | `layout-responsive.spec.js:94` — `LAYOUT-03 @成员菜单以输入区为边界且不改变输入区位置` | 键盘 `@` 菜单被输入区约束；打开/关闭不移动 composer，menu hit target 可用 | Composer mention menu + input slot | **PASS**：menu containment、input bounds/focus 与 keyboard path 通过 | 已迁并验证 |
| 19 | `layout-responsive.spec.js:116` — `LAYOUT-04 已完成任务原地定格答案且 Agent 气泡无按钮` | completed Agent answer 原位可见、正文语义不变；Agent bubble 不出现非合同操作按钮 | ConversationSurface + completed turn renderer | **PASS**：copy/reply/process-summary surface contract 通过 | 已迁并验证 |
| 20 | `layout-responsive.spec.js:132` — `LAYOUT-05 Context 在 800px 接管工作区，在 600px 接管全屏` | context panel 在 desktop/mobile breakpoints 接管正确区域，无横溢出且可返回 | SurfaceShell + Context panel owner | **PASS**：800/600 bounds and ownership 通过 | 已迁并验证 |
| 21 | `legend-production-admission.spec.js:4` — `Production Virtuoso adapter keeps the reading anchor when a mounted row below the viewport grows 28px` | 真实 mounted row 在 viewport 下方增长；浏览位置/anchor 不跳，仍 browsing、无 blank | VendorListExecutor + canonical reading owner + row renderer | **PASS**：anchor drift、connected row、mode and visible content 通过 | 已迁并验证 |
| 22 | `live-tail-entry.spec.js:131` — `live tail entry is one interruptible layout transaction, never replayed as history` | single/batch/continuous live arrivals 都是普通 live row；wheel 后 browsing、semantic IDs 唯一，不应 history replay | ConversationSurface live arrival path + presentation row owner | **PASS**：row IDs unique、following transaction、historyStarts=0；不再把 offscreen DOM node recycling 当失败 | 已迁 current semantic identity |
| 23 | `live-tail-entry.spec.js:131` — `browsing and inactive-channel arrivals become ordinary content after takeover` | browsing 时 arrival 形成 jump/ordinary row；inactive channel 回返后只恢复目标 channel rows，不串账 | Live arrival receipts + ReadingIntent + WorkspaceApp channel handoff | **REGRESSION**：在第一公共边界 browsing arrival row count=0、jump=false；测试保留该最小失败，不用跳过后续 inactive-channel合同 | 保留红测，交 live-tail/reading owner |
| 24 | `live-tail-entry.spec.js:323` — `reduced motion installs the live row directly at final layout` | reduced-motion 用户收到 live row 时直接落 final layout，不残留 transition/blank | ConversationSurface live row + accessibility motion boundary | **PASS**：row visible，`data-live-entry-transition=running` count=0 | 已迁并验证 |
| 25 | `member-filter-timeline.spec.js:39` — `opaque member filter keeps a whole historical turn across roster and human incarnations` | stale actor incarnation 出现时 filter 仍保留完整 historical turn；清除 stale 后选 canonical steward，PONG 语义不丢 | useTimelinePreferences + ConversationSurface actor filter + ChannelReplica | **PASS**：schema3 view-session、stale removal、selected actor、historical turn/PONG 通过 | 已迁 current filter owner |
| 26 | `member-filter-timeline.spec.js:75` — `full AppShell shows one real agent chip without a bare zero and filters installed rows on its first frame` | 当前 AppShell 首帧显示一个真实 Agent chip；选中/清除 actor filter 后 installed rows 与 heading 正确 | WorkspaceApp + roster projection + ConversationSurface | **PASS**：real chip、selected/cleared rows and first-frame semantics 通过 | 已迁并验证 |
| 27 | `mobile-ux-isolation.spec.js:143` — `mobile keyboard-size, rotation, Waiting/Composer hit targets, and touch takeover remain isolated` | mobile touch/keyboard resize/rotation 后 Waiting 与 Composer 分区、hit target/focus 可用；触摸滚动 takeover 不串 owner | SurfaceShell + ConversationSurface + WaitingLayer + Composer | **PASS**：viewport geometry、touch takeover、hit target、list identity/overflow 通过 | 已迁并验证 |
| 28 | `model-selector-manual.spec.js:5` — `手动挡下点一次模型选择器：只取数一次，数据到达后面板自己展开` | 选择 steward 后一次真实 click 读取 capability；面板自动打开且应提供 `模型` option；键鼠 focus/role 保持 | Composer `ModelSelector` + `FloatingPortal`; current dialog is `.model-selector-menu[role=dialog]` | **REGRESSION**：真实 dialog 可见并已 attach trigger/panel/error evidence，但没有 `menuitem 模型`；不是旧 role selector 误报 | 保留红测，交 agent.options/ModelSelector owner |
| 29 | `model-selector-manual.spec.js:35` — `面板已开时手动刷新：值域短暂缺席也不关面板，回来后仍可选` | reopen/refresh 期间 panel 不丢、模型 option 可选、focus/keyboard ownership 保持 | Composer ModelSelector dialog + capability probe | **REGRESSION**：dialog 能打开，但当前 `view.configurable=false`，仍无 `menuitem 模型`；attach 保留真实 panel text/errors | 保留红测，交 capability/probe owner |
| 30 | `model-selector-portal.spec.js:45` — `ModelSelector portal remains clickable at visual viewport 500px` | portal 脱离 composer scrollport，在 500px viewport 内可见、拥有 hit，模型/option click 后 focus 恢复 | Composer ModelSelector + FloatingPortal | **REGRESSION**：dialog bounds 在 viewport 内且 owns hit；随后 baseline `menuitem /模型/` 缺失，未跳过 option/focus 合同 | 保留红测，交 ModelSelector owner |
| 31 | `model-selector-portal.spec.js:45` — `ModelSelector portal remains clickable at visual viewport 320px` | 同上，320px 窄视口不能裁切 portal 或丢键盘/鼠标命中 | Composer ModelSelector + FloatingPortal | **REGRESSION**：panel top/bottom geometry 通过；缺少可选模型 menuitem，失败边界明确 | 保留红测，交 ModelSelector owner |
| 32 | `model-selector-portal.spec.js:45` — `ModelSelector portal remains clickable at visual viewport 200px` | 同上，200px 极窄视口仍需 portal 可达、option 可点、trigger focus restore | Composer ModelSelector + FloatingPortal | **REGRESSION**：panel geometry/center hit 通过；缺少模型 option，未伪造绿色 | 保留红测，交 ModelSelector owner |

## Product-regression packets

### History admission / underfill / jump / live browsing (cases 1, 2, 3, 8, 13, 23)

- Minimal reproduction: use the documented mock scenarios (`deep-history-delayed`,
  `mixed-height-history`, `long-running-history` as applicable), login through `/`, select the
  real actor/filter, and wheel the actual `.timeline-message-list`; for cases 13/23 publish a
  documented pulse/live row before the user gesture.
- Baseline capability: one canonical reading surface admits/prepends history or live rows,
  preserves the visible anchor and layout, changes `following/browsing` only on the user's
  trusted gesture, and acknowledges a mounted tail only after it is visible. No duplicate
  history replay, empty paint, or implementation-only writer is part of the user contract.
- Current behavior: history admission leaves the visible list at its baseline count; underfill
  omits `history 1`; reveal/wheel can paint an empty frame or remain `following`; jump/live
  browsing does not expose the expected jump/row. The current evidence captures visible rows,
  semantic presentation IDs, root geometry, mode, and writer samples before diagnostics.
- First public owner boundary: `WorkspaceApp` → feed runtime/history consumer →
  `ConversationSurface` → `VendorListExecutor`/canonical reading owner. No compatibility
  surface or source patch was added by this migration.
- Stale-fixture exclusion: selectors are current production heading/list/row contracts and
  current `data-presentation-row-id`; old private reveal tokens, old DOM node identity and
  old `data-request-id` are not gates.

### Channel activation / inactive feed handoff (case 5; case 23 is gated earlier by live arrival)

- Minimal reproduction: login through `/`, wheel or start live activity in `c0`, click the real
  `c0.project` channel item, then return to `c0`.
- Baseline capability: target heading/list mounts, old reveal/live rows do not replay into the
  target, and each channel restores only its own presentation rows.
- Current behavior: the final G–M run now passes the activation replacement case: destination
  heading/list and the c0 return are mounted without old-row replay. The separate live-tail case
  is red earlier, at its browsing-arrival row/jump contract, so it does not claim an inactive
  channel handoff failure in this freeze.
- First public owner boundary: `WorkspaceApp` channel handoff → `createChannelFeedRuntime` /
  `useWireSession` disconnect/connect ordering → `ConversationSurface` history owner.

### Model capability and portal (cases 28–32)

- Minimal reproduction: reset documented `actor-capability`, login through `/`, choose steward,
  click the current `.model-selector-trigger`, then inspect the real `FloatingPortal` at 500/320/
  200px viewport heights.
- Baseline capability: after one capability read, the panel stays open and exposes model and
  option menuitems outside the composer scrollport; pointer/keyboard hit ownership and trigger
  focus must survive selection and refresh.
- Current behavior: current `Composer.jsx` exposes a correctly positioned `role=dialog` named
  `steward Agent 状态`; it reports the current model as readonly and has no `menuitem 模型`.
  Geometry and hit evidence pass at all three heights, so the missing selectable capability is
  the first failing public boundary. This is not repaired by changing a role selector.
- First public owner boundary: `Composer` `ModelSelector` → `useComposerCommands.openAgentSelector`
  → current actor capability/probe projection. No product source was changed here.

## Boundary audit

- This partition edits only the G–M `tests/browser` specs and this `audit-output` report. No
  `src/`, vendor, package manifest, lockfile, or product implementation was changed by this
  partition.
- No baseline case or fixture was deleted; no `test.skip`, conditional skip, timeout-only
  green path, weakened geometry, or diagnostic-only replacement was introduced.
- Old private fixture/source fingerprints were removed only from the current test assertions
  where the production owner has a public equivalent; fixtures remain in the repository and
  no fixture file was rewritten. The same-turn request-id oracle was replaced by the current
  semantic presentation-row identity.
- Product regressions remain red and are handed to the owning App/Feed, reading/history, live
  tail, or ModelSelector owners. This report is the reproduction/ownership packet, not a
  product patch.
