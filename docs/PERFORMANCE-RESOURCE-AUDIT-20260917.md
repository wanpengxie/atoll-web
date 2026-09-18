# Conversation performance and resource audit — 2026-09-17

Status: directed evidence only; not a release sign-off.

This audit is deliberately separate from correctness and visual admission. It
does not change production code. The permanent test surface is
`tests/browser/performance-budget.spec.js` plus its isolated browser fixture.
The fixture passes complete immutable data into the production `MessageList`
and renders production `MarkdownContent`; it does not use `slice(-64)`, a fake
range, or a replacement list implementation.

## 21:59 minimum re-sign (subsequently invalidated by list edits)

The required 100k minimum case passed independently at the following immutable
boundary; its combined source hash was unchanged from
test start to test end (`dff8dbbed24b8591ae17d9f22872bfcd0b15fadbc3ba7b009e81d4485d47b281`):

- `src/ui/timeline/LegendMessageList.jsx`: `e50f416b03257a1e0f17ed93f5245211cf747bfd5aa25c9302ec0413c04cfdcc`
- `src/ui/timeline/useReadingSession.js`: `5b8f4680990e9584dbb31b4ed487149e5e8dcfdd43bebf681217830f82346074`
- `tests/browser/performance-budget.spec.js`: `42a6dd2f5dc302217b353d1f6e12353f4f485cc8ff264ace385b4684430dfbda`
- `tests/browser/fixtures/production-perf.jsx`: `a59c29105f43074898d4f6a9af900fc4d0c5ce9029d3a657393adbf4a0aa683d`

The complete immutable 100,000-row source was passed to the production
Virtuoso adapter. After a trusted upward wheel input, 62 rows / 509 total DOM
elements were materialized; row 50,000 was visible and hit-testable, and its
55-character native selection remained connected. Synchronous installation
was 81.1 ms, timer delay was 104.4 ms, maximum long task was 111 ms, and the
forced-GC heap delta was 28,485,760 bytes (27.17 MiB). The semantic bookmark
also remained row 50,000. Thus DOM, heap, actual non-tail paint, selection and
restore safety pass on the current source boundary, while the 50 ms
responsiveness target remains red. This is one directed case, not a full-suite
or release signature. `LegendMessageList.jsx` and `useReadingSession.js`
changed again after this run; the result is no longer a signature for the
moving current list tree and must be re-run at its next freeze.

The waiting-capacity minimum was also independently re-signed, without running
the full suite. The combined hash of `src/ui/Timeline.jsx`
(`a9d24ebf456771f19db496cf84dd2804e698382bdcd9dedab79699f036b16a93`),
`src/model/waiting-presentation.js`
(`0c8f9f308c27d7cd2e473a35c276dbf38eeb0f5c8288094c270105dfc2b0a167`)
and the performance spec was identical at start and end
(`7231260164e8818289a84374fb9c92c6b8960aac1caff136622d832f3b6a1ca8`).
All eight waiting items appeared in 2,185.6 ms, collapse reported exactly eight,
the layer contained 275 total DOM elements, and the single case passed. Its
118 ms maximum long task means capacity/operability is green while the 50 ms
responsiveness gate remains red.

A later 100k re-sign at combined bundle hash
`218a37c3caa0b3bde169dc6971de7e774ae24deff29b837f443e181f0c2726d8`
(identical before and after the run) failed its restoration oracle. Initial
settling exposed rows 50,015–50,022 and had already moved the bookmark to
50,009. After the trusted `-600` wheel input, rows 50,004–50,016 were visible,
hit-test/selection landed on row 50,005 and the bookmark was row 50,004; row
50,000 never entered the viewport. DOM and heap remained bounded (62
materialized rows, 509 elements, 27.17 MiB forced-GC heap delta), but those
resource results cannot override the failed semantic target. List files moved
again after this run, so it is a source-bounded failure, not a signature for
the next freeze.

## 20:08 source-bounded result (historical)

The production file at this evidence boundary was a
`react-virtuoso@4.18.13` adapter (despite its historical
`LegendMessageList.jsx` filename). After the 20:08 SGT functional freeze, all
five directed catastrophic-safety cases passed. Production list/reading files
changed again later in the same work session, so this table is retained as a
historical source-bounded result, not evidence for the moving current tree.
The 50 ms responsiveness target also failed, so it was never a release
signature.

| Case | Current observed result | Decision |
|---|---|---|
| 100,000 complete presentation rows | Full immutable `rows`, `orderedIDs` and `entities` were handed to production `MessageList`; 41 rows were materialized after initial settling and 62 after trusted wheel input, with 509 total DOM elements; forced-GC heap delta was 26.7 MiB; install was 80.5 ms and maximum long task 114 ms; visible text painted, hit-tested and returned 55 characters through native Selection | DOM/heap/paint/selection safety bounds pass. The test deliberately contains no truncated source or fake range |
| 100k arbitrary restoration | Fixture storage and the first synchronous owner state both contain browsing bookmark row 50,000. After layout the actual range is around row 50,000; trusted wheel input materializes rows 50,000–50,011, hit-tests row 50,000 and preserves the bookmark | Pass after the adapter stopped adding `firstItemIndex` to the data-relative `initialTopMostItemIndex`. Trace records real production ranges and row commits |
| 100,000-character Markdown / 320 blocks inside 2,000 rows | One 19,811.5 px message row, 2,989 DOM elements, 33.4 ms synchronous install, maximum long task 911 ms; after trusted input the text hit-tested and native Selection returned 29 characters | Broad 2 s safety ceiling passes; 50 ms interaction target fails by 18×. List virtualization does not bound a single message |
| Huge ledger cold / warm | Cold first row 2,668 ms including login, warm 1,787 ms; eight rows materialized both times; maximum long tasks 186 / 176 ms | DOM and broad time ceilings pass; responsiveness target fails |
| Cold / warm cache and heap | 156 → 194 cache rows, 57,746 → 71,179 encoded bytes; forced-GC heap 20.7 → 20.1 MiB | Bounded in this sample; no retained cold heap observed |
| Mobile 390×844 continuous history | 45 upward inputs + return to tail, then 30 + return; 27 history intents and 27 satisfied; cache 460 → 740 rows / 165,210 → 264,190 bytes; forced-GC heap 25.65 → 28.09 MiB (+2.44 MiB); nine rows / 458 DOM elements | Two-cycle release, DOM, heap and cache safety bounds pass. Maximum long task 397 ms and 180 long tasks exceeded 50 ms, so mobile responsiveness fails |
| Waiting layer, active + eight submitted followers | All eight real queued requests appeared in 3,983 ms; collapse reported eight, expansion restored controls; 275 total DOM elements; maximum long task 143 ms | Capacity-eight safety and operability pass after task-target/historyStopped fixes. The 50 ms responsiveness target and unbounded-source risk remain open |

The mobile loop intentionally reports accepted history intents rather than
equating wheel event count with fetch count; coalescing 75 inputs into 27
fulfilled demands is expected scheduler behavior.

## Pre-transition comparison only

An earlier directed run was captured while the production adapter was
`@legendapp/list@3.3.11/react`. The list owner started an adapter transition
during this audit, so these exact timing values are a pre-transition baseline,
not evidence for the current worktree. These values explain the regression
boundary only; they cannot certify the current adapter.

| Case | Observed directed result | Decision |
|---|---|---|
| 100,000 complete presentation rows | 37 materialized rows at the tail, 45 at the middle, 373 total DOM elements at the middle; actual middle row near 50,000 was hit-testable and a native DOM selection returned text and 98 client rects | DOM bound, paint and selection passed. This is real production-adapter materialization, not a truncated data stub |
| 100,000-row memory | forced-GC JS heap grew from 5.0 MiB to 36.9 MiB, a 31.9 MiB delta | Passes the directed 160 MiB safety ceiling. This is browser JS heap, not total process RSS/GPU memory |
| 100,000-row main thread | fixture construction was cooperatively yielded and excluded; adapter snapshot install took 415.6 ms, zero-delay timer arrived after 519.7 ms, maximum long task was 444 ms; middle materialization produced a 216 ms long task | Fails the 50 ms responsiveness target. The DOM is bounded but accepting/reindexing a 100k array remains synchronous |
| 100,000-character Markdown, 320 top-level blocks, in a 2,000-row production list | 17 list rows, but the visible message itself was 19,811.5 px high, total DOM was 3,117 elements, install took 885.7 ms and produced a 933 ms long task; selection remained valid | Resource safety ceiling passed, interaction budget failed. Row virtualization does not bound work inside one long message |
| Huge-ledger cold first content | 2,016.5 ms from navigation start through login to first committed presentation row; 15 materialized rows; maximum long task 288 ms | Time-to-content is acceptable only as a local directed baseline; main-thread target fails |
| Huge-ledger warm reload | 1,302.1 ms to first row; 15 materialized rows; maximum long task 247 ms | Warm path improves first content but still has blocking work |
| Cold/warm cache and heap | cache 156 rows / 57,746 bytes, then 194 rows / 71,179 bytes; forced-GC heap 21.8 MiB then 20.9 MiB | Directed sample is bounded and does not retain cold heap after reload |
| Mobile 390×844, 12 upward history demands then return to tail | 19 materialized rows, 822 total DOM elements, 268 cached rows / 97,338 bytes, forced-GC heap 23.3 MiB | Historical single-cycle sample only |

Cold timing includes automated login interaction; warm timing starts at reload.
They are comparable local browser samples, not field LCP. Long-task values come
from Chromium `PerformanceObserver`; heap values come from CDP after forced GC.

## Fixed safety ceilings in the browser spec

These ceilings prevent catastrophic regressions; they are intentionally not
presented as good UX targets.

| Resource | Safety ceiling |
|---|---:|
| Materialized message rows, desktop or mobile | `< 100` |
| 100k presentation heap delta after forced GC | `< 160 MiB` |
| Warm application heap after forced GC | `< 192 MiB` |
| Mobile application heap after forced GC | `< 160 MiB` |
| Feed cache per channel | `≤ 5,000 rows` |
| Feed cache global encoded payload | `≤ 256 MiB` |
| Repeated mobile history heap growth between two returned-to-tail cycles | `< 32 MiB` |
| Stress-install long task | `< 500 ms` for 100k ordinary rows; `< 2,000 ms` for the deliberately pathological Markdown row |

The production constants independently impose 5,000 cached rows per channel,
256 MiB globally, and a mobile in-memory window of 500 raw rows / 8 MiB. The
browser assertions verify observed outcomes; source constants alone are not
runtime evidence.

## Responsiveness target and current failures

The main-thread target is no task longer than 50 ms during an already-open
interactive surface. The current Virtuoso-directed runs fail it in every heavy
path:

- 100k complete snapshot path: 114 ms;
- 100k-character Markdown: 911 ms;
- huge-history cold path: 186 ms;
- huge-history warm path: 176 ms;
- mobile continuous-history path: 397 ms maximum and 180 observed long tasks;
- active + eight waiting submissions: 143 ms.

These are reported even where the broad safety test passes. Raising the 50 ms
target or measuring only total completion time would hide input starvation.

## Waiting items

The browser mock accepts eight queued requests behind one active request; the
ninth and later requests return `base_capacity`. The waiting performance test
therefore submits eight real queued items and is designed to exercise
collapse/expand on production `WaitingLayer`. After the task-target and
historyStopped fixes, all eight appear, collapse reports the correct count and
expansion remains operable. This closes the earlier functional blocker, not the
50 ms responsiveness target.

That mock limit is not a product-wide DOM bound. `task-discovery.js` can retain
up to 1,024 task evidence records / 4 MiB, while `WaitingLayer` maps every
projected queued turn to one `<li>` inside a scroll container. `max-height` and
overflow do not reduce DOM, layout or accessibility-tree cost. Until the
backend contract proves a much smaller universal queue limit, the waiting UI
has an open O(n) materialization risk.

## Continuous history release

The mobile test performs two independent upward-history cycles, returns to the
real tail after each, forces GC at both tail boundaries and compares heap. This
is the browser-level release oracle because the production mobile trim runs
only when the visible channel is back at tail. It also records cache growth,
intent/satisfied counts, DOM rows and main-thread long tasks.

The current two-cycle run passed the release ceilings: live heap grew 2.44 MiB
and materialized DOM ended at nine rows. Durable cache legitimately grew from
460 to 740 rows and remains far below its independent 5,000-row channel bound.
This directed result does not prove a long-run plateau, total process RSS/GPU
memory, or behavior on physical mobile hardware.

## Markdown parse evidence

The browser result combines parse, React work, layout and paint. Before the
suffix-parser change, an independent pure-Node content-plan measurement
separated the parser side: 128,888 characters / 2,500 top-level blocks took
about 426 ms initially, and a tail append still took about 276 ms because
remark parsing was full-document O(N). The first 2,499 block IDs remained
stable. That measurement is the before-boundary below, not the current append
result.

### Source-bounded 100k Markdown attribution

This attribution used an immutable `/tmp` source snapshot rather than the
concurrently changing list worktree. Its SHA-256 boundary was:

- `src/model/content-plan.js`: `e760a2fbfc540a6c6495686f004606f83ba647bff8c18056dad87103afe2aafb`
- `src/ui/MarkdownContent.jsx`: `722677e465da4e1a93c69a3219b158627660858842bf9910465815178f07fa65`
- `src/ui/ContentPlanBlocks.jsx`: `54779eac5330ee434ac8c9bf39c444dd417a976b31dbc0cb1239e0aab4b339f8`
- `src/ui/MermaidBlock.jsx`: `392cd285f2c890ab281ca7e95bdd29fe09fe3b0772a1c01aec421d8212ce3d69`

The generated sample was 101,197 characters. Its requested 320 content chunks
became 366 top-level Markdown blocks because section headings are separate AST
blocks. It contained links and emphasis, but no math and no Mermaid diagrams.

| Phase | Observed result | Attribution |
|---|---:|---|
| Browser `createContentPlan`, initial | 179.7 ms median | Full-document unified parse plus matching/freezing |
| Browser `createContentPlan`, append a block | 168.2 ms median | Still reparses the complete document; one block inserted and one state-updated |
| Browser `createContentPlan`, grow active tail | 167.6 ms median | Still reparses the complete document; only one block is render-updated |
| Browser `createContentPlan`, identical source | 0–0.1 ms | The exact-source early return works |
| Node full unified parse/run | 219.1 ms median | Parser/plugins alone |
| Node complete initial plan | 229.4 ms median | Matching, identity and freezing add only about 10 ms; they are not the hotspot |
| Node current per-block `ReactMarkdown` SSR | 379.2 ms median | 366 block strings are independently parsed and rendered after the plan already parsed the full source |
| Node one changed tail block | 2.15 ms median | Block memoization is effective after planning |
| Browser production fixture | 950 ms task time; 786.6 ms script, 21.9 ms layout, 15.2 ms style | The main cost is synchronous JavaScript, not measurement or paint |
| Browser materialization | 2,989 elements; 7,825 added DOM/text nodes | One message is not bounded by row virtualization |

The same standalone `MarkdownContent` mounted through a concurrent React root,
without the fixture's `flushSync`, still produced a 785 ms long task. The
result is therefore not explained away by synchronous list installation.

The exact repeated-work boundary is:

1. Every changed source string enters `parsedBlocks`, which invokes
   `processor.parse` plus `runSync` over the full document. Append-only token
   growth, a new tail block and a middle edit all pay this cost.
2. On initial mount, every `ContentPlanBlock` then gives its string
   `renderSource` to a separate `ReactMarkdown`, parsing the already parsed
   content again. Normal tail growth preserves block identity and only this
   final block rerenders, but the full-document plan parse still occurs first.
3. A document-global reference-definition edit intentionally changes every
   block's `dependencyRevision`; all 366 blocks become updated and rerender.
   That conservative invalidation is correctness behavior, not accidental
   memo failure.
4. Mermaid and KaTeX did not contribute content work in this sample. A
   separate simple Mermaid profile took 415 ms cold wall time / 202 ms CPU and
   123 ms warm wall time / 27.5 ms CPU; its source-keyed cache was effective
   and it produced no individual task over 50 ms in that run.

A prototype using the already processed mdast, followed only by
`remark-rehype`, `rehype-katex` and `hast-util-to-jsx-runtime`, rendered all 366
blocks to server markup in 95.8 ms median versus 379.2 ms through 366
`ReactMarkdown(string)` calls. This is an isolated feasibility measurement,
not production admission; URL transformation, raw-HTML behavior, custom
components and DOM identity still require parity tests.

### Append suffix-parser independent re-sign

The strict append suffix path was independently re-measured at
`src/model/content-plan.js` SHA-256
`2c4db483f9a6df48783d25b9d8871dbb4a998aba0e0941223f67cf8a3b5843e6`;
the hash was identical before and after every reported run. The sample and
production rendering chain are the same 101,197-character / 366-block case
used above.

| Current operation | Observed result | Decision |
|---|---:|---|
| Grow the active tail | 7.58 ms Node median (5.57–9.86 ms); 318 characters parsed; one block updated | Passes the 50 ms target in this directed parser measurement; about 22–29× faster than the previous full parse |
| Append a new block | 7.43 ms Node median (5.11–8.90 ms); 332 characters parsed; one prior block state-updated and one inserted | Passes the directed parser target |
| Append a document-global definition | 232.84 ms; suffix inspection followed by full fallback; 101,573 characters parsed; all 366 dependent blocks updated | Intentionally remains over budget to preserve reference correctness; this is not an optimization miss that may be hidden |
| Append to an unclosed fence | 6.43 ms; 331 characters parsed; one block updated and one inserted | Directed pass |
| Production `MarkdownContent`, append 96 characters | 40 ms wall; 23.54 ms CDP Task / 16.72 ms Script; no long task; nine DOM/text nodes added | Directed browser pass. First sealed block and text node remained the exact same objects, its render revision stayed `1`, and native selection remained connected and unchanged |
| Production `MarkdownContent`, initial mount | 968 ms wall; 961.67 ms Task / 890.15 ms Script; 810 ms maximum long task; 2,973 elements | Still fails. The suffix path does not reduce cold initial parse/render work |

Correctness was checked against the immutable pre-optimization implementation,
which serves as an always-full-parse oracle. A 1,024-step mixed Markdown append
stream matched the complete plan projection at every step. A separate
320-step valid multi-block stream used the suffix path 319 times and the full
path once and also matched exactly. The production-directed ContentPlan suites
passed 27/27. The comparisons include revision, serial, block kind/source,
semantic text, ranges, render source, dependency revision, block ID, state,
render revision and change sets; they do not merely compare visible strings.

This closes the ordinary continuous-append CPU gate only. It does not close
the cold long-message gate, and it does not authorize truncation, recycling an
already visible content block, or adding another virtualizer.

### Prepared-AST cold-path independent re-sign

The prepared-AST renderer was independently re-signed at these production
hashes, unchanged during all reported focused runs:

- `src/model/content-plan.js`: `7222ca121a844619d02841a1cdce02caae3abb3d3c26597893c4c64ac5049238`
- `src/ui/PreparedMarkdown.jsx`: `02d8d254bf124033f5e907fe5f53a38b8f666fb311fd666b85b96af16911953e`
- `src/ui/MarkdownContent.jsx`: `5cd6a3f4c9e18d67126578694d8cded9bb14e6e72271e6585ad9404fe5a3d141`

The same 101,197-character / 366-block source prepared all 366 blocks and used
no string fallback. Node medians were 170.39 ms for `createContentPlan`, 44.94
ms for mdast-to-HAST/JSX conversion, 9.31 ms for server rendering and 53.14 ms
for combined prepared conversion/rendering. The same-machine independent-block
`ReactMarkdown(string)` path took 370.04 ms. The prepared source chain contains
`remark-rehype`, `rehype-katex` and `hast-util-to-jsx-runtime`, but no
`remark-parse`; Chromium CPU sampling likewise showed one parse phase rather
than a parse per block.

Three fresh standalone Chromium mounts measured 647.1, 674.7 and 660.5 ms
wall time, with maximum long tasks of 500, 525 and 527 ms. The medians were
660.5 ms wall, 656.6 ms Task, 596.0 ms Script and 17.6 ms Layout, with the same
2,973 elements / 7,801 added DOM/text nodes. Against the prior 968 ms wall /
810 ms long-task sample, this is about a 32% / 35% improvement, but it still
fails the 50 ms responsiveness target. A production-adapter directed case also
passed paint and selection with a 571 ms maximum long task.

A 500-microsecond Chromium CPU profile attributed about 226 ms of sampled self
time to the one Markdown parse/plugin phase, 30 ms to prepared conversion, 67
ms to `react-dom`, about 89 ms to React JSX runtimes and 41 ms to garbage
collection. Because layout remained only about 18 ms, the remaining gate is
synchronous parser plus element/reconciliation/DOM construction, not Mermaid,
KaTeX or layout. These sampled buckets are diagnostic attribution, not
additive wall-clock accounting.

Extended differential rendering covered safe/unsafe URL and image protocols,
raw HTML, custom components, inline/block math, GFM, breaks, code, duplicate
and cross-block definitions, and mixed footnotes. Output matched the old
per-block string path exactly; footnote-reference/definition blocks used the
documented string fallback. The focused production suites passed 43/43.

The 4 MiB prepared-tree cache budget was also exercised. This sample carries a
conservative 2,311,974-byte weight while its independently measured retained
heap increment over the stripped plan was 1.373–1.376 MiB. One prepared plan
is retained. Adding a second strips the older derived tree and retains the new
one; restoring the stripped plan uses the string fallback while preserving all
block IDs. Mounted content keeps its committed prepared plan, so cache
eviction does not remove or remount visible DOM.

### Cold cached entry: production-bundle re-sign

The cold-channel traces under `docs/evidence/cold-loading-final` were captured
through Vite's development transform. They remain useful for phase ordering:
the cache batch was available before the remote hydrate completed, and the
remaining interval was projection/list materialization rather than network
latency. They are not a production-runtime CPU budget. In particular, the old
cached trace reported first body text at 364 ms, an 85 ms maximum long task and
a 136 ms maximum animation-frame gap, while a directed CPU profile attributed
about 229 ms sampled self time to React's development-only `jsxDEV` path.

The same `deep-history-delayed` seed and real IndexedDB population path were
therefore rerun against a production bundle at the following immutable source
boundary. Pre-build and post-run hashes were identical:

- `src/app/hooks/useChannelFeed.js`: `14132be9989139ef00750f2480b654bebc2a51c18ab4d63265771803cce84d7e`
- `src/model/history-scheduler.js`: `e7ccfcae5cff322299058ade6db7927d25131dc8236b88ddf4522042e065ccf0`
- `src/model/timeline-projection.js`: `f5b7aeed664886e7350fd4fbbc5148e16cd7bb3bde985898dff3713c50c3b712`
- `src/model/conversation-presentation.js`: `74660ae045252d909f4364ba934e7568c68c950875a3c36fc44db5679c6e7a98`
- `src/ui/Timeline.jsx`: `fe21393e2224444570881d63f49fa2a6bc3022d86ae59d6ece6b90ae47eae455`
- `src/ui/timeline/useReadingSession.js`: `0c998c5d2b2813dedc3a6d209bde4af96ebae5f5b300e7d81ab1f91dce7278f7`
- `src/ui/timeline/LegendMessageList.jsx`: `f1c51251895380ccc16777e578d3b1ce90c12498bdb56edfeef318e45db44d04`
- `src/ui/MarkdownContent.jsx`: `5cd6a3f4c9e18d67126578694d8cded9bb14e6e72271e6585ad9404fe5a3d141`
- `src/ui/PreparedMarkdown.jsx`: `02d8d254bf124033f5e907fe5f53a38b8f666fb311fd666b85b96af16911953e`

Two immediately adjacent five-run samples exposed host-load sensitivity that
must not be hidden by reporting only the faster sample. The first bodies in
the first sample appeared at 167.7, 385.6, 327.3, 454.6 and 163.4 ms (median
327.3 ms); three runs contained 56–92 ms Long Tasks. The unchanged-source
repeat immediately afterwards measured 149.9, 172.8, 134.0, 143.3 and 141.2
ms (median 143.3 ms), with no Long Task. The pooled ten-run midpoint was about
165.6 ms, but the bimodality is more informative than that aggregate. Host load
average observed after the slow sample was 4.76, so this is scheduling/load
sensitivity, not evidence that the final Timeline change itself regressed the
path. An isolated A/B would be required for that attribution.

Every one of the ten sampled target-channel journeys contained either progress
or body content; there were zero false-empty frames and zero frames with
neither feedback nor body. Even the 454.6 ms outlier did not stick or require a
re-entry. The largest animation-frame interval was 136.1 ms in the noisy set
and 33.9 ms in the repeat. First paint materialized seven or eight rows,
11–13 Markdown blocks and 379–416 DOM elements. Cumulative CDP work through one
post-readable frame spanned 159–631 ms Task, 82–326 ms Script, 8–48 ms Layout
and 10–30 ms style recalculation; these cumulative values span multiple yield
points and include host contention, so they are not individual blocking tasks.

The production evidence is in
`docs/evidence/cold-performance-final/cold-entry-production.json` (noisy-set
SHA-256 `b34edb4fae9c0ab6d87d6356f3487e0f6399fed0798194da17b82e0449e2dbbf`)
and `cold-entry-production-repeat.json` (repeat SHA-256
`5090a206dcc4a51e22c5dd7239cdfa5b3c4b729b1c60198e311cc58c9355a499`).
Both embed identical before/after source digests. Together they prove that this
cached-entry case no longer presents a user-visible blank or stuck
initialization, but they do not prove an unconditional no-Long-Task budget on a
contended shared host. The difference from the old development trace is an
environment and source-boundary comparison, not a claimed production-code
speedup.

A render-commit probe on the immediately preceding development snapshot saw
51 commits during the observed channel transition, including an initial 11-row
materialization that settled to eight. That is retained as a later efficiency
risk, not promoted to a release blocker: the production repeats have no visible
continuity failure, and reducing the estimate or buffer without restoration /
selection evidence would trade a measured good result for geometry risk. The
current presentation model itself is not the cold-entry hotspot: at
the production presentation hash above, fresh evaluate-and-commit measured a
0.46 ms median / 1.43 ms p95 for 15 realistic rows and 1.05 ms median / 2.81 ms
p95 for 42 rows.

## Actionable hotspots

1. Long Markdown remains the first priority. Ordinary append suffix parsing is
   independently closed, and prepared mdast removes the per-block second parse
   with semantic parity and a conservative 4 MiB derived-tree budget. Cold
   rendering nevertheless retains a roughly 500–527 ms long task. The next
   evidence boundary is the single full-document parser plus React/JSX/DOM
   construction; do not add a second virtualizer, truncate content, or recycle
   visible blocks to manufacture a green number. Any cooperative/progressive
   commit proposal must first prove stable block identity, selection and row
   geometry and must not expose incomplete content as settled.
2. Retain semantic restoration as a permanent admission. The fixed contract is
   that `initialTopMostItemIndex` stays data-relative even with a nonzero
   `firstItemIndex`; the 100k test must keep verifying actual row-50,000 paint,
   hit-test and native selection so a tail-clamping regression cannot pass on a
   bounded tail DOM alone.
3. A 100k `data` replacement still walks/reindexes the complete array.
   Preserve incremental page publication and stable row identity in product.
   If a real workflow can replace the complete 100k array, move preparation
   off the interaction task or introduce cooperative publication. DOM
   virtualization alone does not fix the 111–114 ms source-bounded tasks (or
   the 444 ms pre-transition baseline).
4. Give WaitingLayer a declared product bound. Either make a small upstream
   queue maximum contractual and test it, or virtualize/window the `<li>` rows
   while preserving controls and accessibility. Do not infer a production
   bound from the mock's capacity of eight.
5. Treat development and production cold-entry profiles separately. The final
   production cached case is closed for visible continuity: ten of ten runs
   maintained feedback and reached real body content without re-entry. It is
   not closed as an unconditional Long-Task budget: one contended five-run set
   had three slow cases, while its unchanged-source repeat had none. Keep both
   samples in release evidence and revisit commit churn only with an isolated
   production A/B if the shared-host tail is a product requirement. Do not tune
   `defaultItemHeight`, overscan or viewport buffers from the development-only
   count: those values participate in bookmark restore, prepend compensation
   and selection stability. The standalone 500+ ms long-Markdown task remains
   a separate, content-shaped risk and must not be used to explain a channel
   that is stuck on an initialization obligation.
6. Keep cache and memory budgets separate. IndexedDB growth can be healthy
   while live JS state leaks, and forced-GC heap can be flat while encoded
   cache approaches its global limit. Both oracles stay in the test.

## Reproduction

```bash
npx playwright test tests/browser/performance-budget.spec.js --reporter=list
```

For a focused 100k adapter run:

```bash
npx playwright test tests/browser/performance-budget.spec.js --grep 'materializes, paints' --reporter=list
```

Each case attaches JSON evidence. The 100k case also attaches a screenshot of
the actual non-tail range. Catastrophic-safety assertions passed at the
recorded immutable boundaries, but subsequent list edits require a new 100k
re-sign and the main-thread responsiveness target remains red. A green safety
case means only that its explicit ceilings passed on that machine; it does not
replace a physical-device run, total-process memory sampling, real
backend/storage latency or a full browser regression pass.
