# E–H R33 — Composer/F5 red contracts and F7 TC0207–TC0211

Date: 2026-09-20 (Asia/Singapore)

Baseline: `fae8b70` (`fae8b7010afd1b3a950bc455ba6a577b65378cda`). The shared
source advanced while this round was running; the first Composer rerun observed
`368e2c9`, and the report was written at `e59f42d`. The browser runs below use
fresh web/mock ports and retain the exact first public failure. This round only
adds tests and this audit; no `src/`, vendor, package, or lockfile was edited or
staged.

The old action is not considered covered by a neighboring row. Every case below
records its own capability, invariant, public owner, full action, and first
observable. The F7 cases are one-to-one successors; the two history cases keep
the original visible and compositor assertions even when the current product
fails before later assertions.

## 1. Composer shell candidate — three accepted, one rejected

Command for the strict target group:

```text
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16610 ATOLL_TEST_MOCK_PORT=20010 \
  npx playwright test tests/browser/f3-composer-target.spec.js --reporter=line --workers=1 \
  --output=test-results-e-h-r33-composer-target
```

Result: **4 passed**, consisting of the existing CT-01 plus TC-0169, TC-0170,
and TC-0171. This is a strict user-action run; the current working-tree
Workspace/ConversationSurface candidate supplies filter provenance and does not
change the old mention/no-recipient assertions.

### TC-0169 — ACCEPT / PROVEN-DIRECT

- **Old behavior and capability:** `fae8b70:tests/browser/f3-composer-target.spec.js:48`, “过滤条收窄到一个 agent 时，默认收件人跟着它走”. Clicking the public one-agent filter must make Composer follow that agent, expose `@Claude`, title `跟随筛选`, and clear the source on filter removal.
- **Invariant:** an explicit filter selection is a distinct Composer authority; it must not be relabeled as a direct mention or lose provenance on clear.
- **Current public owner:** filter controls are [ConversationSurface.jsx:283](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:283); the public handoff is [WorkspaceApp.jsx:895](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:895), with Composer status rendered by [Composer.jsx:200](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:200).
- **Exact action/observable:** reset `multi-channel`, login, click the second public member filter, assert recipient text/title/class, clear the filter, and assert the filter-derived source disappears. The unchanged successor passed.
- **Disposition:** `ACCEPT`; no later sub-assertion was omitted.

### TC-0170 — ACCEPT / PROVEN-DIRECT

- **Old behavior and capability:** `fae8b70:tests/browser/f3-composer-target.spec.js:65`, “编辑框里的 @ 压过筛选”. After a filter-selected recipient is visible, typing `@` and choosing another public actor must override the filter, show `由 @ 指定`, and leave exactly one recipient chip.
- **Invariant:** explicit mention/reply authority outranks the inherited filter authority; the filter must not reappear after the mention selection.
- **Current public owner:** public mention query/selection remains Composer at [Composer.jsx:200](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:200), while filter provenance enters through [WorkspaceApp.jsx:895](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:895).
- **Exact action/observable:** unchanged filter → `@` → actor selection sequence, then title/source and one-chip assertions. The successor passed.
- **Disposition:** `ACCEPT`; the explicit override phase was executed, not inferred from TC-0169.

### TC-0171 — ACCEPT / PROVEN-DIRECT

- **Old behavior and capability:** `fae8b70:tests/browser/f3-composer-target.spec.js:82`, “无收件人是警告格，不是留白”. Entering a no-recipient channel must leave a stable warning (`⚠ 无收件人`), recipient status `is-none is-muted`, actionable title, and stable banner geometry.
- **Invariant:** lack of recipient is an explicit capability state, never an empty/absent Composer surface.
- **Current public owner:** access/placeholder selection is [WorkspaceApp.jsx:837](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:837); Composer warning rail is [Composer.jsx:444](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:444).
- **Exact action/observable:** reset/login, click public `c0.public`, assert the full warning/status/title/geometry contract. The successor passed.
- **Disposition:** `ACCEPT`; generic access-placeholder behavior was not used as a substitute.

### TC-0173 — REJECT / REGRESSION / MISSING PUBLIC OWNER

- **Old behavior and capability:** `fae8b70:tests/browser/f3-dynamic.spec.js:40`, “键盘、多行草稿、附件入口与 320px 单表面可达”. A multiline draft must survive opening/closing the public channel-file picker; the user then returns to 动态, sends to steward, and reaches the turn on a 320px surface without horizontal overflow.
- **Invariant:** the channel-file picker is a public Composer action and must not be replaced by local upload, a private Files selector, or a draft-clearing route.
- **Current public owner:** Composer attachment control is [Composer.jsx:436](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:436); the existing public picker surface is [WorkspaceFeatures.jsx:66](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:66), but no Composer command exposes it.
- **Exact action/observable:** reset `long-running/1302`, login, type both historical lines, click unchanged public `从频道文件选择`, then run the original picker-return-send-320px assertions. The run timed out before the button appeared; no later draft/send assertion was claimed. Evidence: [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-tc0173/f3-composer-baseline-0172--59cca-5-键盘、多行草稿、附件入口与-320px-单表面可达/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION`; Composer owner must expose the existing public picker or obtain a product decision, then rerun the whole sequence.

## 2. F5 TC0192–TC0195 — four independent owner packets

The strict successor is [f5-governance-baseline-0191-0195.spec.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:55). Each case was run independently with fresh ports after the governance candidate. All four remain open; later assertions are explicitly unproven when an earlier public capability is missing.

### TC-0192 — REJECT / Governance channel-create owner

- **Old behavior/capability:** `fae8b70:tests/browser/f5-management.spec.js:40`, independent `新建频道` dialog, name entry, four confirmed stages (`账本确认`, `频道可观察`, `成员关系`, `服务就绪`), then enter the created channel.
- **Invariant:** the public rail action must preserve an independent modal/focus owner and all four durable stage observables; the current overview side panel is not semantically equivalent.
- **Current public owner:** rail entry [WorkspaceLayout.jsx:93](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:93) → route [WorkspaceLayout.jsx:325](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:325) → `ChannelAdministrationPanel` [GovernanceFeature.jsx:220](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:220).
- **Exact action/observable:** reset `channel-governance/1502`, login, click public `新建频道`, require `role=dialog name=新建频道` before typing. The dialog is absent immediately. Evidence: [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-tc0192/f5-governance-baseline-019-e042e-5-003-新建频道是独立-Modal-并保持四步收敛/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION`; do not migrate to the overview form.

### TC-0193 — REJECT / Activity → WorkItem owner

- **Old behavior/capability:** `fae8b70:tests/browser/f5-management.spec.js:55`, the canonical `Approve mock actionc0` Activity row is deduplicated, click opens its source WorkItem detail, and URL is `channels/c0/tasks?focus=work_item`.
- **Invariant:** a visible Activity row must carry a canonical source identity and a public navigation action; row presence alone is not completion.
- **Current public owner:** Activity row projection/click [WorkspaceFeatures.jsx:41](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:41), source projection [WorkspaceApp.jsx:1197](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1197), callback [WorkspaceApp.jsx:1292](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1292), detail owner `openTaskItem` [WorkspaceApp.jsx:783](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:783).
- **Exact action/observable:** reset `approval-schema/1503`, login, open Activity, require one row, click it, require `工作项详情` and exact focus URL. Row count passed; detail never appeared. Evidence: [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-tc0193/f5-governance-baseline-019-513a1--Activity-去重并返回-WorkItem-来源/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION`; preserve dedupe and route both, then rerun.

### TC-0194 — REJECT / Governance creation → Operation Center owner

- **Old behavior/capability:** `fae8b70:tests/browser/f5-management.spec.js:66`, create `operation-room` through the old channel-create flow, observe ledger confirmation, open Activity → 操作, select one durable operation, and return to the original channel turn/detail.
- **Invariant:** operation history must be durable and source-linked; a live activity snapshot or an overview form cannot substitute for the create receipt and return path.
- **Current public owner:** creation projection/submit [WorkspaceApp.jsx:1032](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1032), operation projection [WorkspaceApp.jsx:1218](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1218), public source callback [WorkspaceApp.jsx:1292](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1292).
- **Exact action/observable:** reset `channel-governance-delay/1504`, login, click `新建频道`, fill the historical modal name input. The modal/input never appears; timeout occurs before operation assertions. Evidence: [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-tc0194/f5-governance-baseline-019-e21a6--Operation-Center-并可回到原频道回合/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION`; later operation/return observables remain unproven.

### TC-0195 — REJECT / Search → WorkItem/revocation owner

- **Old behavior/capability:** `fae8b70:tests/browser/f5-management.spec.js:86`, global search returns to `c0.project` Tasks with WorkItem detail and exact focus URL; revocation removes detail, makes Tasks inaccessible, and removes the repeated cached search result.
- **Invariant:** search must preserve canonical WorkItem identity across navigation, and revoked capability must invalidate both visible detail and cached search projection.
- **Current public owner:** result UI [SearchFeature.jsx:10](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/search/SearchFeature.jsx:10), source identity [feature-search.js:312](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/feature-search.js:312), dispatch [WorkspaceApp.jsx:1253](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1253), detail owner [WorkspaceApp.jsx:783](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:783).
- **Exact action/observable:** reset `multi-channel/1505`, login, open search, query `c0.project history 1`, require one result, click, require `c0.project`, WorkItem detail, and focus URL before revocation. Result and heading passed; WorkItem detail was absent. Evidence: [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-tc0195/f5-governance-baseline-019-53ff5-搜索恢复频道、视图和-focus，权限撤销后不泄漏缓存/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION`; revocation/no-cache half remains unproven, not green by row/heading presence.

## 3. F7 next five: TC0207–TC0211

### TC0207 — ACCEPT / PROVEN-DIRECT

- **Old behavior/capability:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:224`, mobile channel drawer keeps a live Agent timer visible, bounded within 320/390px, and actionable after completion/filter acknowledgement.
- **Invariant:** live activity is keyed by channel/request/current generation; mobile drawer geometry cannot clip the timer, and completion cannot leave a zombie active filter/dot.
- **Current public owner:** activity projection [channel-feed-runtime.js:474](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:474), explicit acknowledge [channel-feed-runtime.js:1620](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1620), rail timer [WorkspaceLayout.jsx:67](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:67), actor filter [ConversationSurface.jsx:283](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:283).
- **Exact successor/action:** [f7-notification-baseline-0207-0208.spec.js:36](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-notification-baseline-0207-0208.spec.js:36): viewport 320×720, reset `long-running/2615`, public Agent-menu select steward, send, open drawer, assert one visible timer and item/timer/document geometry at 320 and 390, close drawer through current `c0`, advance three frames, select settled steward, require `aria-pressed=true`, no activity dot, width≤320.
- **Evidence:** `ATOLL_TEST_WEB_PORT=16617 ATOLL_TEST_MOCK_PORT=20017 ... f7-notification-baseline-0207-0208.spec.js` passed 2/2; an independent repeat-3 run at `16622/20022` passed **6/6**. This is the complete old sequence, not a suite-count inference.
- **Disposition:** `ACCEPT / PROVEN-DIRECT`.

### TC0208 — ACCEPT / PROVEN-DIRECT

- **Old behavior/capability:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:280`, on a touch mobile surface the first Agent filter tap selects visibly and the second tap clears it visibly.
- **Invariant:** toggle state and visual state must be symmetric; a second trusted tap cannot leave stale selected styling.
- **Current public owner:** touch/filter control [ConversationSurface.jsx:283](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:283), Agent state/public projection [channel-feed-runtime.js:474](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:474).
- **Exact successor/action:** [f7-notification-baseline-0207-0208.spec.js:89](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-notification-baseline-0207-0208.spec.js:89): touch 390×844, reset `multi-channel/2616`, login, first public filter, capture idle background, tap once and require `aria-pressed=true` plus changed background, tap again and require `aria-pressed=false` plus exact idle background.
- **Evidence/disposition:** same 2/2 run plus repeat-3 6/6 Chromium run passed; `ACCEPT / PROVEN-DIRECT`.

### TC0209 — ACCEPT / PROVEN-DIRECT successor owner

- **Old behavior/capability:** `fae8b70:tests/browser/f7-history-cache.spec.js:3`, IndexedDB cache retains newest bounded tail after quota pressure, retries the write, and redacts the persisted secret token.
- **Invariant:** the cache contract belongs to the current Replica owner, not the removed `createFeedCache`/per-test database. Quota recovery must retain rows 8–15, and redaction must survive reload/read.
- **Current public owner:** [createChannelReplicaCache](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:847), with production Feed construction [channel-feed-runtime.js:359](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:359). The exact browser successor is [f7-history-cache.spec.js:13](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-cache.spec.js:13).
- **Exact action/observable:** public successor opens `createChannelReplicaCache`, ensures owner/world, writes rows 1–8, injects one real `QuotaExceededError` on seq 9, retries/appends 10–15 with coverage, reopens the cache, and requires `failed=true`, no thrown error, seqs `[8..15]`, and persisted token `已隐藏`.
- **Evidence:** `ATOLL_TEST_WEB_PORT=16616 ATOLL_TEST_MOCK_PORT=20016 ... f7-history-cache.spec.js` passed 1/1; an independent repeat-3 run at `16623/20023` passed **3/3**. The historical removed import was not treated as an executable owner.
- **Disposition:** `ACCEPT / PROVEN-DIRECT`.

### TC0210 — REJECT / Reading + notification boundary

- **Old behavior/capability:** `fae8b70:tests/browser/f7-history-water.spec.js:216`, deep history starts at tail without background reservoir movement, physical upward scrolling reaches history 1, then a realtime pulse exposes a new-dynamic control that can be clicked to show `c0 动态 #1`; bounded cache remains ≤5,000 rows.
- **Invariant:** background history admission cannot move a following reader; only trusted upward input may claim the reservoir; the pulse/live arrival must remain a visible notification while browsing, and the bounded current Replica cache cannot grow without limit.
- **Current public owner:** reading/history admission [useHistoryConsumer.js:92](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:92) and projection owner [useConversationProjection.js:137](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:137); notification classification [notification-policy.js:43](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/notification-policy.js:43), unread/public rail projection [channel-feed-runtime.js:724](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:724).
- **Exact successor/action:** [f7-history-water-baseline-0210-0211.spec.js:51](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0210-0211.spec.js:51): reset `deep-history/1707`, login, require history 120 and tail gap≤24 for six 100ms samples, wheel upward 30 times to history 1, require no invalid top dispatch, pulse, require the public `/条新动态/` button, click it, require `c0 动态 #1`, and require current Replica DB row count≤5,000.
- **First red/evidence:** history 1 and tail geometry passed, but after pulse the public new-dynamic button never appeared; timeout at the exact old notification observable. Evidence: [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-f7-0210-0211/f7-history-water-baseline--d56c3-il-and-admits-realtime-live/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION`; hand to Reading/live-arrival notification owner. The cache assertion and later click were not counted as proven.

### TC0211 — REJECT / Reading runway/admission owner

- **Old behavior/capability:** `fae8b70:tests/browser/f7-history-water.spec.js:271`, mixed-height upward runway demand releases bounded raw history into the production list while preserving compositor coverage and never issuing a post-user `reading.issuer-write`.
- **Invariant:** one public reading owner admits at most 8 rows/262,144 bytes per runway, settles the same channel/epoch/anchor, keeps rows visible every frame, and never fights the user's wheel with a writer. DOM/rAF alone cannot replace compositor paint evidence.
- **Current public owner:** demand/intent [useHistoryConsumer.js:435](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435), mounted reading projection [useConversationProjection.js:137](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:137), public list [ConversationSurface.jsx:64](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:64).
- **Exact successor/action:** [f7-history-water-baseline-0210-0211.spec.js:97](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0210-0211.spec.js:97): reset `mixed-height-history/1730`, login, require history 120 and scrollable list, capture region and rAF frames, start Chromium screencast, wheel upward until runway intent, wait exact same channel/epoch/anchor settle, capture diagnostics/frames/paint, and retain all old bounded-release/no-writer/no-empty-frame/paint thresholds.
- **First red/evidence:** runway intent and settle occurred and 16 compositor frames were captured, but current diagnostics expose `history.admission_commit_check` with inserted IDs rather than the old `history.projection_checked` release witness. The strict `checks.length > 0` assertion therefore failed at line 240; no diagnostic rename was silently accepted as semantic proof. Evidence and paint frames: [history-runway-production-evidence.json](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-f7-0210-0211/f7-history-water-baseline--7d589-ry-into-the-production-list/attachments/history-runway-production-evidence-json-7bc3485a2bb5e5439f03a0f9126b324803442f5a.json:1), [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r33-f7-0210-0211/f7-history-water-baseline--7d589-ry-into-the-production-list/error-context.md:9).
- **Disposition:** `REJECT / REGRESSION/contract evidence gap`; current Reading owner must publish a public equivalent of the bounded release witness or provide a reviewed successor mapping. The old release/no-writer/paint contract remains open.

## Round disposition

| group | result |
|---|---|
| Composer TC0169/0170/0171 | 3 strict ACCEPT; one command also includes CT-01 |
| Composer TC0173 | 1 REJECT: missing public channel-file action |
| F5 TC0192–0195 | 4 independent REJECT packets |
| F7 TC0207/0208/0209 | 3 strict ACCEPT / PROVEN-DIRECT |
| F7 TC0210/0211 | 2 strict REJECT packets |

No case was deleted, skipped, weakened, or merged by count. No new product
owner, compatibility API, private export, or source change was added.
