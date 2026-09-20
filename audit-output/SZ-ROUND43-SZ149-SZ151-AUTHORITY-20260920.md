# S-Z Round 43 — SZ149 arrival handoff and SZ151 filtered-tail authority

Date: 2026-09-20  
Baseline: `0ba7fa7` (idempotent visible re-entry epoch handoff)  
Owner: S-Z unit-test / current Reading and Presentation public boundaries

## Case mapping

| Case | Unique fae source contract | Current public owner and observable | Decision |
|---|---|---|---|
| SZ-149 | `fae8b70:tests/timeline-reading-integration.test.jsx:66-76` — `pendingArrivalEvents` selected every newer event from a sparse prefix whose stable key had collapsed row identities. | The current path is `ChannelReplica.arrivalReceipts.timeline()` → `useTimelineArrivalReceipt` → `view-session.recordLiveArrivals`. The public handoff carries `(key, seq)` arrival records; the durable Reading owner intentionally normalizes records by stable key and retains the maximum finite sequence. No current public port exposes the removed `pendingArrivalEvents` selector or its `rowIDs` collapsed-event shape. | **OPEN / product handoff.** Existing `live-timeline-arrivals` and `view-session` tests prove the current journal and durable `(key, seq)` contract, but they cannot prove equivalence to the deleted per-event selector without restoring a helper or inventing compatibility semantics. No obsolete helper or role API was restored. |
| SZ-151 | `fae8b70:tests/timeline-reading-integration.test.jsx:90-136` — a filtered tail cleared the visible notification while keeping the physical channel cursor at zero. | `useConversationProjection.viewport.tailCaughtUp` is the current authority observable. At a current filtered tail it publishes the channel `boundary`/`entryBoundary`, while `physicalSeq` remains zero when scope or actor filtering applies; `onTailCaughtUp` receives that same typed receipt. | **GREEN successor.** `tests/sz-round43-filtered-tail-authority.test.jsx` proves the exact filtered boundary, actor-filter metadata, and physical-read fail-closed value. |

## SZ149 boundary

The current model deliberately has two distinct contracts:

```text
live arrival journal:  (key, rowID, seq) events
durable Reading view:  one [stableKey, maxSeq] record per key
```

The old test supplied a synthetic `rowIDs` array inside one sparse event and
asserted a private selector's revision slicing. That shape has no current
public authority. Treating `arrivalReceipts.timeline()` or durable unseen
records as an equivalent selector would hide a product decision about whether
each collapsed row identity is user-visible. SZ149 therefore remains open for
the Reading arrival owner; this round records the handoff instead of adding a
compatibility parser or a private export.

## SZ151 authority invariant

```text
current committed tail + filtered scope
  -> notification boundary = installedHighSeq
  -> physical channel read = 0
```

The channel notification can be cleared by the semantic filtered tail, but a
filtered projection cannot claim that excluded physical rows were read. The
test uses the public `useConversationProjection` hook and its `onTailCaughtUp`
receipt; it does not call Feed internals or the deleted `onReadLatest` path.

SZ146 and SZ148 remain **BLOCKED** for the old role-clock/receipt contracts,
as required by the prior decision. No Workspace, Outbox, Composer, Vendor,
package, lockfile, role API, old helper, or product source was changed.

## Verification

Focused command:

```text
npx vitest run tests/sz-round42-tail-authority.test.jsx tests/sz-round43-filtered-tail-authority.test.jsx tests/sz-round40-presentation-authority.test.jsx tests/sz-round41-role-observable.test.js tests/live-timeline-arrivals.test.js tests/live-presentation-arrivals.test.js --reporter=dot
```

Result: **6 test files passed, 17 tests passed**.
