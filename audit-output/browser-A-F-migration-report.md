# Browser A–F migration ledger

基线：`fae8b70`；复核 head：`7ba308c`（复核使用现有脏工作树；本分区未改 product source）。范围是当前 `tests/browser` 中 basename A–F 的 13 个 spec、31 个 Playwright case；fixtures `content-focus.{html,jsx}` 与 `content-selection.{html,jsx}` 均保留并继续由真实 fixture URL 使用。

## Aggregate

| 项目 | 数量 |
|---|---:|
| 已读 spec / case | 13 / 31 |
| 已迁 spec / case（真实入口/owner 已核对并改写） | 8 / 17 |
| 未改 spec / case（仍逐 case 执行，非删除） | 5 / 14 |
| 当前通过 | 23 |
| 当前产品缺口 | 8 |
| skipped / deleted | 0 / 0 |
| fixture 删除或改写 | 0 / 0 |

执行命令（独立 mock/web ports）：

```text
ATOLL_TEST_MOCK_PORT=19853 ATOLL_TEST_WEB_PORT=15193 npx playwright test \
  tests/browser/A-debug.spec.js tests/browser/channel-feed-publication-loop.spec.js \
  tests/browser/content-focus.spec.js tests/browser/content-selection.spec.js \
  tests/browser/e-send-clamp-attribution.spec.js tests/browser/e-send-scroll-writers.spec.js \
  tests/browser/e-send-second-displacement.spec.js tests/browser/f3-message-fold.spec.js \
  tests/browser/f6-accessibility-responsive.spec.js tests/browser/f7-channel-notifications.spec.js \
  tests/browser/f7-terminal.spec.js tests/browser/f8-terminal-session.spec.js \
  tests/browser/fold-collapse-anchor.spec.js --reporter=line
```

结果（`7ba308c` + 复核时已有脏工作树）：`23 passed, 8 failed (4.4m)`。失败 case 身份与此前 ledger 一致；失败没有 skip 或放宽行为/几何断言。

可比性声明（续派）：当前工作树的 `HEAD` 已推进到 `51c7888`，且仍有
`src/model/channel-feed-runtime.js`、browser/unit tests 与 audit artifacts 的脏变更。
它不是上面的 `7ba308c` 冻结复核面，因此本次没有把当前树的任何结果计入
31-case aggregate，也没有宣称 8 个失败已回归或修复；下文的 `23/8` 只属于
`7ba308c` + 当时既有脏工作树这一历史快照。

## Case ledger

`owner` 是当前真实生产 owner；`result` 是本次 `7ba308c` + 现有脏工作树复核结果。每行保留了 baseline 的用户动作、可观察结果和架构不变量。

| # | Spec / exact case | User action → protected capability / invariant | Current owner / public entry | Result and evidence | Disposition |
|---:|---|---|---|---|---|
| 1 | `A-debug.spec.js:14` — `debug badge` | 登录后切 `c0.project`，尾部接收三次 live 到达；频道 surface、tail 与 rail 计数必须仍可观察 | `WorkspaceApp`/`useChannelNavigation` → `useWireSession`/Feed history public surface | **PRODUCT GAP**：点击频道后、注入 live 到达前 `main h1` 已消失；浏览器记录 `feed.disconnectHistory owner 尚未连接` | 保留红测，交 Workspace/Feed handoff owner |
| 2 | `channel-feed-publication-loop.spec.js:4` — `channel feed publication keeps the authenticated App mounted` | 登录、认证导航与 OPEN 状态必须持续；publication 不得触发 React 更新深度错误 | App / Feed public surface | **PASS**：navigation、OPEN 可见；无 `Maximum update depth` | 已迁/验证 |
| 3 | `content-focus.spec.js:8` — `folded content keeps visible text selectable and removes only clipped controls from Tab order` | 折叠正文仍可选；隐藏控件从 Tab 顺序及可访问性树中移出；展开后恢复 | ContentPlan + `FoldableBody` fixture | **PASS**：selection、Tab、Enter、`tabindex`/`aria-hidden` 均符合 | 未改，当前 fixture 验证 |
| 4 | `content-focus.spec.js:36` — `Mermaid source toggle keeps the same focused button node in both modes` | 键盘切换图表/源码时 focus 与 button identity 不丢 | ContentPlan/Markdown fixture | **PASS**：两次 Enter 后同一节点仍 focused，label 正确 | 未改，当前 fixture 验证 |
| 5 | `content-selection.spec.js:8` — `content plan preserves a real native selection in unchanged blocks during stream and prefix updates` | stream/prefix 更新不能破坏 unchanged block 的真实 selection 或 clipboard | ContentPlan native selection fixture | **PASS**：selection、block identity、anchor connection 与 clipboard 均正确 | 未改，当前 fixture 验证 |
| 6 | `content-selection.spec.js:25` — `content bookmark resolves the surviving passage after a local edit and width reflow` | 局部编辑及宽度 reflow 后 bookmark 必须回到同一语义 passage/offset | ContentPlan bookmark fixture | **PASS**：id/context match，offset 17，suffix `target` | 未改，当前 fixture 验证 |
| 7 | `e-send-clamp-attribution.spec.js:494` — `following send leaves the list at the tail` | following 状态发送后回到物理尾部；每个可见位移须有 current reading owner write | Reading owner + root `.timeline-message-list` | **PASS**：gap ≤24；至少一段位移；task sample 无无 writer 位移 | 已迁；旧 carrier 仅留可选证据，不作 gate |
| 8 | `e-send-clamp-attribution.spec.js:532` — `reduced motion still settles through the current reading owner` | reduced-motion 用户发送仍能落到尾部，不依赖过期 input-resize 细节 | Reading owner | **PASS**：gap ≤24 | 已迁；替换 implementation-only 名称 |
| 9 | `e-send-clamp-attribution.spec.js:549` — `the unwritten move has a layout and a forcer on record` | layout witness 必须观察真实 root geometry，并证明负位移有 writer 记录 | Root scroller geometry witness | **PASS**：root armed、reads >100；unwritten negative moves = 0 | 已迁；carrier 不存在时仍测真实 root |
| 10 | `e-send-clamp-attribution.spec.js:621` — `preventScroll focus removes native focus scrolling` | 禁止 native focus scroll 后发送仍落尾；不把 focus side effect 当 reading owner | Reading owner + focus boundary | **PASS**：gap ≤24 | 已迁 |
| 11 | `e-send-scroll-writers.spec.js:217` — `following send settles the list at the tail with recorded writes` | following send 的尾部结果与 write ownership 正确；不要求旧的固定写入次数 | Reading owner / root scroller | **PASS**：gap ≤24、位移 run ≥1；每次 movement frame 的 write count 增长 | 已迁；移除 stale exact-one oracle |
| 12 | `e-send-scroll-writers.spec.js:274` — `browsing send hands off to the following owner with recorded writes` | 用户滚轮离开尾部后发送，必须 handoff 到 following 并落尾 | ReadingIntent + ConversationSurface | **PASS**：mode=`following`、root write、run、gap ≤24；私有 intent/issuer 名称只记录不 gate | 已迁 |
| 13 | `e-send-second-displacement.spec.js:158` — `following send: the second move has a cause on record` | 发送后记录 scroll event、geometry 与 writer，最终仍在尾部 | Reading owner / geometry witness | **PASS**：final gap ≤24，保留 move/write evidence | 已迁入口 |
| 14 | `f3-message-fold.spec.js:28` — `用户展开长消息后，切频道返回与后续消息都保留选择` | 用户展开 → 切频道 → 返回 → append；当前 active surface 必须保留 explicit fold choice | `WorkspaceApp`/`useChannelNavigation` → Feed handoff（fold continuity 是后续 Presentation owner） | **PRODUCT GAP**：切到 project 后在 fold-return 断言前 `main h1` 与 active layer 已空白；`feed.disconnectHistory owner 尚未连接` | 保留红测，先交 Workspace/Feed handoff owner |
| 15 | `f6-accessibility-responsive.spec.js:15` — `F6-003 1280/800/600/320 与 200% 等价视口没有页面横向溢出` | 多宽度/窄屏触控 target 与 channel-list focus 可用，无横溢出 | SurfaceShell + responsive ConversationSurface | **PASS**：宽度、44px target、打开/关闭频道列表及 focus 均通过 | 未改，当前 owner 验证 |
| 16 | `f6-accessibility-responsive.spec.js:41` — `F6-004 主视图支持方向键，Modal 隔离背景并恢复焦点` | ArrowRight 切 tab；全局搜索 modal 将背景 surfaces `aria-hidden`/`inert`，Escape 恢复 opener focus | SurfaceShell + `useModalFocus` | **PASS**：改断言 current sibling surfaces（`main`）而非 shell parent；focus restore 通过 | 已迁 implementation boundary |
| 17 | `f6-accessibility-responsive.spec.js:64` — `F6-004 reduced motion 停止持续动画` | reduced-motion 下 busy animation 必须停止/单次完成 | Surface tokens / accessibility media query | **PASS**：duration 与 iteration 符合 | 未改，当前 owner 验证 |
| 18 | `f7-channel-notifications.spec.js:34` — `F7 inactive-channel business and core progress never create rail or new-dynamic counts` | inactive channel 的 provisional/dense progress 不得伪造 rail 或动态数；点击后仍可进入目标频道 | 预点击计数是 `notification-policy`；首个失败边界是 `WorkspaceApp`/`useChannelNavigation` → Feed handoff | **PRODUCT GAP**：`unread-related`/`unread-total` 仍为 0，随后点击 `c0.project` 时 `main h1` 消失；记录 `feed.disconnectHistory owner 尚未连接`。因此不是 notification-policy 计数误报 | 保留红测，先交 Workspace/Feed handoff owner |
| 19 | `f7-channel-notifications.spec.js:64` — `F7 channel rail exposes live Agent timers across channels and clears on completion` | c0 长任务在切到 project 后 rail timer 仍可见，完成后清除 | `channel-feed-runtime.agentActivitySnapshot` → `WorkspaceLayout.WorkspaceRail`；不是 unread `notification-policy` owner | **PRODUCT GAP**：长任务启动后 home `.channel-agent-timer` 为 1，切到 project 后用于证明跨频道可见性的 home timer 立即变为 0；尚未到 return/complete 断言。timer 是 activity projection 的 live entry，不是 rail unread/new-dynamic 计数 | 保留红测，交 Feed activity/WorkspaceRail owner |
| 20 | `f7-channel-notifications.spec.js:82` — `F7 server boot change cannot leave a zombie Agent timer` | reset/drop/reconnect 后旧 generation 的 timer 必须清零 | Notification policy + wire generation | **PASS**：重启/drop 后 OPEN，timer=0 | 已迁入口 |
| 21 | `f7-channel-notifications.spec.js:96` — `F7 unresolved history after a same-boot reload stays quiet until fresh live progress` | reload 不得把未解析历史伪造为 live timer；新 live progress 才恢复 | Notification policy + high-water | **PASS**：reload quiet，advance 后 timer=1 | 已迁入口 |
| 22 | `f7-channel-notifications.spec.js:112` — `F7 completion during a same-boot disconnect clears the live timer` | disconnect 期间完成，reconnect 后 timer 必须清零 | Wire generation + Notification policy | **PASS**：reconnecting→open，timer=0 | 已迁入口 |
| 23 | `f7-terminal.spec.js:29` — `F7-001 打开终端分屏：消息与终端同时可见，页面无错` | 点击终端真实入口后 xterm 与消息 region 同时可见且无 runtime error | TerminalFeature + SurfaceShell | **PASS** | 已迁验证 |
| 24 | `f7-terminal.spec.js:40` — `F7-002 桌面端消息区与终端左右各占一半` | 分屏两 region 左右相邻且宽度相等 | TerminalFeature layout owner | **PASS** | 未改，current layout 验证 |
| 25 | `f7-terminal.spec.js:51` — `F7-003 收起再打开：消息恢复全宽` | 终端 toggle 后消息恢复全宽，再开仍可见 | TerminalFeature toggle | **PASS** | 未改 |
| 26 | `f7-terminal.spec.js:66` — `F7-004 终端配色可切换` | 通过当前可访问 action name 切换 dark→light | TerminalFeature theme state | **PASS**：使用 current name `切到浅色`，light 生效 | 已迁 selector |
| 27 | `f8-terminal-session.spec.js:64` — `F8-001 两个频道各开终端：恒只有一条 WS，来回切各看各的屏` | 两频道分别输入 marker，切换往返保持各自 screen，peak/live PTY WS≤1 | 首个边界是 `useChannelNavigation` 的 committed target identity → `WorkspaceLayout`/ConversationSurface；TerminalFeature/PTY 是未到达的下游 owner | **PRODUCT GAP**：切到第二频道后在 `MARK_ONE`/PTY WS 断言前 `main h1` 与 screen 为空；同时伴随 channel feed owner error。因此不能把该次失败归因到 PTY 会话算法 | 未改 case，先交 Workspace handoff owner |
| 28 | `f8-terminal-session.spec.js:90` — `F8-003 刷新整页再打开，接回同一个 shell 且屏幕还在` | reload 后重新打开 terminal，shell/screen marker 必须复原 | PTY session replay/attach | **PASS** | 未改 |
| 29 | `fold-collapse-anchor.spec.js:242` — `收起：视口中部（clamp 不成立），读者点下的控件不得超出 clamp 预算` | 在真实 scroller 中部展开/收起；控件位置按 shrink/clamp 物理预算稳定 | `ConversationSurface` reading owner 读写边界 + `TimelineRowRenderer`/`FoldableBody` collapse geometry | **PRODUCT GAP**：anchor drift `845.72px`，allowed `0`，scrollTop 8579→7599，height 9912→8086；`vanished=false`，故不是 selector/virtualization miss | 保留红测，交 Reading/Presentation owner |
| 30 | `fold-collapse-anchor.spec.js:242` — `收起：靠近视口顶部（下方余量少，允许 clamp），读者点下的控件不得超出 clamp 预算` | 真实滚轮把控件置近顶部；允许的 clamp 外不得跳动 | `ConversationSurface` root reading owner + `TimelineRowRenderer`/`FoldableBody` collapse geometry | **PRODUCT GAP**：anchor drift `674.72px`，allowed `0`，same 1826px shrink；near-top 也没有发生允许的 clamp，而是超预算漂移 | 保留红测，交 Reading/Presentation owner |
| 31 | `fold-collapse-anchor.spec.js:292` — `角色转移导致的自动折叠，不得移动正在阅读的内容` | following tail 上 latest long entry 应展开；用户上滑后新 live 到达转移 role 时，历史阅读锚点不动 | `conversation-presentation` current-entry authority → `TimelineRowRenderer`/`FoldableBody` | **PRODUCT GAP**：真实 root/history 已 loaded、`bottomReady=true`、mode=`following`、latest row 已 mounted，但 `H-ROLE-6` 初始 `aria-expanded=false`；在 role-transition/anchor pulse 前就未满足 baseline precondition | 保留红测；不是改 fixture/skip，交 Presentation current-entry owner |

## Product-regression packets (eight historical red cases)

以下每条都沿用真实 `/` 登录、当前 channel navigation，以及现有公开 composer/model
selector；没有增加 test-only API，也没有把 selector 或几何阈值改成“等价”。`status`
均是上面 `7ba308c` 快照的历史状态，当前 `51c7888` 脏树不计数。

### #1 — `A-debug.spec.js:14` (`debug badge`)

- Minimal reproduction: reset `deep-history` seed `5703`; login; click `c0.project` and
  require its `main h1`; this already fails before the three dense-progress arrivals, which
  are the subsequent tail/rail part of the baseline flow.
- Baseline/current: the authenticated App, destination `main h1`, active
  `.timeline-message-list`, tail and rail remain observable; historical current run loses
  `main h1` immediately on the click, before any live arrival is injected.
- First public owner: `WorkspaceApp`/`useChannelNavigation` committed handoff and its
  `useWireSession` → Feed history attach/disconnect boundary. The debug badge and live
  arrival are not the first failing boundary.
- Evidence/status: browser/Vite recorded `feed.disconnectHistory owner 尚未连接`; keep
  red as product gap, no current-tree count.

### #14 — `f3-message-fold.spec.js:28` (fold choice across channel return)

- Minimal reproduction: reset `deep-history` seed `1314`; login; choose steward through
  the current Agent menu; send the long marker; expand it; click `c0.project`, then return
  to `c0` and append the follow-up.
- Baseline/current: the explicit fold choice must survive the channel round trip and the
  later append; historical run cannot reach the fold-return assertion because the target
  surface has no `main h1`/active list after the first click.
- First public owner: the Workspace/Feed channel handoff that must commit destination
  identity and connect history before Presentation/FoldableBody continuity is exercised.
- Evidence/status: same `feed.disconnectHistory owner 尚未连接` boundary; keep red and do
  not classify it as a fold-state regression until handoff is restored.

### #18 — `f7-channel-notifications.spec.js:34` (inactive-channel counts)

- Minimal reproduction: reset `multi-channel` seed `2620`; login; inject provisional ×20
  and dense-progress ×40 for inactive `c0.project`; assert `.unread-related` and
  `.unread-total` stay zero; then click `c0.project`.
- Baseline/current: inactive business/core progress must neither create rail/new-dynamic
  counts nor block entering the channel; the count assertions pass in the historical run,
  then destination `main h1` disappears on click.
- First public owner: `notification-policy` owns the already-passing pre-click count
  classification; the first failing public boundary is `WorkspaceApp`/
  `useChannelNavigation` → Feed handoff. This is not a notification-policy count bug.
- Evidence/status: `feed.disconnectHistory owner 尚未连接`; keep red as the handoff gap,
  with no current-tree count.

### #19 — `f7-channel-notifications.spec.js:64` (live Agent timer across channels)

- Minimal reproduction: reset `long-running` seed `2610`; login; start the long task in
  `c0` through the current Agent selector; assert home `.channel-agent-timer` is 1; click
  `c0.project` and immediately require that same home timer to remain 1 (the historical
  failure occurs before the return-home/completion steps).
- Baseline/current: the live Agent timer must remain visible for its originating channel
  while another channel is active, then clear on completion; historical run starts with
  timer 1 but is already 0 at the cross-channel assertion immediately after switching.
- First public owner: `channel-feed-runtime.agentActivitySnapshot` →
  `WorkspaceLayout.WorkspaceRail` (`.channel-agent-timer`). This is the activity live-entry
  projection, not the unread/new-dynamic `notification-policy` owner; any upstream handoff
  loss is evidence for this activity continuity boundary.
- Evidence/status: timer is present before navigation and absent afterward; keep red as
  Feed activity/WorkspaceRail product gap, with no current-tree count.

### #27 — `f8-terminal-session.spec.js:64` (two-channel terminal sessions)

- Minimal reproduction: login; in `c0` open the real terminal and echo `MARK_ZERO`; click
  `c0.project`; require destination heading and open its terminal to echo `MARK_ONE`; switch
  three times and then inspect marker persistence and peak/live PTY WS counts.
- Baseline/current: each channel's terminal screen must persist with at most one live PTY
  socket; historical run fails at destination `main h1`/screen before `MARK_ONE` or any
  PTY ownership assertion executes.
- First public owner: `useChannelNavigation` committed target identity →
  `WorkspaceLayout`/ConversationSurface handoff. TerminalFeature/PTY is downstream and was
  not reached, so this run must not be assigned to terminal session replay.
- Evidence/status: destination surface is empty and channel Feed owner error is recorded;
  keep red as Workspace handoff gap, no current-tree count.

### #29 — `fold-collapse-anchor.spec.js:242` (mid-viewport collapse)

- Minimal reproduction: reset `deep-history` seed `20260918`; send six real long turns via
  the current composer/model selector; use the real list wheel at ratio `.5`; expand the
  revealed fold; click collapse while sampling each rAF.
- Baseline/current: with no clamp, the clicked control's post-collapse position must be
  preserved by `desired = scrollTop_before - shrink`; historical evidence is
  `beforeTop=344.72`, `shrink=1826`, `desired=6753`, settled `scrollTop=7599`,
  `drift=845.72px`, allowed `0`, height `9912→8086`.
- First public owner: `ConversationSurface` root reading owner plus
  `TimelineRowRenderer`/`FoldableBody` collapse geometry. `vanished=false` proves the
  failure is not a selector miss or virtualized-row absence.
- Evidence/status: keep the geometry red and hand to Reading/Presentation owner; no
  current-tree count.

### #30 — `fold-collapse-anchor.spec.js:242` (near-top collapse)

- Minimal reproduction: repeat the same six-turn setup, use the real list wheel at ratio
  `.15` to place the control near the viewport top, then collapse while sampling each rAF.
- Baseline/current: clamp may account only for the physically unavailable lower range;
  historical evidence still drifts beyond budget: `beforeTop=173.72`, `shrink=1826`,
  `desired=6924`, settled `scrollTop=7599`, `drift=674.72px`, allowed `0`.
- First public owner: the same root reading owner and `FoldableBody` collapse geometry;
  the near-top setup is a distinct reproduction, not a selector or fixture substitution.
- Evidence/status: keep red as Reading/Presentation product gap, no current-tree count.

### #31 — `fold-collapse-anchor.spec.js:292` (latest-role precondition)

- Minimal reproduction: reset `deep-history` seed `20260918`; complete six real long turns
  (`H-ROLE-1`…`H-ROLE-6`); reveal `H-ROLE-6` in the current list and require its baseline
  expanded state before starting the browsing/role-transition sequence.
- Baseline/current: latest entry must begin expanded before a role transition can be
  judged for preserving the reader's anchor; historical evidence has history attached,
  `presentationRevision=86`, `bottomReady=true`, `mode=following`, `rows=26`, and a
  mounted visible latest row, but `H-ROLE-6` starts `aria-expanded=false`.
- First public owner: `conversation-presentation` current-entry authority →
  `TimelineRowRenderer`/`FoldableBody`. The role-transition geometry oracle is not reached;
  this is a current-entry precondition gap, not proof that the root reading owner moved it.
- Evidence/status: keep red without fixture/skip/threshold changes and hand to Presentation
  current-entry owner, no current-tree count.

## Shell-reset follow-up (non-counted diagnostic)

在 `431a287` 的 shell/feed persistence reset 之后，曾以 product HEAD
`6c880aa`（后续只推进了 test/audit commits，至 `6060588`，未再改变 product
source）定向跑 8 个历史红测：`4 passed / 4 failed`。通过的是 #14、#18、#19、#27，
说明先前的 Workspace/Feed handoff、inactive notification entry、跨频道 activity
timer 与 terminal handoff 已越过原首断点；这轮不替换冻结 `7ba308c` 的 `23/8`
aggregate。

- #1 的目标 `main h1=c0.project`、active list 和 rail 已出现，原 handoff 首断点已
  越过；失败落在旧 debug logging 对缺失 `.unread-related` 调用 `textContent()`，
  不是产品行为断言。`tests/browser/A-debug.spec.js` 只把这项诊断读取改成不等待
  缺失节点的 `allTextContents()`，不改变任何 product assertion。
- #29/#30 仍是物理折叠红测：mid `845.72px`、near-top `674.72px`，均
  `allowed=0`，`vanished=false`；等待 Reading fold owner 提交后再复验。
- #31 的最小 owner 包：reset `deep-history` seed `20260918` → 六个真实长回合
  `H-ROLE-1`…`H-ROLE-6` → 用当前 list reveal latest row → 在任何 pulse/role
  transition 前断言 latest fold toggle `aria-expanded=true`。当前首断点是该值为
  `false`，同时 history attached、`presentationRevision=86`、`bottomReady=true`、
  `mode=following`、latest mounted；因此首个公开 owner 是
  `conversation-presentation` current-entry authority → `TimelineRowRenderer`/
  `FoldableBody`，尚未进入 Reading anchor 或 role-transition 几何判定。

### 第九轮前置：#29/#30 第5行→第4行最小对照矩阵（只读，HEAD `05b1fff`）

以下证据来自当前共享工位的真实 Chromium trace；这是给 `reading_tail_owner` 的
首断点包，不计入冻结 `7ba308c` 的 `23/8` aggregate，也没有改 product 或断言。
`data-content-revision` 是 DOM 已提交的 presentation content revision；render
revision 中的 `true/false` 位对应折叠展开状态。

| case | 对照行（第5行，已完成采样） | 第5行状态/paint | 第4行展开卸载首断点 | 点击前/后 mounted IDs |
| --- | --- | --- | --- | --- |
| #29 mid | row `aa28d78e-52c2-47a0-bc4a-b197a4c758ea`，fold `…:body`，content `885:79` | `false → true → false`；`top 344.72 → 345.19`（约 `+0.47px`）；collapse 后 `scrollTop=6753`、`scrollHeight=8087` | row `af497a3f-34eb-4755-9d2f-33ab892ee0dc`，content `878:72`；初始 `aria-expanded=false`，点击后 row 从 DOM/mounted 集合卸载，未观察到 `true` paint，断在 line 257 | 第4行 click 前仅 `af497a3f…`；click 后 frame snapshot 无 `data-presentation-row-id`（随后断言等待该 toggle） |
| #30 near-top | row `f8ec99ff-3103-4751-aa8f-d1e7d371ef5e`，fold `…:body`，content `885:79` | `false → true → false`；`top 173.72 → 174.19`（约 `+0.47px`）；collapse 后 `scrollTop=6924`、`scrollHeight=8087` | row `c2a30544-fd7a-4a8f-a3a1-5a333ba88a2e`，content `878:72`；初始 `aria-expanded=false`，点击后同样卸载，未观察到 `true` paint，断在 line 257 | 第4行 click 前仅 `c2a30544…`；click 后 frame snapshot 无 `data-presentation-row-id` |

第5行 collapse 后再 reveal 第4行之前，#29 的 mounted 集合为
`40411436-5b69-48d3-a1e1-161b66af55ac` /
`af497a3f-34eb-4755-9d2f-33ab892ee0dc` /
`aa28d78e-52c2-47a0-bc4a-b197a4c758ea` /
`afa7da6d-4c90-4439-803e-93d6e2729a81` /
`30dfc613-06b7-4a6e-b06f-d755b93e120b`（row3–7），#30 为
`1798f2a5-602e-4c94-929d-44cf5455667b` /
`c2a30544-fd7a-4a8f-a3a1-5a333ba88a2e` /
`f8ec99ff-3103-4751-aa8f-d1e7d371ef5e` /
`8d526980-c5aa-450f-86dd-4b8485ad4d52` /
`637070e6-b531-43a6-8399-ee3d9ad9029a`（row3–7）。
两案均在 `revealRow` 后只剩第4行；点击展开导致列表滚动/重物化，目标 row 在
`aria-expanded=true` 断言前消失。这是 materialization/presentation handoff，
不是 selector 变化冒充等价。

### 第九轮前置：#31 current-entry authority 矩阵（只读）

`H-ROLE-6` 的 mounted row 为 `b8c99bd6-ccb8-42de-93b5-32ea79323eb2`，content
revision `892:86`，render revision 的 latest/fold 位为 false，
`data-presentation-state=handoff-enter`，timeline/reading mode 均为 `following`，
composer owner 为 `current`，request type 为 `agent.ask`。该 row 的 fold toggle
连续 24 次解析均为 `aria-expanded=false`；因此 `currentEntryAuthority` 未把
candidate 传成 `latestRowID`，`TimelineRowRenderer/FoldableBody` 未获得 latest
豁免，pulse/anchor geometry 尚未执行。首个公开 owner 交
`reading_tail_owner`（`conversation-presentation current-entry authority`）。

## Boundary audit

- No `src/` file, vendor package, package manifest, lockfile, or compatibility API changed in this partition.
- No case, fixture, import, or selector file was deleted. Expired selector assumptions were replaced with current public actions; optional old carrier evidence remains observational only.
- Product gaps are intentionally left red and handed to the owning agent; this report is the handoff packet, not a product patch.
