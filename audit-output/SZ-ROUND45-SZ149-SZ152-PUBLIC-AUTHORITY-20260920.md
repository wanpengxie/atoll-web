# S-Z Round 45 — SZ152 public authority counterexample and SZ149 mapping

Date: 2026-09-20
Baseline: `775f8bc` (current shared tree at verification)
Scope: public Timeline/Reading tests and audit only. No Reading product source,
Workspace, Outbox, Composer, Vendor, package, lockfile, old helper, or
compatibility field was changed.

## SZ-152: exact authority counterexample

The direct public owner remains
`useConversationProjection(...).viewport.tailCaughtUp`, with
`onTailCaughtUp` as its public receipt sink. The test is in
[`tests/sz-round44-history-current-tail.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round44-history-current-tail.test.jsx:90).

The two cases now separate the authority facts from the missing reevaluation:

1. The expected-failure case observes the installed tail at
   `installedHighSeq: 2` while history is attached/current by generation and
   head but still carries `presentationRevision: 3` against source `2`.
   History is then rerendered with the same `activationID`, generation `1`,
   `messageCurrent: true`, and `headSeq: 2`, changing only the public
   presentation fence to `2` and demand to idle. With no second DOM
   observation, the expected receipt is `boundary: 2`, `physicalSeq: 0`, and
   `actorFiltered: true`; the current receipt remains at the captured
   `presentationRevision: 3` and `boundary: 0`.
2. The positive control sends one fresh, exact tail observation after that
   same status transition. It publishes the expected filtered authority
   (`boundary: 2`, `physicalSeq: 0`, `cause: "presented-follow"`) and invokes
   `onTailCaughtUp` with the same activation/generation.

This is therefore a narrow stale-evidence re-evaluation gap, not an invalid
authority or physical-read grant. The product handoff is to the existing
Reading/Timeline owner: history-currentness must invalidate or recompute the
frozen tail evidence without requiring unrelated new geometry, while retaining
the filtered physical-read zero invariant. The `it.fails` case is deliberate
regression evidence, not a skip.

The relevant current implementation captures `historyStatusRef` only while
processing `onReadingObservation`; this round records the public consequence
without editing that owner.

## SZ-149: current public mapping

The old `fae8b70:tests/timeline-reading-integration.test.jsx:66-76` contract
selected a sparse suffix through the deleted `pendingArrivalEvents` helper and
its synthetic collapsed `rowIDs` shape. The current path is:

```text
ChannelReplica.arrivalReceipts.timeline()
  -> useTimelineArrivalReceipt
  -> recordActiveReadingArrivals / view-session.recordLiveArrivals
  -> durable [stableKey, maxSeq] records
```

The direct current tests prove the public boundaries:

- [`tests/live-timeline-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-timeline-arrivals.test.js:30) proves detach/remount does not acknowledge a pending timeline arrival and only an explicit typed receipt clears it.
- [`tests/live-presentation-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-presentation-arrivals.test.js:41) proves source-revision slicing and the stable-root/exact-envelope mapping for presentation receipts.
- [`src/ui/timeline/useLiveArrivalReceipts.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useLiveArrivalReceipts.js:23) reads the current timeline journal and restores only durable stable-key/max-seq records.
- [`src/model/view-session.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/view-session.js:236) normalizes incoming records by stable key and maximum finite sequence.

No current public API proves that a collapsed `rowIDs` suffix is equivalent to
the durable max-sequence contract. SZ149 remains **OPEN / owner handoff**;
the obsolete selector is not restored.

## Verification

Focused command:

```text
npx vitest run tests/sz-round42-tail-authority.test.jsx \
  tests/sz-round43-filtered-tail-authority.test.jsx \
  tests/sz-round44-history-current-tail.test.jsx \
  tests/sz-round40-presentation-authority.test.jsx \
  tests/sz-round41-role-observable.test.js \
  tests/live-timeline-arrivals.test.js \
  tests/live-presentation-arrivals.test.js --reporter=dot
```

Result: **7 files passed; 19 tests passed, 1 expected fail (20 total)**.
The expected failure is the SZ152 no-new-geometry stale-tail case; there were
no unexpected failures. SZ149 remains OPEN and SZ146/SZ148 retain their prior
blocked/open dispositions.
