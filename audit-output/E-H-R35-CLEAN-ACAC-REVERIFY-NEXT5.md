# E–H R35 clean-acac strict re-verification and next F7 baseline

Date: 2026-09-20
Product runtime: clean detached `acac6c8` (no shared working-tree product changes)
Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

The clean run was made in a detached worktree. Two successor test files that
were present in the shared test workspace but not committed at `acac6c8`
(`f3-composer-target.spec.js` and `f7-history-cache.spec.js`) were copied into
that temporary worktree as test inputs only; no source/product file was copied
or changed. The shared repository's subsequent `74c85fa` picker-test commit
does not alter the product verdict below.

## Clean candidate matrix

| Cases | Exact run | Result | Disposition |
|---|---|---:|---|
| TC-0169..0171 | Composer target successor, clean `acac6c8` | 4/4 PASS | ACCEPT independently per case |
| TC-0172..0173 | Composer baseline successor, clean `acac6c8` | 2/2 PASS | ACCEPT independently per case |
| TC-0192..0195 | F5 governance successor | 2 PASS / 2 RED | 0192/0193 ACCEPT; 0194/0195 remain open |
| TC-0207..0208 | F7 notifications, `--repeat-each=3` | 6/6 PASS | ACCEPT independently per case |
| TC-0209 | F7 cache, `--repeat-each=3` | 3/3 PASS | ACCEPT; current Replica cache owner |
| TC-0210..0211 | F7 history-water successor | 0/2 PASS | Both remain red at their old first observables |
| picker focus trap | public picker contract | 0/1 PASS | **REJECT**: Tab leaves dialog |
| TC-0217..0221 | next F7 successor, clean `acac6c8` | 2 PASS / 3 RED | 0217/0221 ACCEPT; 0218/0219/0220 remain open |

No result below relies on a suite count. Each case keeps its own old setup,
public user action, and observable.

## Composer 0169–0173

Old sources: `fae8b70:tests/browser/f3-composer-target.spec.js:48,65,82` and
`fae8b70:tests/browser/f3-dynamic.spec.js:18,40`. Current successors are
[`f3-composer-target.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:22)
and [`f3-composer-baseline-0172-0175.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:22).

- **TC-0169 — ACCEPT / PROVEN-DIRECT.** User capability: narrowing the public Agent filter follows that Agent in Composer, and removing the filter clears the fallback. Invariant: filter provenance is only a fallback; the public status source and chip must change with it. Owner: [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282) → [`WorkspaceApp.jsx:897`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:897) → Composer status [`Composer.jsx:200`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:200). Old action/result is independently green.

- **TC-0170 — ACCEPT / PROVEN-DIRECT.** User capability: a public `@` selection overrides a filter-selected Agent and leaves one explicit chip. Invariant: explicit mention provenance wins over filter fallback. Owner: Composer mention selector [`Composer.jsx:200`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:200), with WorkspaceApp filter provenance [`WorkspaceApp.jsx:897`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:897). The full filter-then-mention sequence passed.

- **TC-0171 — ACCEPT / PROVEN-DIRECT.** User capability: a no-recipient channel shows a stable warning state rather than disappearing Composer. Invariant: `⚠ 无收件人`, `is-none is-muted`, actionable title, and geometry remain public. Owner: WorkspaceApp capability selection [`WorkspaceApp.jsx:837`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:837) → Composer warning rail [`Composer.jsx:444`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:444). Full old action/result passed.

- **TC-0172 — ACCEPT / PROVEN-DIRECT.** User capability: send a message and see the settled Agent bubble in place. Invariant: user text remains; no edit/stop/retry controls or synthetic turn label appears; process records remain inspectable. Owner: Composer send [`Composer.jsx:283`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:283) plus current timeline turn renderer. The independent successor passed.

- **TC-0173 — ACCEPT / PROVEN-DIRECT.** User capability: preserve a multiline draft across the public channel-file picker, return to 动态, send, and remain reachable on a 320px surface. Invariant: picker open/close cannot erase either draft line; current Composer/WorkspaceApp/overlay owners must preserve draft and width. Owners: Composer command [`Composer.jsx:410`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:410), picker port [`WorkspaceApp.jsx:463`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:463), overlay [`WorkspaceFeatures.jsx:299`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:299). Clean candidate passed the complete old sequence.

Clean commands: target 4/4 at ports `16650/20050`; baseline 2/2 at
`16649/20049`. The older shared-Vite stale-button run is retained in R34 as
race evidence, but the isolated clean result is the acceptance result.

## F5 0192–0195

Old sources: `fae8b70:tests/browser/f5-management.spec.js:40,55,66,86`;
successor [`f5-governance-baseline-0191-0195.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:55).

- **TC-0192 — ACCEPT / PROVEN-DIRECT.** Capability: independent `新建频道` modal, name entry, four confirmed stages, then enter the created channel. Invariant: modal/focus lifecycle and all stage observables cannot be replaced by a side-panel shell. Owner: [`GovernanceFeature.jsx:278`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:278) mounted by [`WorkspaceFeatures.jsx:281`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:281). Clean `channel-governance/1502` completed every old assertion.

- **TC-0193 — ACCEPT / PROVEN-DIRECT.** Capability: one canonical Activity row opens its WorkItem source and exact focus URL. Invariant: Activity deduplication and WorkItem identity are one public route, not a text-only row. Owners: Activity row [`WorkspaceFeatures.jsx:107`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:107), callback [`WorkspaceApp.jsx:1292`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1292), detail [`WorkspaceApp.jsx:783`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:783). Clean `approval-schema/1503` passed row, detail, and URL.

- **TC-0194 — REJECT / PRODUCT REGRESSION.** Capability: after `operation-room` creation, Activity → 操作 exposes one durable `创建频道 operation-room` row and returns to the original turn. Invariant: create request identity must survive operation projection and source navigation. Owners: Governance port [`WorkspaceApp.jsx:1153`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1153) and operation projection [`WorkspaceApp.jsx:1326`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1326). Clean run reached modal close and ledger confirmation, then strict line 94 resolved zero operation buttons. Evidence was the unchanged first red; no return assertion is counted.

- **TC-0195 — REJECT / STRICT CONTRACT GAP.** Capability: search restores channel/Tasks/WorkItem/focus, then revocation removes detail, Tasks capability, and cached search result. Invariant: canonical identity survives navigation but revoked capability invalidates every public projection. Owners: SearchFeature [`SearchFeature.jsx:10`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/search/SearchFeature.jsx:10), feature-search [`feature-search.js:398`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/feature-search.js:398), dispatch [`WorkspaceApp.jsx:1253`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1253). Clean run reached revocation, then the unchanged strict text assertion matched three legitimate public revocation surfaces and stopped. It was not narrowed to make green; downstream cache proof remains unclaimed.

Clean F5 command at `16651/20051`: **2 passed, 2 failed**.

## F7 0207–0211 and picker focus

- **TC-0207 — ACCEPT / PROVEN-DIRECT, repeat 3.** Capability: mobile drawer keeps Agent activity/timer visible, bounded, and actionable after channel return. Owner: feed activity [`channel-feed-runtime.js:474`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:474), acknowledge [`channel-feed-runtime.js:1620`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1620), mobile rail [`WorkspaceLayout.jsx:67`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:67). Clean repeat-3 was 6/6 for TC-0207/0208.

- **TC-0208 — ACCEPT / PROVEN-DIRECT, repeat 3.** Capability: first public Agent-filter tap selects; second tap clears visibly. Invariant: the public `aria-pressed`/visual transition is the authority. Owner: [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282) plus feed activity state. Exact touch sequence passed all repeats.

- **TC-0209 — ACCEPT / PROVEN-DIRECT, repeat 3.** Capability: quota pressure recovers the newest bounded IndexedDB tail and persists redaction. Invariant: Replica cache owns rows/meta/retry/redaction; removed `feed-cache` is not used. Owner: [`channel-replica.js:847`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:847), constructed by Feed at [`channel-feed-runtime.js:359`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:359). Clean repeat-3 was 3/3.

- **TC-0210 — REJECT / PRODUCT REGRESSION.** Capability: deep-history tail → history 1, then a true pulse exposes one actionable new-dynamic control. Invariant: history/progress publication stays silent; live arrival alone becomes actionable. Owners: history [`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435), projection [`useConversationProjection.js:137`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:137), notification policy [`notification-policy.js:43`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/notification-policy.js:43). Clean run's first red is the absent `/条新动态/` button after pulse.

- **TC-0211 — REJECT / PUBLIC-EVIDENCE GAP.** Capability: bounded runway release with compositor/nonblank proof and no post-user reading writer. Invariant: ≤8 rows/262,144 bytes per release, same channel/epoch/anchor settle, no `reading.issuer-write`. Owner: [`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435) → [`useConversationProjection.js:137`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:137). Clean run reached runway/settle/paint but emitted `history.admission_commit_check`, not the required `history.projection_checked`; no diagnostic rename was accepted as proof.

- **Picker focus trap — REJECT retained.** The direct public action is in [`composer-channel-file-picker-contract.spec.js:34`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/composer-channel-file-picker-contract.spec.js:34). Capability/invariant: after opening `从频道文件选择`, repeated Tab must remain inside the dialog and the modal must own focus. Clean `acac6c8` run at `16656/20056` failed unchanged at line 46 when `document.activeElement` left the dialog. This red is intentional evidence of the missing focus-trap owner; it was not removed, skipped, or weakened.

## Next unique baseline: TC-0217..0221

The old actions are from `fae8b70:tests/browser/f7-history-water.spec.js:1001,
1063,1103,1149,1167`; the independent successors are
[`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js:16).
These cases use only public filter/viewport/keyboard actions. No case writes
`localStorage` or manufactures an actor filter.

- **TC-0217 — ACCEPT / PROVEN-DIRECT.** Capability: after dense mixed rows are installed, public `只看我与 Claude 的往来` paints the already-installed Claude rows without foreground history UI or list geometry churn. Invariant: filter activation is a single-list presentation transition; it cannot claim a history demand or remount the viewport. Owner: actor filter [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282) plus projection [`useConversationProjection.js:137`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:137). Action: reset `deep-history/1736`, inject dense public server facts, login, click the visible Claude filter, sample rAF. Clean result: PASS.

- **TC-0218 — REJECT / PRODUCT-EVIDENCE GAP.** Capability: the Claude filter silently scans nonmatching physical pages until semantic Claude supply appears. Invariant: the initial filtered demand is anticipatory (`installedVisibleRows=0`, `actorFilterCount=1`), at least two physical pages complete, and no foreground loading UI is shown. Owner: [`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435) with filter/projection owner above. Action: reset `deep-history-delayed/1738`, inject 320 dense rows/20 tail, click public Claude filter, wait for `target claude question 2`. Clean and shared runs reach the target and start demand, but `history.batch_complete` count is zero; first red is the unchanged `>=2` assertion.

- **TC-0219 — REJECT / PRODUCT REGRESSION.** Capability: an empty Claude filter remains a partial/definitive empty state while warm history stays quiet and list geometry is stable. Invariant: no foreground demand/confirmation overlay is allowed to masquerade as an empty result; definitive EOF is explicit. Owner: filter [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282), empty/history projection [`useConversationProjection.js:522`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:522). Action: reset `deep-history-delayed/1737`, click public Claude filter, require both empty messages, sample 12 frames. Clean first red is the missing `当前已加载的动态里没有符合筛选的往来` public empty message; no geometry/quietness claim is promoted.

- **TC-0220 — REJECT / PUBLIC-DIAGNOSTIC GAP.** Capability: a committed under-filled 5,000px viewport creates history demand from the committed surface, not from an initial edge callback. Invariant: `history.viewport_underfilled` must identify an attached/current/bottom-ready list with rows and older history, then one intent starts. Owner: [`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435) and projection/list attachment [`useConversationProjection.js:137`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:137). Action: set viewport 1280×5000, reset `deep-history/1720`, login, await the exact diagnostic and inspect its fields. Clean first red: no `history.viewport_underfilled` event materializes within the bounded wait.

- **TC-0221 — ACCEPT / PROVEN-DIRECT.** Capability: focused main scroller `Home` reaches the physical top, creates exactly one top demand, and settles it. Invariant: keyboard input is owned by the focused public scroller; post-prepend anchoring may move the final offset, but the event must first reach `scrollTop=0` and cannot duplicate demand. Owner: focused reading controller [`useBrowsingReadingController.js:50`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:50) plus history consumer [`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435). Action: reset `deep-history/1721`, focus `.timeline-message-list`, press Home, require one `history.intent_started`, min scrollTop 0, and eventual satisfaction. Clean result: PASS.

Clean next-five command at `16658/20058`: **2 passed, 3 failed**.

## Manual-filter pollution guard

The older stale-incarnation filter probes in [`member-filter-timeline.spec.js:30`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/member-filter-timeline.spec.js:30) and [`ux-reading-evidence.spec.js:275`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/ux-reading-evidence.spec.js:275) write `atoll.view-session.v3.root` directly with `actorFilter: ['agent:steward:old-incarnation']`. Even if a browser run becomes green, that is a persisted-state probe, not the historical user's public filter action; it is **evidence-only / not promoted** and remains a red migration gap. R35's 0217–0219 successors deliberately use only the visible Claude filter button, so no manual storage pollution can make a case green.

## Final R35 disposition

Clean `acac6c8` strictly proves Composer 0169–0173, F5 0192–0193, F7
0207–0209, next F7 0217, and next F7 0221. F5 0194–0195, F7 0210–0211,
picker focus trap, F7 0218–0220, and manually seeded stale-filter probes remain
explicit red/open owner packets. No product change, compatibility owner,
private export, skip, deleted assertion, or merged-case substitution was used.
