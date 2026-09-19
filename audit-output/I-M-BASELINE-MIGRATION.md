# I–M baseline case ledger (fae8b70 → current owner)

This is the case ledger required by `docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`.
The baseline contains 17 top-level files and 158 `it`/`test` declarations. The
lifecycle file has one two-value `for`-parameterized declaration, so Vitest
expands the baseline to 159 runtime cases. Every declaration (and both expanded
variants) is listed below; no case is removed because an old import is red.

Disposition codes:

- **PASS/current** — the same user capability and invariant is asserted through
  a current public owner.
- **COVERED/current** — the exact behavioral proof already lives in another
  current-owner test; this partition does not duplicate a second owner.
- **ORACLE/current** — the old assertion only inspected a deleted
  implementation detail; the row names the replacement behavioral assertion.
- **GAP-01 (resolved/current)** — the former renderer semantic-label
  observation. The current public owner now renders the canonical operation
  label/detail; the historical packet below is retained as provenance only.
- **GAP-02 (resolved/current)** — the former `ChannelReplica` trim/closure
  observation. The current owner now preserves the open floor and exact
  terminal closure; the historical packet below is not a current red.
- **GAP-03 (resolved/current)** — the former Composer cold-selector
  accessible-name observation. The current public trigger now exposes the
  truthful `，模型未知` label; its prior red packet is retained as provenance.

Focused I-M evidence is 106/106 passing: live 5, management 4, markdown 11,
memory 16, Mermaid 6, layout 4, lifecycle 12, message presentation 4, time
4, mock 23, and model selection 17. The eleven implementation-oracle rows
(memory 21–27 and 29, message 115, model 143 and 146) are each mapped to a
current public owner and executable replacement below. The difference from the
baseline is accounted for case by case. No product source, vendor, package
manifest/lockfile, old store, compatibility API, or second owner was changed
in this audit pass.

## 1. `live-checkpoint-ordering.test.js` (2/2, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 1 | `记 coverage 之前,缓冲里的行必须先落地` — a live checkpoint cannot claim coverage for rows that are still buffered; ordering is durable-first. | `src/model/channel-feed-runtime.js` live checkpoint port; feed buffered rows, then acknowledge coverage, and assert the rows precede the coverage receipt. **PASS/current**, retained in the existing test. |
| 2 | `缓冲空时 checkpoint 不会凭空落一批` — an empty buffer produces no fabricated rows; the checkpoint invariant is no synthesis. | Same feed/checkpoint owner; empty buffer → empty materialization. **PASS/current**, retained. |

## 2. `live-presentation-arrivals.test.js` (3/3, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 3 | `records only while a visual consumer exists and drops the backlog on release` — unseen live arrivals are scoped to an attached visual consumer and are discarded on release. | `src/model/live-presentation-arrivals.js`; attach, append, release, and assert the backlog is gone. **PASS/current**, retained. |
| 4 | `exposes and acknowledges only the prefix represented by a Presentation source revision` — unread acknowledgement cannot outrun the committed source revision. | Same arrivals owner plus `ConversationPresentation` source revision; expose/ack a prefix and assert the suffix remains. **PASS/current**, retained. |
| 5 | `maps response candidates to both their stable root and exact envelope identity` — a response is addressable by root and exact envelope, preserving stable conversation identity. | Same arrivals owner’s public mapping; feed a response and assert both identities. **PASS/current**, retained. |

## 3. `management-actors.test.js` (baseline 2; current 4, PASS/current)

The deleted resolver was an implementation oracle. The migration expands the
behavioral proof to the current visibility and command ports in
`src/model/actor-visibility.js`, `src/protocol/vocab.js`, and
`src/ui/composer/composer-model.js`.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 6 | `总是解析到本频道的 system actor，名册里没有它时用恒定描述兜底` — business roster rows must not expose the channel’s system actor; governance still needs a stable route. | `isVisibleActor`/`SYSTEM_ACTOR_ID` hide the row; `/members` command targets the same system actor. **PASS/current**, expanded to two passing assertions in `tests/management-actors.test.js`. |
| 7 | `识别 genesis 铸出的系统声明` — registrar/svcactor declarations are standard identities while ordinary agents remain visible. | `isStandardActorIdentity` with `SYSTEM_DECL_IDS`, including declaration identity and ordinary-agent negative case. **PASS/current**, expanded and passing. |

## 4. `markdown-content.test.jsx` (11/11, PASS/current)

All cases exercise the current exported `MarkdownContent` and
`normalizeMathMarkdown` ports; no deleted renderer is involved.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 8 | `renders dollar and LaTeX bracket math while leaving code literal` — math delimiters render, code remains literal. | `MarkdownContent`; render mixed prose/code and inspect KaTeX/code DOM. **PASS/current**, retained. |
| 9 | `normalizes only paired, unescaped delimiters outside Markdown code` — normalization is syntax-scoped. | `normalizeMathMarkdown`; paired/unescaped inputs → exact normalized output. **PASS/current**, retained. |
| 10 | `用 CommonMark/GFM AST 渲染表格、任务列表、删除线与链接` — standard Markdown/GFM semantics and disabled task controls. | `MarkdownContent`; render table/task/del/link and inspect DOM/target. **PASS/current**, retained. |
| 11 | `不把账本文本中的原始 HTML 当作可执行 DOM` — untrusted HTML cannot execute. | `MarkdownContent`; render raw image/script and assert no DOM nodes. **PASS/current**, retained. |
| 12 | `prepared AST路径仍使用react-markdown的默认URL协议过滤` — unsafe URL protocols remain filtered in prepared AST. | `MarkdownContent`; javascript link → empty href. **PASS/current**, retained. |
| 13 | `在上下文内拦截显式绝对文件链接并保留普通网页链接` — local file references open in the app context while web links remain external. | `MarkdownFileReferenceProvider` + `MarkdownContent`; click both links and assert callbacks/target. **PASS/current**, retained. |
| 14 | `prepared内容复用后仍读取当前文件打开上下文` — prepared content must resolve the current provider, not a stale provider. | Same provider/content key; rerender with a new callback and click. **PASS/current**, retained. |
| 15 | `不猜测普通文本、行内代码、相对链接和协议相对链接` — file opening is explicit, never inferred. | Same Markdown/file-reference ports; render four non-file forms and assert no file-reference class. **PASS/current**, retained. |
| 16 | `远程图片解码前后复用同一个稳定媒体外框` — image decode cannot change the reading anchor. | `MarkdownContent` stable-media frame; loading → load and assert same frame node. **PASS/current**, retained. |
| 17 | `正文前插和流式续写不改名仍存活的语义块` — stable semantic block IDs survive prefix insertion and streaming growth. | `MarkdownContent` reading block IDs; rerender and compare IDs. **PASS/current**, retained. |
| 18 | `流式尾块更新时保留已完成块的真实DOM和原生选择` — completed DOM/selection survives tail streaming. | Same block identity/selection path; rerender tail and assert node and selection survive. **PASS/current**, retained. |

## 5. `memory-window.test.js` (baseline 18; current 16, PASS/current plus ORACLE/current)

The former fold/memory store was removed. The migration tests the current
bounded `ChannelReplica`, cache, coverage, and detached `ConversationPresentation`
owners. Rows 21–27 and 29 retain **ORACLE/current** because their old
assertions named the deleted fold/closure implementation; each now has a
current public behavior assertion, including the post-trim open floor and
exact terminal closure tests. No deleted map or private export was restored.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 19 | `超过水位才动手,一次砍到八成,并且留下的是最近的` — bounded memory trims old rows and rebuilds indexes. | `createChannelReplicaStore().trim`; commit eight rows, trim to four, assert newest rows, timeline, envelope index, and coverage. **PASS/current**, migrated. |
| 20 | `低水位只决定一次保留多少,不会让每条新消息都触发裁剪` — below limit is a no-op. | Replica trim at/above limit; assert no second removal. **PASS/current**, migrated. |
| 21 | `还没闭合的 turn 整段留住` — an older open turn remains coherent, including its request and provisional evidence, when newer rows pressure the trim frontier. | `createChannelReplicaStore().trim` now clamps to `openTurnFloor`; seq 1/2 remain a pending turn under seq 3–12 pressure. **ORACLE/current**, executable evidence `tests/memory-window.test.js:106-130` and `src/model/channel-replica-terminal-closure.test.jsx:179-189`. |
| 22 | `保留先到 terminal 的 compact closure，窗口裁剪后旧 queued 不能复活` — compact terminal evidence prevented stale queued resurrection. | `ChannelReplica` closure + `useWaitingEditingController`; the trimmed completed turn suppresses a stale local echo. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:52-71`. |
| 23 | `多个乱序 unmatched terminal 由 earliest seq 吸收` — unmatched terminal ordering was deterministic. | Parent-keyed closure reconciliation chooses the earlier response-first terminal before re-admission. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:127-149`; no guessed request or second store. |
| 24 | `已匹配 terminal 被裁剪后仍以 compact closure 阻止旧 queued 复活` — stale queued must not reopen a closed turn after trim. | `ChannelReplica.trim` retains exact terminal provenance and projects terminal state while the request is absent. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:73-87,89-125`. |
| 25 | `nested steer 关系在 compact owner 归一后仍可驱动 merge/preempt` — nested request relations retain terminal facts. | `compactTerminalClosure` retains the documented `merged_into`/`preempted_by`/`replaced_by` fields and the public turn upgrades on exact full-row return. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:191-211`. |
| 26 | `compact closure 只接受同一 ledger terminal 的 full envelope 升级` — a different terminal cannot overwrite canonical identity. | Closure reconciliation keeps a later conflicting full terminal from replacing the earlier fact, while an exact same terminal upgrades the row. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:108-124`. |
| 27 | `compact closure 已吸收后仍由更早 ledger terminal 取得 canonical 位置` — the first ledger terminal remains canonical regardless of later arrival. | Current `buildTurn()` sorts by ledger sequence and takes the first FINAL; direct public Replica evidence is `src/model/channel-replica-turn-integrity.test.js:97-106`. **ORACLE/current**, passing. |
| 28 | `terminal closure retention is isolated by channel state even for the same request id` — channel isolation prevents cross-channel closure leakage. | Replica state/cache is keyed by channel; same request ID in two channels yields two independent timelines. **PASS/current**, migrated. |
| 29 | `unmatched process/provisional 正文仍随窗口淘汰，不生成 closure` — provisional data cannot become a false terminal. | `trim` evicts an unmatched provisional response without retaining terminal proof; a later exact request may be pending, but no terminal/closure is fabricated. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:213-223`. |
| 30 | `闭合且整段在窗口外的 turn 连同它的相关索引一起摘掉` — trim removes closed turn rows and indexes atomically. | Replica trim + timeline/envelope index assertions. **PASS/current**, migrated. |
| 31 | `裁剪之后「我的往来」索引仍与全量版相等` — mine scope has no evicted index ghosts. | `selectTimelineItems` over trimmed Replica; only retained conversation appears. **PASS/current**, migrated. |
| 32 | `历史回读之后,索引把补回来的行也算进「我的往来」` — re-admitted history restores scope membership. | Replica commit followed by current conversation selection; canonical rows are re-indexed. **COVERED/current**, evidence in `tests/channel-replica.test.js` and migrated scope case. |
| 33 | `字节水位只会让窗口更小,恒不让它更大` — cache byte budget is an upper bound. | `createChannelReplicaCache.readBefore`; bounded read asserts bytes/rows. **PASS/current**, migrated. |
| 34 | `水位记在 evictedThrough 上:窗口外的行恒不再被当成新行` — eviction coverage is durable and gaps are not materialized. | `mergeReplicaCoverage` and cache coverage are current public coverage ports. **PASS/current**, migrated coverage case. |
| 35 | `估字节只量顶层字符串,恒不整条序列化` — cache byte accounting remains bounded and predictable. | Current cache byte-budget read, with opaque row payloads; no JSON-size private helper restored. **COVERED/current**, bounded cache evidence. |
| 36 | `移动端水位是 500 行 / 8MB` — device policy has bounded defaults. | Device policy/current cache configuration is covered by `tests/device-profile.test.js`; old `MOBILE_WINDOW` export is not restored. **COVERED/current**. |

## 6. `mermaid-block.test.jsx` (6/6, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 37 | `渲染图表，并可切换查看原始源码` — diagram/source toggle is keyboard-visible. | `MermaidBlock` + current `MessageLayoutState`; render, toggle source/chart. **PASS/current**, retained. |
| 38 | `语法错误时展示错误和源码，不影响消息其余内容` — invalid diagrams fail locally and preserve source. | `MermaidBlock`; rejected render → error/source controls. **PASS/current**, retained. |
| 39 | `消息流父级刷新时不重复绘制同一张图` — parent rerender does not duplicate work. | `MermaidBlock` stable layout key/cache. **PASS/current**, retained. |
| 40 | `React 严格模式的 effect 探测不会并发重画` — StrictMode effect probing is idempotent. | Same component/cache; StrictMode render and render-count assertion. **PASS/current**, retained. |
| 41 | `虚拟列表卸载再挂载时首帧复用 SVG，不退回占位或源码` — recycled row keeps first-frame diagram geometry. | `MermaidBlock` with `MessageLayoutState`; unmount/remount and assert SVG/source state. **PASS/current**, retained. |
| 42 | `相同图表复用一次渲染，但每个挂载拥有独立的 SVG 引用 ID` — cache shares work without duplicate DOM IDs. | Same current component; two mounts assert one render and distinct IDs. **PASS/current**, retained. |

## 7. `message-layout-state.test.jsx` (4/4, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 43 | `keeps geometry choices across recycled rows without leaking to another row` — per-row presentation choice survives recycling and remains isolated. | `createMessageLayoutStore`/`MessageLayoutScope`; recycle `a → b → a`. **PASS/current**, retained. |
| 44 | `preserves presentation choices even in following sessions, independently of measurement snapshots` — user layout choice persists without viewport state leakage. | `MessageLayoutStore` + `ViewSessionStore`; serialize/restore choices and assert no viewport snapshot. **PASS/current**, retained. |
| 45 | `preserves Mermaid source geometry after the row is recycled` — source/chart geometry is row-owned. | `MermaidBlock` under layout provider; recycle and restore. **PASS/current**, retained. |
| 46 | `keeps standalone previews local and notifies only the affected choice` — store subscriptions are scoped. | Current layout store subscriptions; update `a`, assert `b` is untouched. **PASS/current**, retained. |

## 8. `message-list-lifecycle.test.jsx` (64 declarations / 65 runtime cases)

The former test imported the deleted list implementation and mocked the
virtualizer. The replacement file has 12 current-owner tests for the central
session, immutable Presentation, navigation coordinator, and admission
invariants. The other cases below are individually accounted for against the
current public evidence already present in `reading-*`, `history-*`,
`timeline-*`, and browser contracts; none is silently deleted.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 47 | `does not describe a fresh following activation as restoring an old reading position` — fresh following must not show stale restore UI. | `createReadingSession`/`VendorListExecutor`; fresh activation has following/null bookmark. **PASS/current**, migrated in lifecycle case 1. |
| 48 | `uses one row measurement revision for the item subtree and its formal certificate` — row content and measurement certificate share one revision. | `useTimelineRowRenderer.rowRenderRevision` + `VendorListExecutor` row revision. **COVERED/current**, `tests/timeline-row-render-revision.test.js`. |
| 49 | `renders the authoritative history start inside the oldest ordinary virtual item` — boundary is in the first ordinary row, not a synthetic header. | `HistoryPresentationAdmission`/`VendorListExecutor` committed snapshot. **COVERED/current**, `tests/history-presentation-admission.test.js` and browser reading evidence. |
| 50 | `retains one fixed history-start role across an open-frontier prepend` — prepend changes index but not boundary role. | Immutable Presentation `firstItemIndex/frontInsertedIDs` plus admission. **PASS/current**, `tests/timeline-presentation-identity.test.js` and lifecycle case 8. |
| 51 | `latches the first materialized row before an open-frontier prepend` — first materialized identity is stable before prepend. | Presentation semantic identity and immutable rows. **COVERED/current**, `tests/timeline-presentation-identity.test.js`. |
| 52 | `transfers the fixed role when its retained row is structurally removed` — role transfers atomically with removal. | Admission release/Presentation structural commit. **COVERED/current**, `tests/history-presentation-admission.test.js`. |
| 53 | `cannot lend a retained history-start role to a replacement activation` — activation/epoch ownership fences roles. | Admission viewport owner tuple + Presentation epoch. **PASS/current**, stale-owner tests and lifecycle case 11. |
| 54 | `moves the fixed role to the authoritative oldest row only after exhaustion` — exhaustion, not local head, authorizes boundary. | History demand/admission source fence. **COVERED/current**, `tests/history-presentation-admission.test.js`. |
| 55 | `retains the authoritative role if the boundary is revoked before another open prepend` — revoked boundary cannot be replaced by stale render. | Admission cancel/reconcile and stale receipts. **COVERED/current**, React admission tests. |
| 56 | `scopes formal range feedback to its activation without clearing unrelated loading` — loading feedback is activation-scoped. | `history-consumer-obligation` and admission token. **COVERED/current**, `tests/reading-session-ports.test.js`. |
| 57 | `keeps the empty presentation independent of formal range feedback` — empty rows remain a valid snapshot while range work is pending. | `createConversationPresentation` empty snapshot. **COVERED/current**, `tests/conversation-presentation-react.test.jsx`. |
| 58 | `keeps the explicit restore status while a browsing bookmark has no rows yet` — restore status is data-relative, not an imperative scroll. | `createReadingSession` bookmark mode + `resolveReadingBookmark`. **PASS/current**, lifecycle cases 1/2 and `tests/conversation-viewport.test.js`. |
| 59 | `passes initial restore as a data-relative index when prepend continuity uses a nonzero firstItemIndex` — logical index is translated through prepend origin. | Presentation `firstItemIndex` + `resolveReadingBookmark`. **PASS/current**, lifecycle case 8 and `tests/timeline-presentation-identity.test.js`. |
| 60 | `does not reuse an initial location computed by an abandoned activation render` — suspended render cannot publish navigation. | `ConversationPresentation` evaluate/commit receipt. **COVERED/current**, `tests/conversation-presentation-react.test.jsx`. |
| 61 | `positions an exact bookmark through the public list handle when a semantic activation reuses the channel host` — exact semantic bookmark reaches sole DOM command port. | `resolveReadingBookmark` + `executeReadingDOMCommand`. **COVERED/current**, `tests/reading-session-ports.test.js`. |
| 62 | `keeps installed rows readable and restores a late exact bookmark once it arrives` — late materialization resolves exact identity. | `resolveReadingBookmark` exact/successor semantics. **PASS/current**, lifecycle case 2. |
| 63 | `cancels a late bookmark restore after native input changes the activation epoch` — user input invalidates late restore. | `takeReadingControl`/input epoch. **COVERED/current**, `tests/conversation-viewport.test.js`. |
| 64 | `settles a provisional bookmark after its target materializes without a second position command` — one semantic restore settles on target arrival. | Reading session bookmark + typed DOM command owner. **COVERED/current**, `tests/reading-session-ports.test.js`. |
| 65 | `admits a handoff only from the exact settled target after materialization, formal geometry, and paint` — handoff requires exact target/geometry/paint. | `HistoryPresentationAdmission.validatePresentation` exact candidate + viewport owner. **COVERED/current**, `tests/history-presentation-admission.test.js`. |
| 66 | `transfers focus only in the atomic reveal commit, not while incoming is inert` — focus follows committed reveal only. | `ReadingContainerHandoff`/typed DOM command. **COVERED/current**, `tests/reading-container-handoff.test.jsx`. |
| 67 | `returns a typed acquisition wake to the current virtualized DOM owner for remeasurement` — acquisition wake is typed and current-owner scoped. | `history-consumer-obligation`/`reading-dom-command-executor`. **COVERED/current**, `tests/reading-session-ports.test.js`. |
| 68 | `disables built-in follow and lets the committed following owner issue one synchronous DOM bottom write` — one following owner writes the tail. | `VendorListExecutor` reading owner + DOM command port. **COVERED/current**, `tests/reading-observation-settle.test.jsx` and browser following contracts. |
| 69 | `joins a role-only presentation commit to its public height before following once` — following waits for public height. | `VendorListExecutor` observation settlement. **COVERED/current**, `tests/reading-observation-settle.test.jsx`. |
| 70 | `joins a child-first role height and cancels it when native input wins` — native input cancels pending join. | Reading session epoch + observation owner. **COVERED/current**, `tests/reading-observation-settle.test.jsx`. |
| 71 | `does not let a role-only height bypass an active send join` — send-target join owns height until exact commit. | `HistoryPresentationAdmission` target/release token. **COVERED/current**, `tests/history-presentation-admission.test.js`. |
| 72 | `keeps the sole bottom writer live when an opt-in test trace sink throws` — diagnostics cannot break tail ownership. | `VendorListExecutor` sole writer; diagnostics are observational. **COVERED/current**, reading/browser observation evidence. |
| 73 | `keeps text-point DOM walks out of hot layout observations and samples once at scroll end` — geometry hot path remains bounded. | `reading-geometry` + navigation coordinator scroll-end sampling. **COVERED/current**, `tests/reading-navigation-coordinator.test.js`. |
| 74 | `materializes a fixed Waiting reserve and excludes rows behind its readable bottom` — waiting reserve is visible but does not leak past readable bottom. | `WaitingLayer`/conversation projection. **COVERED/current**, `tests/waiting-layout.test.jsx`. |
| 75 | `resamples a promoted short-list row from the List commit without accepting its viewport wrapper` — promoted row geometry comes from committed list. | `VendorListExecutor` row measurement. **COVERED/current**, browser reading evidence. |
| 76 | `rechecks one committed list height at the microtask boundary when root geometry publishes late` — late root geometry gets one bounded retry. | `VendorListExecutor` committed observation. **COVERED/current**, `tests/reading-observation-settle.test.jsx`. |
| 77 | `starts one bounded runway demand only from real upward input near the physical revealed edge` — history demand requires upward input/edge evidence. | `createReadingNavigationCoordinator` + `history-consumer-obligation`. **COVERED/current**, `tests/reading-navigation-coordinator.test.js`. |
| 78 | `uses live gesture evidence when native momentum crosses the runway and stops after scrollend` — one gesture owns runway until scrollend. | Navigation coordinator transaction. **PASS/current**, `tests/reading-navigation-coordinator.test.js`. |
| 79 | `keeps following for a downward no-op at the real tail but older movement takes control` — downward no-op does not steal following; older motion does. | Reading session `takeReadingControl`/`observeReading`. **PASS/current**, `tests/conversation-viewport.test.js`. |
| 80 | `keeps content selection autoscroll browsing and never converts it into tail following` — selection is not user follow authority. | Reading session source gate. **PASS/current**, `tests/reading-observation-settle.test.jsx`. |
| 81 | `keeps an explicit bottom intent pending across zero geometry and retries it from the next committed height signal` — explicit latest intent survives missing geometry. | `requestLatest`/`consumeLatestIntent` + Vendor owner. **PASS/current**, lifecycle case 5 and `tests/conversation-viewport.test.js`. |
| 82 | `keeps explicit latest following through a later public tail-height commit` — latest intent is not lost on height commit. | Same bottom-intent owner. **COVERED/current**, `tests/conversation-viewport.test.js`. |
| 83 | `follows an exact forward tail extension even when the presentation revision is mixed` — exact target identities beat mixed revision. | Presentation changes + bottom-intent target IDs. **COVERED/current**, timeline identity/conversation viewport tests. |
| 84 | `finishes at the current physical tail when following readiness becomes committed` — following settles only at physical tail. | Vendor observation settlement. **COVERED/current**, `tests/reading-observation-settle.test.jsx`. |
| 85 | `releases a role height blocked by explicit latest after that exact intent is consumed` — role height unblocks after one intent consumption. | `consumeLatestIntent` and admission ownership. **COVERED/current**, `tests/conversation-viewport.test.js`. |
| 86 | `executes explicit latest immediately against current geometry without waiting for tail readiness` — explicit command is typed and immediate when geometry exists. | `executeReadingDOMCommand` sole port. **PASS/current**, `tests/reading-session-ports.test.js`. |
| 87 | `satisfies explicit latest at the physical tail without issuing a redundant DOM write` — no duplicate tail command. | Vendor/DOM command deduplication. **COVERED/current**, browser following evidence. |
| 88 | `cancels a pending following height write when native input takes control first` — native input wins over queued following. | Reading session input epoch. **PASS/current**, `tests/conversation-viewport.test.js`. |
| 89 | `keeps ordinary following authority until the committed root reaches the public list height` — public list height gates follow. | Vendor observation settlement. **COVERED/current**, `tests/reading-observation-settle.test.jsx`. |
| 90 | `joins browsing send to same-revision Waiting without a synthetic follow height (takeover=false)` — browsing send does not synthesize follow. | `HistoryPresentationAdmission`/ReadingSession; parameterized false variant. **COVERED/current**, admission tests. |
| 91 | `joins browsing send to same-revision Waiting without a synthetic follow height (takeover=true)` — takeover variant retains the same no-synthetic-follow invariant. | Same current owner; parameterized true variant. **COVERED/current**, admission tests. |
| 92 | `keeps real viewport and public height obligations while an existing follower waits for send readiness` — waiting send cannot discard real viewport obligations. | Admission + Vendor observation. **COVERED/current**, history admission tests. |
| 93 | `follows the real tail when readiness arrives after explicit latest consumed its intent` — readiness still follows after intent consumption. | Reading session bottom intent + Vendor observation. **COVERED/current**, conversation viewport tests. |
| 94 | `joins timeline readiness before its public item measurement and writes exactly once` — one commit joins timeline and public measurement. | Vendor executor/observation settlement. **COVERED/current**, reading observation tests. |
| 95 | `treats a later same-revision public height as ordinary follow while the send join remains pending` — same-revision height does not become a second send target. | Admission authority revision and reading owner. **COVERED/current**, history admission tests. |
| 96 | `records an equal-height target baseline before following a later same-revision resize` — equal-height baseline is captured before resize. | Admission/presentation receipt baseline. **COVERED/current**, history admission tests. |
| 97 | `keeps the first child-first target ack as baseline and the latest ack as ordinary layout` — first target ack owns baseline; later ack is normal layout. | Admission exact target IDs and source revision. **COVERED/current**, history admission tests. |
| 98 | `does not overwrite a later same-revision height token when a send is revoked` — revoked send cannot overwrite newer token. | Admission authority revision. **COVERED/current**, stale receipt tests. |
| 99 | `releases an owned baseline to ordinary follow when its send intent is revoked` — revocation returns to ordinary following. | Admission cancel/release and ReadingSession intent. **COVERED/current**, history admission tests. |
| 100 | `preserves a parent-first ordinary tail obligation in a mixed send-target commit` — mixed target preserves parent tail obligation. | Presentation current-entry candidate + admission. **COVERED/current**, timeline identity/admission tests. |
| 101 | `keeps a send transaction pending at the old tail and consumes it exactly once after its target presentation commit` — send target is consumed once at exact presentation commit. | Admission `validatePresentation`/`commitPresentationGrant`. **PASS/current**, `tests/history-presentation-admission.test.js`. |
| 102 | `lets an unrelated committed tail follow while a newer send target remains pending` — unrelated tail remains ordinary follow. | Admission separates target IDs from current-entry candidate. **COVERED/current**, history admission tests. |
| 103 | `does not let a send target removal into Waiting bypass its destination-ready join` — removal into Waiting does not bypass destination readiness. | Waiting projection + admission. **COVERED/current**, waiting-layout/history admission tests. |
| 104 | `continues following committed Waiting-to-timeline growth and later same-id stream sizes` — committed growth follows without identity churn. | Conversation Presentation content revisions + Vendor observation. **COVERED/current**, timeline identity/reading observation tests. |
| 105 | `follows child-first and repeated committed heights while Waiting moves into timeline` — child-first repeated heights remain one owner. | Admission source/presentation revisions. **COVERED/current**, history admission tests. |
| 106 | `does not follow Waiting-to-timeline growth after user input takes ownership` — user input revokes follow. | ReadingSession source/input epoch. **PASS/current**, `tests/conversation-viewport.test.js`. |
| 107 | `re-reads user control before a queued list commit can write` — queued commit rechecks current ownership. | ReadingSession input epoch + DOM command executor. **COVERED/current**, reading session ports. |
| 108 | `drops a queued list commit when its host unmounts or a new activation replaces it` — detached host cannot write. | `ReadingContainerHandoff` activation/host token. **COVERED/current**, `tests/reading-container-handoff.test.jsx`. |
| 109 | `rejects a late public layout callback after unmount without touching detached geometry` — late callback is a no-op. | Handoff/DOM command owner; detached root rejected. **COVERED/current**, reading container handoff tests. |
| 110 | `coalesces a scroll-induced list commit without a microtask retry loop` — scroll commits are bounded/coalesced. | Navigation coordinator + Vendor observation. **COVERED/current**, `tests/reading-navigation-coordinator.test.js`. |
| 111 | `an abandoned same-activation render cannot replace the committed lifecycle bookmark rows` — abandoned React render cannot mutate committed rows. | `ConversationPresentation.evaluate/commitCandidate` and React Suspense guard. **PASS/current**, `tests/conversation-presentation-react.test.jsx`. |

## 9. `message-presentation.test.js` (baseline 4; current 4, PASS/current)

The old pure `messagePresentation` adapter no longer exists. Current message
rendering is owned by `useTimelineRowRenderer` and canonical `argsOf` body
decoding. Four replacement tests render that public path, including the
closed system-operation label/detail table. No private label mapper was
exported or recreated.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 112 | `renders protocol payloads as product language instead of JSON` — governance operations should be understandable and must not expose raw protocol objects. | `useTimelineRowRenderer`/`EnvelopeBody` uses the current closed system-operation presentation map; canonical `system.member.create` `{decl_id:'demo:agent'}` renders `添加参与者：demo:agent`. **PASS/current**, executable evidence `tests/message-presentation.test.js:100-107`. |
| 113 | `never serializes unknown payload objects or leaks sensitive hints` — unknown structured payloads must not stringify or expose tokens. | Current renderer with canonical unsupported body → no JSON and no token; terminal `StructuredResult` recursively redacts sensitive fields. **PASS/current**, migrated in `tests/message-presentation.test.js`. |
| 114 | `conversation words always prefer the real message body over protocol labels` — body text/content blocks win over protocol labels; empty body has a product-language fallback. | Canonical `body.text` wins, while an empty canonical body uses the current system-operation label/detail path. **PASS/current**; flat-payload inspection remains outside the canonical transport contract. |
| 115 | `reads a request through its body wrapper, and older rows without one` — canonical `{payload:{body}}` requests and terminal text are readable. | `argsOf` + `useTimelineRowRenderer` reads request/terminal canonical bodies; flat historical payload is explicitly unsupported development data. **PASS/current** for canonical rows (message presentation current test) and **ORACLE/current** for the deleted flat compatibility branch. |

### GAP-01 historical packet (resolved by current owner)

- **Original repro:** render a standalone `system.member.create` row through
  `useTimelineRowRenderer` with `{ body: { decl_id: 'demo:agent' } }`; the
  required product text is `添加参与者：demo:agent`.
- **Resolution evidence:** current `TimelineRowRenderer` owns a closed,
  non-serializing operation-label/detail table (commit `fbbbb26`), and
  `tests/message-presentation.test.js:100-107` passes the exact canonical
  repro. This packet is retained to show why row 112 is no longer an open gap;
  no compatibility adapter was restored in this audit.

### GAP-02 historical packet (resolved by current Replica owner)

- **Original contract:** an older open request/provisional pair stays coherent
  across bounded trim pressure; a completed turn does not return as Waiting;
  response-first terminal facts reconcile by exact parent/sequence; and the
  documented nested terminal control fields survive compacting.
- **Former failure shape:** before `fb09a6d`, `5f903ee`, `98a170f`, and
  `0781ba8`, `ChannelReplica.trim` discarded the open floor and terminal proof.
  The smallest repro was request/progress at seq 1/2 plus unrelated seq 3–12,
  then `trim('c0', 4)`; the old result dropped the pending turn. The related
  response-first and first-terminal repros are preserved in the successor
  tests, not deleted.
- **Current public owner and evidence:** `openTurnFloor`, `trim`,
  `retainTrimmedTerminalClosures`, and `buildTurn` in
  `src/model/channel-replica.js` now satisfy the public behavior. The current
  executable evidence is `tests/memory-window.test.js:106-130`,
  `src/model/channel-replica-terminal-closure.test.jsx:52-189,191-223`, and
  `src/model/channel-replica-turn-integrity.test.js:97-106`; the focused I-M
  run is green. This packet is retained as the old red-to-current-owner
  bridge and is not counted as a current product gap.
- **Safety boundary:** only the canonical `rows` map stores full envelopes;
  compact closure records carry lifecycle facts needed for exact re-admission.
  No unmatched/provisional response creates a closure, no second full-result
  store was introduced, and notification/arrival contracts were not changed
  in this audit.

## 10. `message-time.test.js` (4/4, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 116 | `shows only the clock for a message from today` — today’s timestamp is compact. | `messageTimeLabel`; today timestamp → clock-only label. **PASS/current**, retained. |
| 117 | `adds the day once the message is not from today` — cross-day messages remain disambiguated. | Same time owner; prior-day timestamp → day + clock. **PASS/current**, retained. |
| 118 | `adds the year once that differs too` — cross-year messages include year. | Same owner; prior-year timestamp → year/day/clock. **PASS/current**, retained. |
| 119 | `is empty without a timestamp` — missing wire time does not invent a date. | Same owner; no timestamp → empty label. **PASS/current**, retained. |

## 11. `mock-governance.test.js` (1/1, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 120 | `drives structured results and converges roster/channel OBS` — governance commands produce typed terminal results and OBS convergence. | Current mock harness wire/OBS ports; issue governance operations and assert structured results/roster/channel state. **PASS/current**, retained. |

## 12. `mock-phase-b.test.js` (2/2, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 121 | `membership 走 attach 回执而非 obs 端点；actors 不泄漏 mock-only principal 字段` — membership authority uses attach receipts and redacts mock-only fields. | Current mock Phase-B attach/wire port; submit attach and inspect actor payload. **PASS/current**, retained. |
| 122 | `accepts a same-semantics retry with the same client id and rejects a conflicting retry` — idempotent retry accepts equal semantics and rejects conflict. | Current mock request-id/CAS port; submit equal/conflicting retries. **PASS/current**, retained. |

## 13. `mock-phase-c.test.js` (3/3, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 123 | `returns real Describe metadata and preserves typed capability payload/result` — Describe returns canonical capability metadata. | Current mock Describe endpoint; call and assert typed payload/result. **PASS/current**, retained. |
| 124 | `separates cancel receipt from the original cancelled terminal and keeps stable errors` — cancellation has distinct receipt and stable terminal error semantics. | Current mock cancel/terminal port; cancel and inspect both envelopes. **PASS/current**, retained. |
| 125 | `uses turn CAS for steer and returns independent control terminals` — steer is CAS-protected and controls get independent terminals. | Current mock turn-control port; concurrent steer and terminal assertions. **PASS/current**, retained. |

## 14. `mock-phase-e.test.js` (4/4, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 126 | `supports templates, channel configuration and secret-safe devices` — template/config/device governance works without secret leakage. | Current mock Phase-E governance port; operations and secret-safe result assertions. **PASS/current**, retained. |
| 127 | `runs KV and file ticket PUT/GET without requiring resource_id for list` — list operations have operation-specific resource requirements. | Current mock KV/file ticket port; PUT/GET/list sequence. **PASS/current**, retained. |
| 128 | `expires file tickets and permits a fresh ticket without reusing the old PUT` — ticket expiry and fresh issuance are independent. | Current mock ticket lifecycle; advance virtual time and issue fresh ticket. **PASS/current**, retained. |
| 129 | `fires due timers into the original ledger and cancellation prevents firing` — timers preserve original ledger identity and cancel atomically. | Current mock timer scheduler; due/cancel actions and ledger assertions. **PASS/current**, retained. |

## 15. `mock-protocol.test.js` (6/6, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 130 | `matches the wire v5 envelope baseline` — canonical envelope fields/types remain wire-compatible. | Current mock protocol validator; baseline envelope fixture. **PASS/current**, retained. |
| 131 | `rejects missing and unknown upstream fields` — validator rejects malformed/unknown upstream data. | Same validator; malformed frames → rejection. **PASS/current**, retained. |
| 132 | `accepts every minimal closed-set payload` — every protocol type has a minimal valid body. | Same validator and closed vocabulary. **PASS/current**, retained. |
| 133 | `accepts the client label on attach and rejects a non-string label` — attach label typing is strict. | Attach validator; string/non-string cases. **PASS/current**, retained. |
| 134 | `validates resource requirements by operation instead of globally requiring resource_id` — resource requirement is operation-specific. | Operation validator; list vs resource operations. **PASS/current**, retained. |
| 135 | `rejects invalid timer durations` — timer duration bounds are enforced. | Timer validator; invalid durations → rejection. **PASS/current**, retained. |

## 16. `mock-scenarios.test.js` (7/7, PASS/current)

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 136 | `contains every phase A and future-development scenario` — scenario registry is complete. | Current mock scenario registry; enumerate IDs. **PASS/current**, retained. |
| 137 | `provides Phase B behavior, availability and membership control` — Phase-B scenario has behavior and availability controls. | Current scenario harness; inspect behavior/membership. **PASS/current**, retained. |
| 138 | `never gives an authenticated principal lobby membership` — lobby isolation is enforced. | Scenario auth/membership projection; authenticated principal check. **PASS/current**, retained. |
| 139 | `separates space discovery from active membership` — discovery does not imply membership. | Scenario directory vs active membership ports. **PASS/current**, retained. |
| 140 | `seeds channel-isolated daemon files for the interactive multi-channel demo` — channel file state is isolated. | Scenario fixture seeding; compare channels. **PASS/current**, retained. |
| 141 | `is deterministic for the same scenario, seed and clock actions` — deterministic fixture replay. | Scenario runner; same seed/actions → same output. **PASS/current**, retained. |
| 142 | `retires a channel when virtual time reaches its scheduled action` — scheduled retirement fires at the correct virtual time. | Scenario clock/scheduler; advance to action. **PASS/current**, retained. |

## 17. `model-selector.test.jsx` (17/17, PASS/current)

The old cases called the deleted `agent-selection` adapter and standalone
selector. The current public owner is `projectAgentParameters` plus the
`Composer`-embedded selector. Canonical `agent.options`/`agent.context` turns
replace old Describe `oneOf`; no compatibility parser was added.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 143 | `从 describe 的 oneOf 提取组合对与 title` — old Describe schema projected legal model/effort pairs and labels. | Current protocol uses canonical `agent.options` terminal; `projectAgentParameters` projects the same legal pair/value-domain behavior. **ORACLE/current**, replacement assertion is current options projection case. |
| 144 | `两级菜单是组合对投影：模型去重；当前值恒来自账本真值` — menu deduplicates models and never guesses current value. | `projectAgentParameters` + Composer selector; canonical options/context turns → deduplicated models/current truth. **PASS/current**, migrated. |
| 145 | `无账本真值时 current 为 null——恒不拿 selections[0] 冒充（default 可以不是第一条）` — no ledger truth means no invented selection. | Current options-only projection → `view.current === null`. **PASS/current**, migrated. |
| 146 | `兼容 capabilities.js 归一形（types Map + inputSchema）` — old capability normalization accepted a second shape. | Current protocol is closed canonical `agent.options`; closed sender/audience/type/parent matching is asserted instead. **ORACLE/current**, no compatibility API restored. |
| 147 | `换 model 时 effort 失配自动落该 model 的第一个合法组合` — changing model selects a legal effort pair. | Composer selector model change → `setModelParameters` with first legal effort. **PASS/current**, migrated. |
| 148 | `只有 Model 与 Effort 两级，选择提交完整组合对` — user can choose exactly two levels and submits both. | Composer embedded selector; open Model/Effort menus and choose model. **PASS/current**, migrated. |
| 149 | `pending 期间显示目标值与切换中，入口锁定` — pending command is visible and cannot be double-submitted. | Composer pending model; disabled trigger/target label. **PASS/current**, migrated. |
| 150 | `在常驻入口与展开面板显示当前 session context 真值` — context usage is visible in pill and panel. | Composer selector `view.usage`; percent/tokens/progressbar. **PASS/current**, migrated. |
| 151 | `多 @ 显示 N 个目标且无设置入口` — multi-target compose has no ambiguous single-agent settings. | Composer recipient projection; two recipients → count/no selector. **PASS/current**, migrated. |
| 152 | `无判据且多 agent 时提供手选入口` — no target criterion offers explicit agent choice. | Composer agent target menu; choose Claude → `selectAgent`. **PASS/current**, migrated. |
| 153 | `值域未就绪时显示角色名+刷新入口；点击先取数，数据一到自动展开` — manual refresh is the sole fetch trigger and opens when data arrives. | Composer selector `openAgentSelector`; null view → click, ready view → menu. **PASS/current**, migrated. |
| 154 | `值域暂时缺席再回到同一目标：面板保持打开` — transient refresh gap is not a target change. | Composer selector same actor with null→ready view; current trigger exposes the truthful `Steward，模型未知` name and the menu remains open. **PASS/current**, migrated. |
| 155 | `真的换了目标才收起` — changing actor closes the panel. | Composer target identity change; the strict cold-state trigger resolves and the menu closes only after the actor changes. **PASS/current**, migrated. |
| 156 | `没点过就拿到值域时不自作主张展开` — data arrival alone must not open UI. | Composer null→ready without click; no menu/open command. **PASS/current**, migrated. |
| 157 | `current 为 null 时 pill 只显示角色名，菜单仍可设置（选 model 落首组合）` — cold selector remains operable without fake current value. | Composer with options and no context; the truthful `Steward，模型未知` trigger opens the menu and selecting a model submits the first legal combination. **PASS/current**, migrated. |
| 158 | `无 selections 但 context 有 model 时显示只读状态，不伪造配置项` — context-only model is readable but not configurable. | Composer options absent/context present; read-only dialog/no menu items. **PASS/current**, migrated. |
| 159 | `展开时显示 provider 私有的客户端升级信号` — provider client update signal is visible in expanded selector. | Composer selector client metadata; expanded panel displays current/latest/update. **PASS/current**, migrated. |

### GAP-03 historical packet (resolved by current Composer owner)

- **Original repro:** render a canonical `projectAgentParameters` cold view
  for Steward with `current === null`, then query the public trigger by
  `Steward，模型未知`. The old implementation exposed only `Steward`, causing
  the refresh-gap, target-change, and first-legal-combination cases to fail.
- **Resolution evidence:** the current `Composer` `ModelSelector` owns the
  truthful `aria-label` branch at `src/ui/composer/Composer.jsx:177`, and
  `tests/model-selector.test.jsx:193-244` now passes all three strict cases.
  Commit `8e3b69f` restored the current public capability projection without a
  fake selection or compatibility adapter. This packet is retained as the
  red-to-current-owner bridge and is not a current product gap.

## Round 11 I–M oracle/red reconciliation

The requested slice is the eleven **ORACLE/current** rows below. Their old
assertions are implementation-specific, but each has a current public owner,
an executable contract, and a passing replacement; no row is being silently
removed or force-green via a private production function.

| baseline row | current public owner | executable contract | result |
|---|---|---|---|
| 21 | `ChannelReplica.trim` / open-turn floor | old request + provisional rows remain a pending turn under trim pressure | `tests/memory-window.test.js:106-130` — PASS |
| 22 | Replica closure + Waiting projection | stale local echo cannot resurrect a trimmed completed turn | `src/model/channel-replica-terminal-closure.test.jsx:52-71` — PASS |
| 23 | Replica parent-keyed closure reconciliation | earlier response-first terminal remains canonical after late pages | `src/model/channel-replica-terminal-closure.test.jsx:127-149` — PASS |
| 24 | Replica trim/rebuild terminal proof | request-absent terminal and exact closure upgrade remain visible | `src/model/channel-replica-terminal-closure.test.jsx:73-125` — PASS |
| 25 | Replica compact terminal fields | documented merge/preempt/replacement facts survive exact full-row re-admission | `src/model/channel-replica-terminal-closure.test.jsx:191-211` — PASS |
| 26 | Replica closure identity reconciliation | a conflicting terminal cannot replace the first; the exact row upgrades | `src/model/channel-replica-terminal-closure.test.jsx:108-124` — PASS |
| 27 | Replica `buildTurn` ledger ordering | first FINAL by sequence remains authoritative | `src/model/channel-replica-turn-integrity.test.js:97-106` — PASS |
| 29 | Replica provisional trim boundary | unmatched provisional data yields no terminal/closure; exact request may be pending | `src/model/channel-replica-terminal-closure.test.jsx:213-223` — PASS |
| 115 | `argsOf` + timeline renderer | canonical `{payload:{body}}` renders; unsupported flat history is not revived | `tests/message-presentation.test.js:72-98` — PASS canonical / ORACLE flat |
| 143 | `projectAgentParameters` + Composer selector | canonical `agent.options` projects legal model/effort domains without Describe `oneOf` | `tests/model-selector.test.jsx:60-145` — PASS replacement |
| 146 | `projectAgentParameters` canonical matcher | closed sender/audience/type/parent matching remains bounded to current protocol | `tests/model-selector.test.jsx:40-60` — PASS replacement |

The focused I–M command is green at **17 files / 106 tests / 106 passed**.
The prior three product packets (GAP-01 renderer, GAP-02 Replica trim, and
GAP-03 Composer cold selector) are historical red-to-owner bridges, not open
red cases in this run. The separately added Replica root-stability and
projection-version probes are outside this I–M focused ledger; their findings
remain handoffs to their owning partition rather than being relabeled here.

## Final disposition and verification

- Baseline accounting is complete: rows 1–159 above represent all 158 test
  declarations plus both expanded `takeover` variants.
- Current-owner focused run: 17 files, 106 tests total, all 106 passing. The
  run includes the four recreated owner suites (`management-actors`,
  `memory-window`, `message-list-lifecycle`, `message-presentation`) and the
  current `model-selector` suite; existing current-owner suites were left
  intact. The former GAP-01/02/03 packets are all resolved by their existing
  public owners and are not counted as current red cases.
- The eleven ORACLE/current rows are not silently dropped: memory 21–27 and
  29, message 115, and model 143/146 each name the current owner, executable
  replacement assertion, and the reason the deleted implementation detail is
  not revived. Any unrelated red successor (for example Replica root
  stability or projection-version efficiency tests) remains outside this I–M
  focused accounting and is not relabeled as green here.
- No old API, old store, compatibility parser, vendor/package/lockfile, or
  second source of truth was restored. The deleted virtualizer/list was not
  mocked. The migration report is the unresolved-case handoff for root review.
