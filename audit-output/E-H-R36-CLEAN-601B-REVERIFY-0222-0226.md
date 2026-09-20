# E–H R36 clean-19745da re-verification and F7 0222–0226 baseline

Date: 2026-09-20

Product candidate: clean detached `19745da` (includes the c2 picker/filter,
typed governance, and Composer materialization candidates). No source file was
copied or changed in the verification worktree.

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

This report keeps every old user action and observable in its own case. A
passing sibling is not used to close a failing case. The clean worktree used
the shared `node_modules` symlink only; no product file was edited.

## Clean candidate matrix

| Case packet | Clean run | Result | Disposition |
|---|---|---:|---|
| Composer target 0169–0171 | `f3-composer-target.spec.js` | 4/4 PASS | Accept each original target observable independently |
| Composer baseline 0172–0175 | `f3-composer-baseline-0172-0175.spec.js` | 4/4 PASS | Accept each case independently |
| F5 0192–0195 | `f5-governance-baseline-0191-0195.spec.js` | 2 PASS / 2 RED | 0192/0193 accepted; 0194/0195 remain open |
| F7 0207–0208 | `f7-notification-baseline-0207-0208.spec.js`, repeat 3 | 6/6 PASS | Accept each case and each repeat |
| F7 0209 | `f7-history-cache.spec.js`, repeat 3 | 3/3 PASS | Accept; Replica cache remains the public owner |
| F7 0210–0211 | `f7-history-water-baseline-0210-0211.spec.js` | 0/2 PASS | Preserve both original red observables |
| picker focus trap | `composer-channel-file-picker-contract.spec.js` | 1/1 PASS | Strict direct contract now passes on c2 candidate; no assertion was weakened |
| F7 0217–0221 | [`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js) | 1 PASS / 4 RED | 0217 accepted; 0218–0221 remain open |
| F7 0222–0226 | [`f7-history-water-baseline-0222-0226.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0222-0226.spec.js) | 2 PASS / 3 RED | 0222/0223 accepted; 0224–0226 remain open |

The picker result is a candidate change from the clean `acac6c8` run: the
unchanged public test now passes because the current modal owner uses
[`useModalFocus.js:53`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/primitives/useModalFocus.js:53)
to wrap Tab at the dialog boundary. This is a factual re-verification, not a
promotion of an old manual-storage probe.

## Composer 0169–0175

Old sources: `fae8b70:tests/browser/f3-composer-target.spec.js` and
`fae8b70:tests/browser/f3-dynamic.spec.js`. Current public successors are
[`f3-composer-target.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js)
and [`f3-composer-baseline-0172-0175.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js).

- **0169 — ACCEPT / direct.** Capability: a public Agent filter changes the Composer fallback recipient and clearing it removes that fallback. Invariant: filter provenance is fallback-only. Owner: [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282) → [`WorkspaceApp.jsx:897`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:897). Full public click sequence passed.
- **0170 — ACCEPT / direct.** Capability: an explicit public `@` recipient wins over the filter fallback. Invariant: explicit mention provenance wins. Owner: Composer mention path plus WorkspaceApp filter provenance. Full filter-then-mention sequence passed.
- **0171 — ACCEPT / direct.** Capability: a no-recipient channel keeps an actionable warning rail and stable geometry. Invariant: `⚠ 无收件人`, muted class, title, and surface remain public. Owner: [`Composer.jsx:444`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:444). Full old assertions passed.
- **0172 — ACCEPT / direct.** Capability: send and see the settled Agent bubble without synthetic controls or a synthetic turn. Owner: Composer send and timeline renderer. Full old send/observable sequence passed.
- **0173 — ACCEPT / direct.** Capability: preserve a multiline draft through the public channel-file picker and send on a 320px surface. Owner: Composer picker command, WorkspaceApp picker port, and overlay. Full old sequence passed.
- **0174 — ACCEPT / direct.** Capability: public `@` selection is represented by one recipient chip while body text remains plain. Owner: Composer mention selector. Full old body/chip assertions passed.
- **0175 — ACCEPT / direct.** Capability: Escape closes the mention list while the literal `@` remains writable and sendable. Owner: Composer editor and mention popup. Full old sequence passed.

## F5 0192–0195

Old source: `fae8b70:tests/browser/f5-management.spec.js`; successor is
[`f5-governance-baseline-0191-0195.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js).

- **0192 — ACCEPT / direct.** Capability: create a child channel in an independent Modal, observe all four convergence stages, then enter it. Invariant: typed acceptance, ledger, observability, membership, and serving facts all precede navigation. Owner: [`GovernanceFeature.jsx:271`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:271). The unchanged strict `已确认` count and enter sequence passed on `19745da`.
- **0193 — ACCEPT / direct.** Capability: one Activity row opens its WorkItem source and exact focus URL. Owner: Activity row [`WorkspaceFeatures.jsx:97`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:97) and WorkspaceApp route callback. Row, detail, and URL all passed.
- **0194 — RED / governance/operation projection.** Capability: delayed create produces a durable Operation Center row and returns to the source turn. Invariant: request identity survives typed convergence and operation projection. Owner: Governance convergence above and operation projection [`WorkspaceApp.jsx:1326`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1326). On `19745da`, stage convergence now passes; first red moved to the unchanged operation-row lookup (0 rows for `/创建频道 operation-room/` at test line 94), so the row/return semantics remain unclaimed.
- **0195 — RED / strict public surface.** Capability: search restores channel/Tasks/WorkItem/focus, then revocation removes detail, Tasks capability, and cached search result. Owner: SearchFeature and WorkspaceApp access projection. First red is the unchanged broad text locator matching three legitimate revocation surfaces; it was not narrowed to make green, so cache non-leakage remains unclaimed.

## F7 0207–0211 and picker

- **0207 — ACCEPT / repeat 3.** Mobile drawer keeps Agent activity visible, bounded, and actionable after channel return. Owner: feed activity acknowledgement and mobile rail. All three repeats passed.
- **0208 — ACCEPT / repeat 3.** Two public Agent-filter taps select then clear, proven by `aria-pressed` and visible state. Owner: [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282). All repeats passed.
- **0209 — ACCEPT / repeat 3.** Quota pressure recovers a bounded IndexedDB tail and redaction through Replica. Owner: [`channel-replica.js:847`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:847). All repeats passed.
- **0210 — RED / notification policy.** Capability: deep-history background loading stays silent, while a real pulse creates one actionable new-dynamic control. Owner chain: `useHistoryConsumer` → projection → notification policy. First red remains the absent `/条新动态/` button after `pulse`.
- **0211 — RED / public admission evidence.** Capability: upward runway releases bounded rows with compositor coverage and no post-user writer. Owner chain: history consumer → [`useConversationProjection.js:724`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:724). First red remains zero `history.projection_checked`; `history.admission_commit_check` is not accepted as a renamed substitute.
- **Picker focus — ACCEPT on current candidate.** The unchanged direct public action is [`composer-channel-file-picker-contract.spec.js:34`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/composer-channel-file-picker-contract.spec.js:34). Repeated Tab stayed inside the dialog on `19745da`; [`useModalFocus.js:61`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/primitives/useModalFocus.js:61) is the current public focus owner. The earlier `acac6c8` red remains historical evidence, not a reason to fail a strict current candidate.

## F7 0217–0221: 0218–0220 owner localization

Old sources are `fae8b70:tests/browser/f7-history-water.spec.js:1001,
1063,1103,1149,1167`; the successor is
[`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js).

- **0217 — ACCEPT / direct.** Capability: public Claude filtering paints already-installed Claude rows without foreground history UI or list geometry churn. Owner: public filter [`ConversationSurface.jsx:282`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:282) plus semantic projection. Dense public facts, public click, and rAF proof passed.
- **0218 — RED / first owner is history-consumer/feed evidence.** Capability: a public Claude filter silently scans nonmatching physical pages until semantic Claude supply appears. Invariant: anticipatory `projection-underfill` starts with zero installed visible rows, at least two physical pages complete, and no foreground UI. [`useHistoryConsumer.js:678`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:678) starts the request; [`channel-feed-runtime.js:914`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:914) owns the physical page loop and only increments internal `completedPages` at line 1012. No public `history.batch_complete` event is emitted. Clean first red: `completed.length === 0`; target Claude text is present, so this is an evidence/owner contract gap rather than a missing public filter click.
- **0219 — RED / first owner is ConversationSurface empty-state presentation.** Capability: an empty public Claude filter exposes a partial state while warm history remains quiet, then an explicit definitive EOF. [`ConversationSurface.jsx:242`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:242) computes the empty state; lines 325–328 render `正在查找符合筛选的往来…` while unsettled, while lines 321–323 render only the definitive message after exhaustion. Clean first red is the unchanged old exact partial text `当前已加载的动态里没有符合筛选的往来`; no geometry/quietness claim is promoted.
- **0220 — RED / first owner is viewport-coverage admission.** Capability: a committed 5,000px surface starts demand only after attached/current/bottom-ready rows and both boundaries are proven. [`useBrowsingReadingController.js:121`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121) gates `history.viewport_underfilled` on `data.rows.length`, `hasBothBoundaries`, `underfilled`, attached/current/older status, and `bottomReady`. Clean first red is no event. The cold-entry evidence shows the projection/materialization handoff is still empty, so the gate—not an initial edge callback—is the first owner boundary.
- **0221 — RED / keyboard-to-reading owner.** Capability: focused public scroller `Home` reaches the physical top, creates exactly one top intent, and settles it. Owner: [`VendorListExecutor.jsx:116`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:116) key mapping plus [`useBrowsingReadingController.js:107`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:107) scroll evidence. On clean `19745da`, the intent was observed but the first strict red moved to the unchanged physical-top assertion: `window.__homeMinScrollTop` was `315` rather than `0` at test line 168. The old case is not accepted from the fact that the list is focusable.

## Unique next baseline: F7 0222–0226

Old sources are `fae8b70:tests/browser/f7-history-water.spec.js:1196,
1216,1261,1403,1431`; the independent successor is
[`f7-history-water-baseline-0222-0226.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0222-0226.spec.js).
Actions are public wheel, channel, scope, member-filter, and membership
controls. The test does not seed actor filters or manufacture a localStorage
state.

- **0222 — ACCEPT / direct.** Capability: a downward user wheel immediately after a history prepend reverses direction and advances the physical list. Owner: reading navigation/scroll evidence and history consumer. Old prepend, wait for `history.intent_satisfied`, and `+640` wheel all passed.
- **0223 — ACCEPT / direct.** Capability: repeated upward input at the oldest-history boundary stays inert. Invariant: top offset, first row identity/geometry, and intent count remain unchanged. Owner: reading boundary and history consumer. Full 30-scroll plus 12-repeat observable passed.
- **0224 — RED / reading restore owner.** Capability: switching channels restores the saved semantic anchor without a post-return writer fighting it. Owner: [`VendorListExecutor.jsx:598`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:598) restore-position/content-anchor path plus view-session handoff. First red is the unchanged restored-top stability assertion: visible anchor tops span 120px (expected ≤2px), with alternating scroll writes captured from the public return sequence.
- **0225 — RED / scope/filter presentation owner.** Capability: public `@我` and member-filter activation leave and restore the same list lifecycle without persisted bookmarks. Owner: [`ConversationSurface.jsx:274`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:274) scope-bar/filter presentation and [`useTimelinePreferences.js:60`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useTimelinePreferences.js:60). First red is the unchanged public `@我` button lookup timing out after the old deep-history setup; no filter action is manufactured.
- **0226 — RED / access activation and reading evidence.** Capability: revoking active-channel membership hides content, then a later grant restores the current tail and prior anchor exactly once. Owner chain: access projection [`WorkspaceApp.jsx:95`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:95), feed grant lifecycle, and reading restore. Revocation/grant and live row restoration occurred, but the strict current-tail commit proof containing inserted ID `c0.project-history-request-119` was absent (`currentTailCommit` was undefined at test line 312). The case remains open as a public evidence gap; the current rows are not substituted for that observable.

## Manual-filter pollution guard

The older stale-incarnation probes in
[`member-filter-timeline.spec.js:30`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/member-filter-timeline.spec.js:30)
and [`ux-reading-evidence.spec.js:275`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/ux-reading-evidence.spec.js:275)
write `atoll.view-session.v3.root` directly with an old actor filter. They
remain evidence-only and are not counted as public filter migration proof.
The 0217–0225 successors use only visible UI actions and do not write a
filter into storage.

## R36 disposition

On clean `19745da`, Composer 0169–0175, F5 0192–0193, F7 0207–0209, F7 0217,
F7 0222–0223, and the current picker focus contract are independently green.
F5 0194/0195, F7 0210–0211, 0218–0221, and 0224–0226 remain explicit
case-level red/evidence packets. No product edit, skip, deleted assertion,
private export, compatibility owner, manual filter injection, or merged-case
closure was used.
