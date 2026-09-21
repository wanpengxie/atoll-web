# SZ-182 — saved bookmark survives gen0 → gen1 reacquisition

Date: 2026-09-21
Base: `145618f487e62528c1d289f0cff53a976c435671`
Owner: `useConversationProjection` → `useHistoryConsumer` viewport; Feed
publishes the source/generation facts.
Test: `tests/sz182-bookmark-gen-source-reacquisition.test.jsx`

## Contract

If a saved browsing bookmark is absent from the current Presentation, the
public owner issues a blocking `initial-view` request carrying the immutable
`{messageID, seq}` target. If the source lease changes while that request is
pending, the gen0 result must not alter the target or prevent the gen1 owner
from reacquiring exactly the same target.

## Evidence

The test starts with a zero-row Presentation, a browsing session containing
`saved-target` at sequence `3`, detached generation 0, and source lease
`1:2:9`. It observes one blocking initial-view request with
`requiredVisibleCoverage: { messageID: 'saved-target', seq: 3 }`. It then
publishes attached generation 1/source lease `1:3:10` while the gen0 promise
remains pending; no duplicate request is issued before settlement. Settling
the old request as `{ kind: 'exhausted', localOnly: true }` causes one gen1
request, and every initial-view request retains target sequence 3 and the same
message ID. The public viewport still exposes the same bookmark and current
gen1 status.

Assertions use only `viewport.session`, `viewport.status`, and the injected
public request port; no internal refs, terminal ledger, or retired API is
read.

## Result

Focused Vitest: PASS, repeated 5/5. Adjacent SZ178/SZ179/SZ180/SZ191 and
history-demand tests: PASS (6 files, 10 tests). `npm run build`: PASS
(existing chunk-size warning only). Product source unchanged.
