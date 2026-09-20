# S-Z Round 44 — SZ149 arrival ownership and SZ152 current-history tail retry

Date: 2026-09-20
Baseline: `35c37a3` (current shared tree; includes the latest Feed history-completion fence)
Scope: current public Timeline/Reading observables only. No Workspace, Reading
product source, Outbox, Composer, Vendor, package, lockfile, old helper, or
compatibility field was changed.

## Case mapping

| Case | Historical contract | Current public owner / observable | Decision |
|---|---|---|---|
| SZ-149 | `fae8b70:tests/timeline-reading-integration.test.jsx:66-76` selected every newer event from a sparse arrival prefix whose stable key had collapsed row identities. | The current path is `ChannelReplica.arrivalReceipts.timeline()` → `useTimelineArrivalReceipt` → `view-session.recordLiveArrivals`. Its public durable shape is one `(stableKey, maxSeq)` record per key. No current public port exposes the removed `pendingArrivalEvents` selector or its synthetic `rowIDs` collapsed-event shape. | **OPEN / product-owner handoff.** Existing live-arrival and view-session tests prove the current journal and durable tuple contract, but cannot claim equivalence to the deleted per-event selector without restoring an obsolete helper or inventing compatibility semantics. |
| SZ-152 | `fae8b70:tests/timeline-reading-integration.test.jsx:138-185` expected one fenced tail receipt to be retried when HistoryDemand became current without another geometry observation. | `useConversationProjection.viewport.tailCaughtUp` is the current public receipt. The new direct test drives a filtered current-tail observation, then changes only the public history status from stale/pending to current/idle. | **RED regression handoff.** The current receipt keeps the old captured presentation fence and remains at `boundary: 0`; it does not re-derive the positive filtered boundary or emit the retry receipt. |

## SZ-149 boundary

The current system has two intentionally different public contracts:

```text
live arrival journal:  (key, rowID, seq) events
durable Reading view:  one [stableKey, maxSeq] record per key
```

The old test's sparse `rowIDs` array was an implementation-level selector
input. Treating the durable max-sequence record as an equivalent event list
would silently choose a product policy for collapsed terminal identities. The
case therefore remains OPEN for the arrival/Reading owner; no old selector or
role API was restored.

## SZ-152 public regression

The regression packet is
[`tests/sz-round44-history-current-tail.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round44-history-current-tail.test.jsx:90).

It uses the public `useConversationProjection` hook with a `mine` projection
and an actor filter. The first committed status reports
`presentationRevision: 3` while the rendered snapshot source is `2`, and the
tail observation correctly fails closed (`boundary: 0`, `physicalSeq: 0`). The
test then rerenders only the public history status at `presentationRevision: 2`
with an idle demand, without sending a second geometry observation. The
expected user-visible result is:

```text
current filtered tail -> boundary: 2, physicalSeq: 0,
                         actorFiltered: true,
                         cause: "presented-follow"
```

The current result retains the captured stale evidence instead:

```text
captured presentationRevision: 3 -> boundary: 0, physicalSeq: 0
```

The expected-failure test is deliberately an `it.fails` regression packet,
not a skip. The handoff is to the current Timeline/Reading presentation owner:
history-currentness must invalidate or re-evaluate the frozen observation
before publishing the filtered notification boundary, while preserving the
physical-read zero rule.

## Adjacent authority evidence

The same focused run keeps the already-established public invariants green:

- SZ-150: unfiltered physical read is zero until exact current tail evidence,
  and an installed high-water above the authoritative head fails closed.
- SZ-151: a current filtered tail publishes `boundary`/`entryBoundary` while
  `physicalSeq` stays zero.
- SZ-144/146/148 remain blocked/open under the prior ruling; this round does
  not infer role-revision or role-receipt semantics from Presentation receipts.

## Verification

Focused command:

```text
npx vitest run \
  tests/sz-round42-tail-authority.test.jsx \
  tests/sz-round43-filtered-tail-authority.test.jsx \
  tests/sz-round44-history-current-tail.test.jsx \
  tests/sz-round40-presentation-authority.test.jsx \
  tests/sz-round41-role-observable.test.js \
  tests/live-timeline-arrivals.test.js \
  tests/live-presentation-arrivals.test.js --reporter=dot
```

Result: **7 files passed; 17 tests passed, 1 expected fail (18 total)**.
There were no unexpected test failures. Product source was not modified in this
round; SZ-152 is handed back as the one explicit current-owner regression.
