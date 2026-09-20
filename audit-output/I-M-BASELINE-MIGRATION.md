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

Focused I-M evidence is 108/108 passing after the Round 24 additive contract:
live 5, management 4, markdown 11,
memory 17, Mermaid 6, layout 4, lifecycle 12, message presentation 4, time
4, mock 23, and model selection 18. The ten remaining implementation-oracle rows
(memory 21–27 and 29, message 115, and model 146) are each mapped to a
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

## 5. `memory-window.test.js` (baseline 18; current 17, PASS/current plus ORACLE/current)

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
| 22 | `保留先到 terminal 的 compact closure，窗口裁剪后旧 queued 不能复活` — compact terminal evidence prevented stale queued resurrection. | `ChannelReplica` closure + `useWaitingEditingController`; the trimmed completed turn suppresses a stale local echo for both request-first and response-first re-admission. **ORACLE/current**, executable evidence `src/model/channel-replica-terminal-closure.test.jsx:52-71,127-155`. |
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

## 17. `model-selector.test.jsx` (18/18, PASS/current)

The old cases called the deleted `agent-selection` adapter and standalone
selector. The current public owner is `projectAgentParameters` plus the
`Composer`-embedded selector. Canonical `agent.options`/`agent.context` turns
replace old Describe `oneOf`; no compatibility parser was added.

| # | Baseline case; capability and invariant | Current public owner; setup → observable; disposition/evidence |
|---|---|---|
| 143 | `从 describe 的 oneOf 提取组合对与 title` — old Describe schema projected legal model/effort pairs and labels. | `projectAgentParameters`' current public capability fallback projects the legal pair titles and deduplicated model list; canonical `agent.options` remains preferred. **PASS/current**, direct evidence `tests/model-selector.test.jsx:104-143`; no deleted adapter or normalization API restored. |
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

## Round 12 exact-path recovery from the global static ledger

`audit-output/TEST-CASE-MIGRATION-LEDGER.md` still lists the five I–M source
paths (`management-actors`, `memory-window`, `message-list-lifecycle`,
`message-presentation`, and `model-selector`) as `absent target path`, even
though the semantic migration above is green. The missing status is a path
provenance problem, not permission to revive the deleted modules. The new
public-owner bridge is `tests/i-m-exact-path-contracts.test.jsx` (8/8 pass):

| static baseline case | current public owner | executable bridge |
|---|---|---|
| management actor route (`management-actors`: system actor fallback) | `buildComposerModel` + `createComposerCommandRequest` + `SYSTEM_ACTOR_ID` | `tests/i-m-exact-path-contracts.test.jsx:158-173` |
| open turn under trim (`memory-window`: incomplete turn) | `createChannelReplicaStore().trim` / open-turn floor | `tests/i-m-exact-path-contracts.test.jsx:175-194` |
| response-first terminal (`memory-window`: compact closure/full upgrade) | Replica public `commit`/`trim`/`state().timeline` | `tests/i-m-exact-path-contracts.test.jsx:196-213` |
| channel closure isolation (`memory-window`: same request id) | channel-keyed Replica records | `tests/i-m-exact-path-contracts.test.jsx:215-222` |
| protocol language precedence (`message-presentation`: body beats label) | `useTimelineRowRenderer` / canonical `payload.body` | `tests/i-m-exact-path-contracts.test.jsx:224-230` |
| canonical options with no ledger truth (`model-selector`) | `projectAgentParameters` / `agent.options` | `tests/i-m-exact-path-contracts.test.jsx:232-240` |
| target change closes selector (`model-selector`) | Composer-embedded public `ModelSelector` | `tests/i-m-exact-path-contracts.test.jsx:242-260` |
| detached visible snapshot (`message-list-lifecycle`) | `createConversationPresentation` | `tests/i-m-exact-path-contracts.test.jsx:262-281` |

These eight cases are supplemental exact-path evidence; they do not inflate
the 159-case baseline count. The bridge is intentionally additive and uses no
deleted import, private production function, compatibility parser, or source
edit. The targeted command is `npx vitest run
tests/i-m-exact-path-contracts.test.jsx` → **8/8 GREEN**.

## Round 13 exact-path recovery: message-list-lifecycle public-owner batch

The global ledger still marks `fae8b70:tests/message-list-lifecycle.test.jsx`
(64 declarations) as an absent target path. This round adds **16 independent
public-owner tests** to the same exact-path bridge. Each row below names one
static ledger case and one executable `it`; multi-invariant lifecycle cases are
deliberately split where the current owner exposes separate state transitions.
The tests use only the current Presentation,
Reading-session, and navigation-coordinator APIs. They do not recreate the old
list adapter, import a private helper, or claim UI-only status/DOM geometry that
the current public owner does not expose.

| static case | current public owner | executable contract |
|---|---|---|
| TC-0976 data-relative prepend origin | `createConversationPresentation` | `tests/i-m-exact-path-contracts.test.jsx:316-339` — one committed prepend decrements `firstItemIndex` once |
| TC-0976 exact restore index | `resolveReadingBookmark` | `tests/i-m-exact-path-contracts.test.jsx:341-353` — exact target resolves at its data-relative row index |
| TC-0980 stale activation restore | `observeReading` | `tests/i-m-exact-path-contracts.test.jsx:355-371` — stale activation is a no-op and keeps the bookmark |
| TC-0981 provisional successor | `resolveReadingBookmark` | `tests/i-m-exact-path-contracts.test.jsx:373-383` — successor fallback cannot reuse a row-local offset |
| TC-0981 exact materialization | `resolveReadingBookmark` | `tests/i-m-exact-path-contracts.test.jsx:385-393` — only the exact materialized identity reuses the offset |
| TC-0996 tail no-op | `observeReading` | `tests/i-m-exact-path-contracts.test.jsx:395-407` — tail evidence without current newer input leaves following unchanged |
| TC-0996 older takeover | `takeReadingControl` | `tests/i-m-exact-path-contracts.test.jsx:409-417` — older input advances the epoch and enters browsing |
| TC-0997 selection autoscroll | `observeReading` | `tests/i-m-exact-path-contracts.test.jsx:419-432` — selection-at-tail does not grant following authority |
| TC-0998 zero geometry | `requestLatest` + `observeReading` | `tests/i-m-exact-path-contracts.test.jsx:434-450` — layout evidence with zero geometry leaves explicit latest pending |
| TC-0999 later height | `requestLatest` + `observeReading` | `tests/i-m-exact-path-contracts.test.jsx:452-467` — a later layout revision does not consume explicit latest |
| TC-1002 exact consume | `consumeLatestIntent` | `tests/i-m-exact-path-contracts.test.jsx:469-483` — exact consumption clears once and rejects a second consume |
| TC-1005 native takeover | `takeReadingControl` | `tests/i-m-exact-path-contracts.test.jsx:485-493` — native input clears the pending following intent |
| TC-1009 real tail after latest | `requestLatest` + `consumeLatestIntent` | `tests/i-m-exact-path-contracts.test.jsx:495-508` — consumed latest leaves the session following |
| TC-1017 target identity set | `bindLatestIntentTargets` | `tests/i-m-exact-path-contracts.test.jsx:510-519` — durable target identities are de-duplicated |
| TC-1017 activation fence | `bindLatestIntentTargets` | `tests/i-m-exact-path-contracts.test.jsx:521-534` — stale activation cannot mutate bound targets |
| TC-1026 scrollend settlement slice | `createReadingNavigationCoordinator` | `tests/i-m-exact-path-contracts.test.jsx:536-557` — one wheel transaction emits one public scrollend completion |

The final row is explicitly an owner-level transaction slice of the old
scroll/list coalescing case; it does not silently assert the deleted list
adapter's DOM commit loop. UI-only restore status, physical runway geometry,
and DOM-write counts remain outside this batch and remain ledger-visible for a
future owner-specific test. The targeted command after this batch is `npx
vitest run tests/i-m-exact-path-contracts.test.jsx` → **24/24 GREEN** (8 prior
bridge cases + 16 new cases). These supplemental cases do not inflate the
159-case baseline count.

## Round 14 exact-path recovery: mixed memory, identity, presentation, and model batch

The static ledger still marks the selected declarations from the absent
`fae8b70` paths as `absent target path`: eight `memory-window` cases, one
`management-actors` case, one `message-presentation` case, and ten
`model-selector` cases. This round adds **20 independent `it` contracts** to
the exact-path bridge. Each row below has its own user-observable invariant,
current public owner, and assertion; no two ledger cases are compressed into a
single pass/fail claim.

| static case | current public owner | executable contract and evidence |
|---|---|---|
| TC-0936 materialized-row trim and coverage rebuild | `createChannelReplicaStore().trim` / public `record().materializedCoverage` | Eight rows → trim to four → only seq 5–8 and one public coverage interval remain. `tests/i-m-exact-path-contracts.test.jsx:595-608` — **PASS** |
| TC-0937 low-water no-op | `createChannelReplicaStore().trim` | A limit at or above the current row count removes nothing and preserves seq 1–4. `tests/i-m-exact-path-contracts.test.jsx:610-617` — **PASS** |
| TC-0940 earliest response-first terminal | Replica public `commit` / `trim` / `state().timeline` | Terminals at seq 3 then 2 are reconciled after the request arrives; seq 2 is the canonical terminal. `tests/i-m-exact-path-contracts.test.jsx:619-634` — **PASS** |
| TC-0941 retained matched closure blocks stale queued work | Replica public `commit` / `trim` / `state().timeline` | A trimmed completed turn remains completed while a stale request/progress pair is re-admitted as provisional. `tests/i-m-exact-path-contracts.test.jsx:636-653` — **PASS** |
| TC-0946 unmatched provisional eviction | Replica public `commit` / `trim` / `state().rows` / `state().timeline` | Progress without a request is removed by the window and creates no turn. `tests/i-m-exact-path-contracts.test.jsx:655-663` — **PASS** |
| TC-0947 closed turn outside window | Replica public `commit` / `trim` / mine projection | A fully old request/terminal pair has no timeline or mine-projection row after trim. `tests/i-m-exact-path-contracts.test.jsx:665-677` — **PASS** |
| TC-0948 surviving mine projection | Replica public `commit` / `trim` + `selectTimelineItems` | After trim, the projection contains the surviving `new-request` only and excludes `old-request`. `tests/i-m-exact-path-contracts.test.jsx:679-698` — **PASS** |
| TC-0949 historical backfill in mine projection | Replica public `commit` + `selectTimelineItems` | A trimmed `q-0` is absent, then the same public request/terminal rows are backfilled and `q-0` reappears. `tests/i-m-exact-path-contracts.test.jsx:700-720` — **PASS** |
| TC-0924 genesis system declarations | `SYSTEM_DECL_IDS` + `isStandardActorIdentity` | Both canonical genesis declarations (`registrar`, `svcactor`) are recognized as standard identities. `tests/i-m-exact-path-contracts.test.jsx:722-726` — **PASS** |
| TC-1031 canonical body wrapper without context leakage | `MessageHarness` / current timeline message presentation | A canonical member-create body renders its public label while `_context.caller` is not rendered. `tests/i-m-exact-path-contracts.test.jsx:728-738` — **PASS** |
| TC-1060 context truth over catalog | `projectAgentParameters` | Completed canonical context selects `gpt-5.6-sol/medium` while the available model list remains independently projected. `tests/i-m-exact-path-contracts.test.jsx:740-744` — **PASS** |
| TC-1062 public capability oneOf projection | `projectAgentParameters` public capability projection | The current owner accepts the documented `describe.types` capability shape and exposes both legal model/effort pairs. `tests/i-m-exact-path-contracts.test.jsx:746-772` — **PASS** |
| TC-1063 model change selects first legal effort | Composer-embedded public model selector | Choosing `gpt-5.4` from a `medium` current selection submits its first legal `light` effort. `tests/i-m-exact-path-contracts.test.jsx:774-793` — **PASS** |
| TC-1064 two-level public menu | Composer-embedded public model selector | The expanded menu exposes model and reasoning-strength entries, with no provider menu entry. `tests/i-m-exact-path-contracts.test.jsx:795-810` — **PASS** |
| TC-1065 pending target and lock | Composer-embedded public model selector | A pending `gpt-5.4/light` target is shown with “切换中” and disables the trigger. `tests/i-m-exact-path-contracts.test.jsx:812-832` — **PASS** |
| TC-1066 context usage trigger/panel | `projectAgentParameters` + Composer selector | Canonical 42K/200K context is shown as 21% in the trigger and expanded usage panel. `tests/i-m-exact-path-contracts.test.jsx:834-849` — **PASS** |
| TC-1067 multi-recipient count | Composer public recipient projection | Two recipients produce the public “2 个目标” label and no single-agent model button. `tests/i-m-exact-path-contracts.test.jsx:851-865` — **PASS** |
| TC-1068 no-target Agent picker | Composer public target picker | With no target criterion, choosing `Other` invokes the public `selectAgent('other')` command. `tests/i-m-exact-path-contracts.test.jsx:867-881` — **PASS** |
| TC-1069 cold selector fetch/open continuity | Composer `openAgentSelector` + same-target rerender | A cold click requests options without opening; readiness for the same target then opens the menu. `tests/i-m-exact-path-contracts.test.jsx:883-901` — **PASS** |
| TC-1072 passive options arrival | Composer selector open-state owner | Options arriving without a user open action do not open the menu or issue a fetch command. `tests/i-m-exact-path-contracts.test.jsx:903-918` — **PASS** |

The exact-path command is `npx vitest run
tests/i-m-exact-path-contracts.test.jsx` → **44/44 GREEN** (8 prior bridge
cases + 16 Round 13 lifecycle cases + 20 Round 14 cases). The new tests use
only public owners and observable state/DOM; they do not inspect private
Replica maps or export a deleted adapter. The Round 14 snapshot retained
TC-1028/1029 as an owner handoff; Round 15 below revalidates TC-1028 and
records the minimal same-owner repair for TC-1029 without changing tests.

## Round 15 TC-1028/1029 owner revalidation and minimal repair

These two cases are reader-facing presentation abilities, not transport
compatibility promises:

| case | precise user ability | unique current owner | minimal public repro → result |
|---|---|---|---|
| TC-1028 | A reader sees typed system operations in product language and never the raw wire word; `system.channel.create` is “创建子频道：operation-room” and `system.member.admit` is “邀请成员加入：alice”. | `useTimelineRowRenderer` → `Narration`/`EnvelopeBody` → `textOf` → `systemOperationText` in `src/ui/timeline/TimelineRowRenderer.jsx:46-156`; there is no second presentation owner. | Canonical `{ type: 'system.channel.create', visibility: 'system', payload: { body: { name: 'operation-room', recipe: { declarations: [] } } } }` through the public narration row → **PASS**. The same owner maps `system.member.admit` at lines 53/100. Existing owner change `fbbbb26` is the minimal fix; no new compatibility path was added. |
| TC-1029 | A reader may inspect an unknown/vendor structured result, but sensitive fields such as `token` must be hidden and the renderer must not leak raw JSON secrets. | The same `TimelineRowRenderer.textOf` result/output fallback; terminal `StructuredResult` already owns the redaction helper used by this renderer. | Public standalone `vendor.custom` response with canonical body `{ status: 'completed', result: { nested: { value: 1 }, token: 'super-secret-value' } }` (strict repro `src/ui/timeline/message-body-presentation.test.jsx:90-98`) previously leaked the token; **FIXED** by reusing `redactSensitive` before JSON serialization and returning generic `结构化结果` on serialization failure at `src/ui/timeline/TimelineRowRenderer.jsx:153-156`. |

Targeted evidence: `npx vitest run src/ui/timeline/message-body-presentation.test.jsx -t 'protocol payloads|unknown payload|sensitive' tests/message-presentation.test.js` → **2 files, 3 passed, 6 skipped**; the current public-owner `tests/message-presentation.test.js` is **4/4 GREEN**. The full strict successor is **4/5** because its separate TC-1031 flat-payload compatibility assertion remains red by deliberate protocol-cutover decision; it is not a TC-1028/1029 failure and was not altered. No test was edited, skipped, or weakened.

## Round 16 TC-1031 canonical-boundary contract

The clarified user contract is that old flat business-payload rows may still
arrive at the transport boundary, but they are not business messages:
ingestion must not throw; no business timeline/narration row, notification,
live-presentation arrival, or empty card may be created; and neither
all-channel nor mine business projection may contain the row. Existing typed
bodyless system narration remains metadata-only and is not a flat business
message. This is an ignore-at-normalization contract, not permission to parse
the old shape back into a message.

| user invariant | unique public owner | strict evidence |
|---|---|---|
| Flat request/response/event rows remain transport-safe but do not become lifecycle, narration, or standalone entries. | `createChannelReplicaStore().commit` → Replica `rebuildState` canonical-body boundary | `src/model/channel-replica.js:347-353` keeps the raw row in public `state.rows` while skipping non-canonical envelopes before all business entry construction. Bodyless system narration remains the existing metadata exception. |
| Flat rows do not produce all/mine timeline items or an empty Presentation card; a canonical event remains visible as the control. | `selectTimelineItems` → `createConversationPresentation().evaluate` | `tests/i-m-exact-path-contracts.test.jsx:930-982` — flat IDs are absent and only `canonical-event` has a Presentation row. |
| Flat rows do not produce rail notifications or live Presentation arrival receipts. | `notificationDisposition` + Replica `arrivalReceipts.presentation()` | The same strict case asserts every flat disposition is `not_presented`, rail-notifiable is false, and the receipt contains only `canonical-event`; guards are `src/model/notification-policy.js:44` and `src/model/channel-replica.js:567-569`. |

The focused command is `npx vitest run tests/i-m-exact-path-contracts.test.jsx -t
'TC-1031'` → **2/2 GREEN** (the prior canonical-wrapper case plus this strict
flat-boundary case). The full exact bridge is now **45/45 GREEN**. The
pre-existing successor test that expects a flat request to render old text is
an obsolete compatibility oracle; it remains untouched and is not used to
weaken this contract. No compatibility parser, second ledger, or private
production map was introduced.

## Round 17 projection-version efficiency oracle

The deleted fold store's separate `_timelineControlVersion` versus
`_timelineProjectionVersion` distinction is an implementation fingerprint, not
a current user promise: a unique canonical processing frame changes visible
content and must advance the current Presentation snapshot. The user-facing
invariant is narrower: duplicate delivery and rows that canonical normalization
deliberately ignores must not invalidate the canonical projection clock.

| user invariant | unique public owner | strict evidence |
|---|---|---|
| An accepted flat row may advance durable Replica ingress, but it must not advance the public canonical `historyFor(channel).presentationRevision`, `_timelineRevision`, or projection invalidator; a repeated seq remains a no-op. | `ChannelFeedRuntime` → `ChannelReplica.commit` and `historyFor().presentationRevision` | `src/model/channel-replica-projection-version.test.js:64-88` — one flat row increases durable `revisionFor` only; public presentation revision and canonical clock stay stable, and the repeated seq does not increase either. |
| A unique visible canonical content fact still advances Presentation. | `createConversationPresentation` + Replica canonical source revision | `src/model/channel-replica-projection-version.test.js:90-105` — canonical processing response advances the source clock and Presentation snapshot revision by one. |
| Trimming only ignored flat transport rows does not invalidate projection. | Replica `trim` | `src/model/channel-replica-projection-version.test.js:107-118` — durable trim revision advances while canonical clocks remain zero. |

The minimal owner fix is in `src/model/channel-replica.js:732-752` and
`src/model/channel-replica.js:778-796`: durable row/trim revision remains
separate, while timeline source revision, change log, and projection
invalidator advance only when `hasProjectionBody` says the row can participate
in canonical projection. No `_timelineControlVersion` compatibility field was
restored and no notification/cache owner was touched. Focused evidence:
`npx vitest run src/model/channel-replica-projection-version.test.js` → **3/3
GREEN**; the I–M broad owner set is **112/112 GREEN**. The separate legacy
`channel-feed-runtime-unread` successor still has its documented two red flat
payload/old weak-total assertions; those are stale compatibility semantics and
were not changed to re-enable flat notification behavior.

## Round 18 flat-ingress identity boundary

The flat-payload cutover has one more identity boundary at the Replica: a
historical row may remain in `state.rows` so transport/audit coverage is not
lost, but it cannot become a lifecycle identity or terminal-closure input.
This is still an ignore-at-normalization contract; no legacy parser or second
store was restored.

| user invariant | unique public owner | strict evidence |
|---|---|---|
| A flat request/response/response-first/system row stays durable for audit but does not populate `_envelopesById`, timeline/narration, or terminal-closure state, including after trim. | `createChannelReplicaStore().commit` → Replica `rebuildState` and trim closure capture | `src/model/channel-replica-flat-ingress.test.jsx:58-105` — all four rows remain in `state.rows`, all four IDs stay out of the identity map, projections remain empty, and `_unmatchedTerminalClosures` remains empty through trim. The owner gates closure request provenance at `src/model/channel-replica.js:299` and identity indexing at `:355-356`. |
| A flat event cannot suppress its matching local echo, and a flat request cannot suppress the corresponding Waiting submission. | `selectTimelineItems` local-echo join + `useWaitingEditingController` Waiting de-duplication | `src/model/channel-replica-flat-ingress.test.jsx:107-132` — the public projection retains the local event echo and Waiting retains `flat-request` as queued. |

The focused command is `npx vitest run
src/model/channel-replica-flat-ingress.test.jsx src/model/channel-replica-terminal-closure.test.jsx
src/model/channel-replica-thread-structure.test.jsx src/model/channel-replica-turn-integrity.test.js
src/model/channel-replica-projection-version.test.js src/ui/timeline/waiting-presentation.test.jsx
tests/memory-window.test.js tests/i-m-exact-path-contracts.test.jsx` → **8 files,
88/88 GREEN**. The only source owner touched in this round is
`src/model/channel-replica.js`; notification policy/cache files are unchanged.
The separate feed-runtime `controlParentClosure` path remains outside this
Replica-only change and is not relabeled as fixed by this evidence.

## Round 19 shared redaction policy

Replica persistence and Timeline structured rendering now consume one pure
redaction policy. The policy remains boundary-local in effect: cache writes and
legacy-row migration sanitize before durable storage, while rendering sanitizes
both JSON fallback text and structured result trees. No quota or notification
owner was changed.

| user invariant | unique public owner | strict evidence |
|---|---|---|
| Exact sensitive field names are recursively replaced at arbitrary object/array depth, without mutating the input. | `redactSensitive` in `src/model/terminal-result.js` | `src/model/terminal-result.test.js:4-31` — nested/array `key`, `token`, `password`, and `private_key` become `已隐藏`; `token_count`, `keynote`, `tokenized`, `text`, and labels remain unchanged; source input remains intact. |
| Durable Replica rows and old-row migration use the shared policy before IndexedDB exposure. | `createChannelReplicaCache().saveRows/readBefore` → `redactSensitive` | `tests/channel-replica-cache-redaction.test.js` — raw IndexedDB, reload, and migration paths retain business text while hiding nested credentials. |
| Timeline JSON fallback and structured terminal trees use the same policy at render time. | `TimelineRowRenderer` → `redactSensitive` | `tests/message-presentation.test.js` and `tests/structured-result-restore.test.jsx`, plus `src/ui/timeline/message-body-presentation.test.jsx -t 'protocol payloads|unknown payload|sensitive'` → **2/2 GREEN** for the redaction cases. |

Focused evidence: `npx vitest run src/model/terminal-result.test.js
tests/channel-replica-cache-redaction.test.js tests/message-presentation.test.js
tests/structured-result-restore.test.jsx` → **4 files, 19/19 GREEN**. The full
message-body successor still has its pre-existing flat-payload compatibility
red case; it remains untouched because this round does not restore legacy
parsing.

## Round 20 Replica cache durability and next I–M bridge

The Replica cache contract now treats physical rows as the startup source of
truth. A stale Meta row cannot claim rows or coverage that are absent; old
physical survivors are redacted again when startup or quota rebuild rewrites
the window. `saveRows` and `clear` share a serialized owner queue, and clear
publishes its in-memory reset only after the durable transaction commits.

| user invariant | unique public owner | strict evidence |
|---|---|---|
| Startup reconciles stale Meta/physical rows, removes metadata-only channels, and does not materialize a seq gap. | `createChannelReplicaCache.ensureOwner` → Replica cache rows/meta | `tests/channel-replica-cache-redaction.test.js` startup reconciliation case; `tests/memory-window.test.js` additive TC-0951 bridge re-selects the owner and observes physical-only coverage `{1,1},{3,3}`. |
| A quota-window survivor that was written in an old unredacted shape is redacted again at the rebuild boundary. | `replaceChannelRows` → shared `redactSensitive` | `tests/channel-replica-cache-redaction.test.js` quota survivor case inspects raw IndexedDB rows after bounded save and finds no old key/token. |
| Concurrent bounded saves retain both ordered new rows; failed clear leaves durable rows and published Meta intact. | Replica cache serialized `saveRows`/`clear` owner queue | `tests/channel-replica-cache-redaction.test.js` concurrent save and injected clear-transaction failure cases. |
| A partial physical tail does not certify source exhaustion; an older network refill keeps the newer bounded tail and reports physical coverage only. | `readBefore` + bounded `physicalWindow` | `tests/channel-replica-cache-redaction.test.js` seeds rows 8–14, reads `beforeSeq=9` with `exhausted=false`, refills 1–7, and verifies rows 7–14 plus coverage 7–14. |

The focused Replica/cache command is `npx vitest run
tests/channel-replica-cache-redaction.test.js tests/memory-window.test.js` → **2
files, 28/28 GREEN**. The additive memory case is mapped to static ledger
`TC-0951` only as a new public-owner bridge; it does not increase the 159-case
I–M baseline count or duplicate the existing merge-coverage assertion. The
historical FEED-CACHE wording in the E–H and global ledgers now points to this
current Replica contract; notification owners were not changed.

## Round 22 Feed source continuation

`ChannelFeedRuntime.loadHistory` now treats a non-empty, underfilled IndexedDB
page as a physical segment: it merges/publishes the cache rows first, then
continues from the next cursor while local coverage still owns that cursor or
switches the same demand to network when the retained tail ends. A network
page is requested once per partial-tail demand, duplicate rows are absorbed by
the existing Replica owner, and a detached/error network path leaves the
partial cache visible while reporting the correct cancellation/error state.

Focused evidence: `tests/channel-feed-runtime.test.jsx` → **13/13 GREEN**;
the partial-tail case proves `beforeSeq=9` cache row 8 is presented before the
single network page (rows 1–7), with no duplicate rows; the offline case proves
row 8 remains visible while `historyDemand.phase=error` and the request is not
misclassified as local exhaustion. No Replica or notification owner was
changed in this round.

## Round 23 Replica sparse-coverage audit

`50918ae` contains the Feed continuation hunks and their two required public
Feed tests, but it is not an exclusive Feed commit: the shared pre-staged
index also included unrelated E–H governance ledger and governance-preview
edits (`audit-output/E-H-BASELINE-CURRENT-OWNER-CASE-LEDGER.md` and
`audit-output/E-H-R22-GOVERNANCE-AND-EXTENSIONLESS-PREVIEW.md`). The Feed
source/test hunks themselves do not touch Replica or notification owners; the
commit therefore passes the owner-surface audit but fails the exclusive-commit
integrity check and must not be cited as a Feed-only changeset.

The public Replica counterexample exposed a separate real red: physical rows
`[1, 3]`, coverage `{1,1},{3,3}`, and `readBefore('c0', 4, ...)` previously
returned `exhausted=true` solely because the physical lower bound was `seq1`.
The minimal Replica-owner correction requires the physical prefix below the
requested cursor to be contiguous before publishing exhaustion; row 2 remains
unknown in the sparse case, so the result is `rows=[1,3], exhausted=false`.
The existing partial-tail contract (`rows=[8]`, `beforeSeq=9`,
`exhausted=false`) remains unchanged.

Evidence: `tests/channel-replica-cache-redaction.test.js` → **12/12 GREEN**;
`tests/memory-window.test.js` → **17/17 GREEN**;
`tests/channel-feed-runtime.test.jsx` → **13/13 GREEN**. The Replica change is
limited to `readBefore` and its public cache test; no notification, arrival,
vendor, package, or lockfile owner changed.

## Round 24 sparse-coverage review and model-selector baseline completion

The independent review of `15d7b4f` remains **ACCEPT** for the product
mechanism. `git diff 15d7b4f..HEAD` is empty for
`src/model/channel-replica.js` and
`tests/channel-replica-cache-redaction.test.js`; the sparse public case still
uses physical rows `[1, 3]`, coverage `{1,1},{3,3}`, and `readBefore('c0', 4,
...)` returns `rows=[1,3], exhausted=false`. The guard only publishes local
exhaustion when the physical prefix below the cursor is contiguous, so the
known seq1 lower bound cannot hide seq2. The existing partial tail
`[8..14]`/`beforeSeq=9` contract remains `exhausted=false`.

The independent review of `50918ae` remains **REJECT** for exclusive commit
integrity. Its Feed continuation source/test hunks stay within their owner
surface, but the same commit also carries the unrelated E–H governance ledger
and governance-preview documents. No Replica, notification, arrival, vendor,
package, or lockfile change is attributed to the Feed commit; it must not be
cited as a Feed-only changeset.

The next unproven I–M baseline slice is model-selector row 143's full
user-visible projection, not another canonical-options case. Existing TC-1062
proved that the public capability shape is accepted with two legal pairs, but
did not prove the baseline's repeated-model/title behavior. The additive public
test `tests/model-selector.test.jsx:104-143` supplies three current
`describe.types`/`inputSchema.oneOf` branches and asserts all three legal
model/effort labels, the two-item deduplicated model list, `current=null` in the
absence of ledger truth, and configurability. It calls only the exported
`projectAgentParameters` owner; no private helper, deleted adapter, old
normalization shape, compatibility parser, or production source is restored.
This is distinct from TC-1062's two-pair acceptance assertion and leaves
Reading untouched.

Evidence: `npx vitest run tests/model-selector.test.jsx` → **18/18 GREEN**;
the sparse/Feed/Memory recheck
`npx vitest run tests/channel-replica-cache-redaction.test.js
tests/memory-window.test.js tests/channel-feed-runtime.test.jsx` → **3 files,
42/42 GREEN**. Re-running all 17 current I–M owner files gives **108/108
GREEN** (the pre-round aggregate had undercounted the current memory suite by
one). The baseline remains 159 cases; the new row-143 assertion is an
additive current-owner proof, not a duplicate baseline count.

## Round 25 response-first closure / Waiting baseline completion

Round 24's sparse and model-selector evidence is not repeated. The next I–M
baseline slice is memory-window row 22's response-first ordering: the current
owner already proved a response-first compact closure and exact full-row
upgrade, while the request-first variant proved stale local-echo suppression;
the missing cross-product was whether a late parent plus a queued echo could
reopen Waiting after the response-first terminal had been trimmed.

The additive public-owner test
`src/model/channel-replica-terminal-closure.test.jsx:127-155` drives only
`createChannelReplicaStore().commit/trim/state` and the public
`useWaitingEditingController` result. Its sequence is terminal at seq2,
unrelated tail through seq10, trim to four, late request at seq1, queued echo
at seq11, then an uncertain local submission with the same request id. The
observable contract is a completed, closure-only turn and an empty
`queuedTurns`; no second closure store, private production helper, or
notification/arrival owner is involved. The test is distinct from R1's
request-first echo and the existing response-first full-row-upgrade case.

Evidence: `npx vitest run
src/model/channel-replica-terminal-closure.test.jsx tests/memory-window.test.js`
→ **2 files, 26/26 GREEN**. This is an additive successor proof; the 159-case
baseline count and the 17-file/108-test I–M aggregate are unchanged. Reading
and all product sources remain untouched.

## Final disposition and verification

- Baseline accounting is complete: rows 1–159 above represent all 158 test
  declarations plus both expanded `takeover` variants.
- Current-owner focused run: 17 files, 108 tests total, all 108 passing after
  the additive row-143 proof. The
  run includes the four recreated owner suites (`management-actors`,
  `memory-window`, `message-list-lifecycle`, `message-presentation`) and the
  current `model-selector` suite; existing current-owner suites were left
  intact. The former GAP-01/02/03 packets are all resolved by their existing
  public owners and are not counted as current red cases.
- The ten remaining ORACLE/current rows are not silently dropped: memory 21–27
  and 29, message 115, and model 146 each name the current owner, executable
  replacement assertion, and the reason the deleted implementation detail is
  not revived. Model 143 now has direct public fallback evidence. Any unrelated red successor (for example Replica root
  stability or projection-version efficiency tests) remains outside this I–M
  focused accounting and is not relabeled as green here.
- Round 13 adds 16 independent exact-path public-owner cases from the absent
  `message-list-lifecycle` path; the bridge command is 24/24 green and the
  baseline count remains 159.
- Round 14 adds 20 independent exact-path public-owner cases across the
  absent `memory-window`, `management-actors`, `message-presentation`, and
  `model-selector` paths; the bridge command is 44/44 green and the baseline
  count remains 159. Round 15 revalidated TC-1028 and minimally repaired
  TC-1029 in its existing owner. Round 16 adds the strict TC-1031
  canonical-boundary contract; exact bridge is 45/45 and the stale
  compatibility oracle remains deliberately unmodified. Round 17 reclassified
  the deleted fold revision split as an implementation fingerprint, then
  fixed the real no-op invalidation at the current Replica boundary.
- No old API, old store, compatibility parser, vendor/package/lockfile, or
  second source of truth was restored. The deleted virtualizer/list was not
  mocked. The migration report is the unresolved-case handoff for root review.
