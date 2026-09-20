# S-Z Round 46 — SZ149 mapping and SZ154 authority replacement recheck

Date: 2026-09-20
Baseline: `b434a1f` plus the shared uncommitted Reading candidate observed
during verification
Scope: tests/audit only. No Reading product source was staged or changed by
this round; no Workspace, Outbox, Composer, Vendor, package, lockfile, old
helper, or compatibility field was touched.

## Reading proposal recheck for SZ152

The shared Reading candidate adds a `settled` observation gate and stricter
document/surface visibility invalidation. The SZ152 direct test now supplies
`settled: true` for the exact visible-tail observation, so the recheck does not
confound the history-currentness question with the new settledness rule.

The existing expected-failure case in
[`tests/sz-round44-history-current-tail.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round44-history-current-tail.test.jsx:90)
still fails as expected: same activation/generation/head, history fence changes
from stale/pending to current/idle, no new geometry, and `tailCaughtUp` remains
at the captured old presentation fence with `boundary: 0`. Its positive control
still succeeds after one fresh exact observation. Therefore the Reading
candidate improves settled/visibility fencing but does **not** close SZ152's
history-current re-evaluation gap; no product verdict is inferred here.

## SZ-154 current public successor

The historical contract at
`fae8b70:tests/timeline-reading-integration.test.jsx:242-287` required a
rejected receipt not to cross either a generation replacement or semantic-scope
replacement. The current public owner does not expose the old rejected
`markRead`/Cursors acceptance port, so this round does not claim exact closure.

The current successor evidence is in
[`tests/sz-round46-authority-replacement.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round46-authority-replacement.test.jsx:100):

- With the same activation/view, replacing generation `1` with generation `2`
  changes the public `tailCaughtUp` authority to `boundary: 0` and
  `physicalSeq: 0`; no positive generation-2 receipt is emitted from the old
  observation.
- Replacing the semantic scope `all` with `mine` creates a new activation and
  starts with `caughtUp: false`, `boundary: 0`, and `physicalSeq: 0`. Only a
  fresh exact observation publishes the filtered boundary `2` while retaining
  `physicalSeq: 0`.

This proves the current public authority fails closed across replacement, but
SZ154 remains **OPEN / partial successor** until a current owner defines a
public rejected-receipt acceptance contract equivalent to the old Cursors case.

## SZ-149 mapping remains OPEN

The old `pendingArrivalEvents` case
(`fae8b70:tests/timeline-reading-integration.test.jsx:66-76`) depends on a
deleted sparse-prefix selector and synthetic collapsed `rowIDs`. The current
public path remains:

```text
ChannelReplica.arrivalReceipts.timeline()
  -> useTimelineArrivalReceipt
  -> view-session.recordLiveArrivals
  -> durable [stableKey, maxSeq] records
```

[`tests/live-timeline-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-timeline-arrivals.test.js:30)
and
[`tests/live-presentation-arrivals.test.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/live-presentation-arrivals.test.js:41)
prove the current journal, source-revision slicing, stable-root mapping, and
typed acknowledgement boundaries. They cannot prove that the removed
per-event sparse selector is equivalent to durable max-sequence records;
SZ149 remains **OPEN / owner handoff** without restoring compatibility.

## Verification

Focused command:

```text
npx vitest run tests/sz-round42-tail-authority.test.jsx \
  tests/sz-round43-filtered-tail-authority.test.jsx \
  tests/sz-round44-history-current-tail.test.jsx \
  tests/sz-round46-authority-replacement.test.jsx \
  tests/sz-round40-presentation-authority.test.jsx \
  tests/sz-round41-role-observable.test.js \
  tests/live-timeline-arrivals.test.js \
  tests/live-presentation-arrivals.test.js --reporter=dot
```

Result: **8 files passed; 21 tests passed, 1 expected fail (22 total)**.
There were no unexpected failures. The shared Reading candidate was not part of
this round's commit; only the new public test and this audit are owned here.
