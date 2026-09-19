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

## Case ledger

`owner` 是当前真实生产 owner；`result` 是本次 `7ba308c` + 现有脏工作树复核结果。每行保留了 baseline 的用户动作、可观察结果和架构不变量。

| # | Spec / exact case | User action → protected capability / invariant | Current owner / public entry | Result and evidence | Disposition |
|---:|---|---|---|---|---|
| 1 | `A-debug.spec.js:14` — `debug badge` | 登录后切 `c0.project`，尾部接收三次 live 到达；频道 surface、tail 与 rail 计数必须仍可观察 | App + Feed + Reading；频道 rail、`.timeline-message-list` | **PRODUCT GAP**：点击频道后 `main h1` 消失；浏览器记录 `feed.disconnectHistory owner 尚未连接` | 保留红测，交 App/Feed owner |
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
| 14 | `f3-message-fold.spec.js:28` — `用户展开长消息后，切频道返回与后续消息都保留选择` | 用户展开 → 切频道 → 返回 → append；当前 active surface 必须保留 explicit fold choice | WorkspaceApp channel handoff + Presentation/FoldableBody | **PRODUCT GAP**：已改为检查 `main h1` 与 active layer，切换后空白；`feed.disconnectHistory owner 尚未连接` | 保留红测，交 App/Feed owner |
| 15 | `f6-accessibility-responsive.spec.js:15` — `F6-003 1280/800/600/320 与 200% 等价视口没有页面横向溢出` | 多宽度/窄屏触控 target 与 channel-list focus 可用，无横溢出 | SurfaceShell + responsive ConversationSurface | **PASS**：宽度、44px target、打开/关闭频道列表及 focus 均通过 | 未改，当前 owner 验证 |
| 16 | `f6-accessibility-responsive.spec.js:41` — `F6-004 主视图支持方向键，Modal 隔离背景并恢复焦点` | ArrowRight 切 tab；全局搜索 modal 将背景 surfaces `aria-hidden`/`inert`，Escape 恢复 opener focus | SurfaceShell + `useModalFocus` | **PASS**：改断言 current sibling surfaces（`main`）而非 shell parent；focus restore 通过 | 已迁 implementation boundary |
| 17 | `f6-accessibility-responsive.spec.js:64` — `F6-004 reduced motion 停止持续动画` | reduced-motion 下 busy animation 必须停止/单次完成 | Surface tokens / accessibility media query | **PASS**：duration 与 iteration 符合 | 未改，当前 owner 验证 |
| 18 | `f7-channel-notifications.spec.js:34` — `F7 inactive-channel business and core progress never create rail or new-dynamic counts` | inactive channel 的 provisional/dense progress 不得伪造 rail 或动态数；点击后仍可进入目标频道 | Feed + Notification policy + App handoff | **PRODUCT GAP**：点击 `c0.project` 后 `main h1` 消失；同一 `feed.disconnectHistory owner 尚未连接` | 保留红测，交 App/Feed owner |
| 19 | `f7-channel-notifications.spec.js:64` — `F7 channel rail exposes live Agent timers across channels and clears on completion` | c0 长任务在切到 project 后 rail timer 仍可见，完成后清除 | Notification rail + Feed/Workspace handoff | **PRODUCT GAP**：启动 timer 成功，切频道后 home timer 变 0 | 保留红测，交 Notify/App owner |
| 20 | `f7-channel-notifications.spec.js:82` — `F7 server boot change cannot leave a zombie Agent timer` | reset/drop/reconnect 后旧 generation 的 timer 必须清零 | Notification policy + wire generation | **PASS**：重启/drop 后 OPEN，timer=0 | 已迁入口 |
| 21 | `f7-channel-notifications.spec.js:96` — `F7 unresolved history after a same-boot reload stays quiet until fresh live progress` | reload 不得把未解析历史伪造为 live timer；新 live progress 才恢复 | Notification policy + high-water | **PASS**：reload quiet，advance 后 timer=1 | 已迁入口 |
| 22 | `f7-channel-notifications.spec.js:112` — `F7 completion during a same-boot disconnect clears the live timer` | disconnect 期间完成，reconnect 后 timer 必须清零 | Wire generation + Notification policy | **PASS**：reconnecting→open，timer=0 | 已迁入口 |
| 23 | `f7-terminal.spec.js:29` — `F7-001 打开终端分屏：消息与终端同时可见，页面无错` | 点击终端真实入口后 xterm 与消息 region 同时可见且无 runtime error | TerminalFeature + SurfaceShell | **PASS** | 已迁验证 |
| 24 | `f7-terminal.spec.js:40` — `F7-002 桌面端消息区与终端左右各占一半` | 分屏两 region 左右相邻且宽度相等 | TerminalFeature layout owner | **PASS** | 未改，current layout 验证 |
| 25 | `f7-terminal.spec.js:51` — `F7-003 收起再打开：消息恢复全宽` | 终端 toggle 后消息恢复全宽，再开仍可见 | TerminalFeature toggle | **PASS** | 未改 |
| 26 | `f7-terminal.spec.js:66` — `F7-004 终端配色可切换` | 通过当前可访问 action name 切换 dark→light | TerminalFeature theme state | **PASS**：使用 current name `切到浅色`，light 生效 | 已迁 selector |
| 27 | `f8-terminal-session.spec.js:64` — `F8-001 两个频道各开终端：恒只有一条 WS，来回切各看各的屏` | 两频道分别输入 marker，切换往返保持各自 screen，peak/live PTY WS≤1 | TerminalFeature + PTY session owner | **PRODUCT GAP**：切到第二频道后 screen 为空，`MARK_ONE` 未出现；同时伴随 channel feed owner error | 未改 case，交 Terminal/App/Feed owner |
| 28 | `f8-terminal-session.spec.js:90` — `F8-003 刷新整页再打开，接回同一个 shell 且屏幕还在` | reload 后重新打开 terminal，shell/screen marker 必须复原 | PTY session replay/attach | **PASS** | 未改 |
| 29 | `fold-collapse-anchor.spec.js:242` — `收起：视口中部（clamp 不成立），读者点下的控件不得超出 clamp 预算` | 在真实 scroller 中部展开/收起；控件位置按 shrink/clamp 物理预算稳定 | Presentation/FoldableBody + reading scroll owner | **PRODUCT GAP**：anchor drift `845.72px`，allowed `0`，scrollTop 8579→7599，height 9912→8086 | 保留红测，交 Reading/Presentation owner |
| 30 | `fold-collapse-anchor.spec.js:242` — `收起：靠近视口顶部（下方余量少，允许 clamp），读者点下的控件不得超出 clamp 预算` | 真实滚轮把控件置近顶部；允许的 clamp 外不得跳动 | Presentation/FoldableBody + root scroller | **PRODUCT GAP**：anchor drift `674.72px`，allowed `0`，same 1826px shrink | 保留红测，交 Reading/Presentation owner |
| 31 | `fold-collapse-anchor.spec.js:292` — `角色转移导致的自动折叠，不得移动正在阅读的内容` | following tail 上 latest long entry 应展开；用户上滑后新 live 到达转移 role 时，历史阅读锚点不动 | Presentation authority + browsing fold lease | **PRODUCT GAP**：真实 root/history 已 loaded、`bottomReady=true`、mode=`following`，但 latest `H-ROLE-6` 初始 `aria-expanded=false`，不满足 baseline latest-role 前置条件 | 保留红测；不是改 fixture/skip，交 Presentation owner |

## Product-regression packets

### Channel handoff / owner disconnect (cases 1, 14, 18, 19, 27)

- Minimal reproduction: reset `multi-channel`/`deep-history`/`long-running`; login through `/`; perform the normal channel-item click (or start a long task, then click the other channel).
- Baseline capability: authenticated App remains mounted; target `main h1` and active `.timeline-message-list` appear; rail timers and per-channel terminal screen survive handoff.
- Current behavior: active surface disappears or loses its content. Browser/Vite reports `feed.disconnectHistory owner 尚未连接`; F8 second terminal screen remains empty and F7 home timer disappears.
- First public boundary: `WorkspaceApp` channel handoff invokes Feed history disconnect through `useWireSession` before the destination history owner is connected. No test-only API or source compatibility path was added.
- Stale-fixture exclusion: all cases use current `/` login, current channel navigation, current portal model selector where needed, and assert the active heading/list rather than an outgoing DOM node. The mock only supplies the documented scenario/control endpoints.

### Fold anchor geometry (cases 29–30)

- Minimal reproduction: reset `deep-history`; send six real long messages through the current composer/model-selector; use the real `.timeline-message-list` wheel to materialize and place a fold toggle; click it while sampling every rAF.
- Baseline invariant: shrink above the clicked control requires `desired = scrollTop_before - shrink`; when that point is in range, the control stays within 8px and never leaves materialization.
- Current evidence: mid viewport `beforeTop=344.72`, `shrink=1826`, `desired=6753`, settled `scrollTop=7599`, anchor top `-501` (`drift=845.72`); near-top drift `674.72`. `vanished=false`, so this is not a selector/virtualization miss.
- First public owner: Presentation/FoldableBody geometry and the current root reading owner; no product source change made.

### Latest-role precondition (case 31)

- Minimal reproduction: same real deep-history composer flow, six completed long turns, then reveal `H-ROLE-6` in the current list.
- Current evidence: history is loaded and attached, `presentationRevision=86`, `bottomReady=true`, `mode=following`, `rows=26`; the latest row is mounted and visible but its fold toggle is `aria-expanded=false` instead of the baseline current-entry default `true`.
- First public owner: `conversation-presentation` current-entry authority → `TimelineRowRenderer`/`FoldableBody`; no old fixture or private helper is used.

## Boundary audit

- No `src/` file, vendor package, package manifest, lockfile, or compatibility API changed in this partition.
- No case, fixture, import, or selector file was deleted. Expired selector assumptions were replaced with current public actions; optional old carrier evidence remains observational only.
- Product gaps are intentionally left red and handed to the owning agent; this report is the handoff packet, not a product patch.
