# E–H R58 — TC0216 exact continuation lineage implementation

Date: 2026-09-21
Base: `7bcb53453eef3e198602ee792b4ef5168ffaa462`
Branch: `unit-e-h/tc0216-exact-lineage-7bcb534`
Worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/unit-e-h-tc0216-7bcb534`
Scope: TC0216 only. TC0212 and other Feed/Reading contracts are unchanged.

## Case ledger

| Case | User capability | Invariant | Current public owner and evidence | Result/disposition |
|---|---|---|---|---|
| TC0216 | After selecting the public Claude conversation filter, a user may wheel upward at the physical history top until older matching rows separated by nonmatching physical pages are visible in the same filtered list. | Feed/history supplies physical pages; Presentation may remain sparse, but a page that adds no matching row may continue only with the exact same Reading transaction, physical root, effective visibility boundary, and first-row/sequence proof. A new gesture, direction reversal, root replacement, channel/view change, or visibility re-entry must stop the old continuation and wait for fresh user input. | Public filter: `src/ui/conversation/ConversationSurface.jsx`; semantic projection: `src/model/conversation-presentation.js`; physical page owner: `src/model/channel-feed-runtime.js`; continuation owner: `src/ui/timeline/useHistoryConsumer.js`; Reading boundary owner: `src/ui/timeline/useConversationProjection.js`; sole DOM/input adapter: `src/ui/timeline/VendorListExecutor.jsx`; browser contract: `tests/browser/f7-history-filter-old-content-0216.spec.js`. | **PASS on the implementation branch.** Two old Claude marker rows become real rows, exactly two matching markers remain, their sequence gap exceeds one 128-row physical page, and the history-demand surface clears. Three independent Chromium runs passed. |

## Preserved action and observable

The browser case resets `deep-history-delayed`, appends two old Claude rows,
inserts two 320-row unrelated spans around a newer Claude group, selects the
public Claude filter, and sends native upward wheel input. The proof is not a
request count or diagnostic event: both `public old Claude marker 1/2` rows are
present in the public timeline, there are exactly two such rows, and the
newest-to-oldest sequence gap is greater than 128. The test also requires no
foreground `.timeline-history-demand` after materialization.

## Exact lineage contract

The existing `useHistoryConsumer` continuation token now carries exact,
ephemeral fields:

```text
controller, activationID, channelID, viewKey,
inputEpoch, intentRevision, gestureID, rootIdentity, visibilityEpoch
```

Every gate uses strict equality. No `>=`/`<=` epoch or revision inheritance is
used. The sparse no-prepend proof remains independent of geometry:

```text
committed rows[0].id       === captured continuationAnchorID
committed rows[0].seqLow  === captured continuationAnchorSeq
result.firstVisibleSeq    === captured continuationAnchorSeq
```

Settlement, commit/insertion invalidation, timer execution, and the successor
request all reject missing or mismatched lineage. Rejection clears the
continuation timer and matching top boundary and returns the existing
fail-closed `position-anchor-missing`/cancellation outcome. A subsequent
wheel creates a new input/gesture token.

`visibilityEpoch` is an ephemeral member of the existing
`useProjectionReadingOwner` `visibilityBoundaryRef`. It increments once per
effective document/surface visibility edge, so visible → hidden → visible
cannot revive a prior timer. `rootIdentity` comes from the existing Reading
root activation observation. Neither value is persisted or placed in
`ReadingSession`; no store, owner, compatibility API, or private export was
added.

At a clamped physical top Chromium may emit a wheel without a native scroll
event. The existing Vendor input adapter now publishes the same typed
`scroll-position`/`atTop` evidence for that new transaction through the
existing `reportDomEvidence` → `onAtTop` path. This is required so exact
fail-stop is followed by an ordinary new-user-input reissue; it does not add a
scroll writer or a second history owner.

## Verification

Focused lineage contract:

```text
npm exec vitest run tests/e-h-tc0216-continuation-lineage.test.js --reporter=dot
4 tests passed
```

Feed/history regression set:

```text
npm exec vitest run \
  tests/history-demand.test.js \
  tests/channel-feed-runtime.test.jsx \
  tests/channel-feed-runtime-physical-operation.test.jsx \
  tests/channel-feed-runtime-concurrent-completion.test.jsx \
  tests/e-h-tc0216-continuation-lineage.test.js \
  tests/reading-navigation-coordinator.test.js --reporter=dot
6 files; 59 tests passed
```

Public Chromium contract, three independent ports/workers on this branch:

```text
ATOLL_TEST_WEB_PORT=28223 ATOLL_TEST_MOCK_PORT=29223 npm exec playwright test tests/browser/f7-history-filter-old-content-0216.spec.js --workers=1 --reporter=line
1 passed (18.6s)

ATOLL_TEST_WEB_PORT=28224 ATOLL_TEST_MOCK_PORT=29224 npm exec playwright test tests/browser/f7-history-filter-old-content-0216.spec.js --workers=1 --reporter=line
1 passed (17.8s)

ATOLL_TEST_WEB_PORT=28225 ATOLL_TEST_MOCK_PORT=29225 npm exec playwright test tests/browser/f7-history-filter-old-content-0216.spec.js --workers=1 --reporter=line
1 passed (18.3s)
```

Production build also passed with `npm run build`.

## Changed-file boundary

Product changes are limited to the existing Reading/history/Vendor owners:

- `src/ui/timeline/useHistoryConsumer.js`
- `src/ui/timeline/useConversationProjection.js`
- `src/ui/timeline/VendorListExecutor.jsx`

Test/evidence changes are limited to TC0216:

- `tests/e-h-tc0216-continuation-lineage.test.js`
- `tests/browser/f7-history-filter-old-content-0216.spec.js`
- this audit

No vendor package, package manifest, lockfile, compatibility API, private
export, skip, deletion, or weakened behavioral assertion was used. The prior
intentionally-red design witness remains in
`audit-output/E-H-R57-TC0216-EXACT-LINEAGE-253C113-20260920.md`.
