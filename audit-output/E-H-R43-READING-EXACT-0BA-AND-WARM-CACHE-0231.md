# E–H R43 exact `0ba7fa7` re-verification and warm-cache baseline

Date: 2026-09-20

Product candidate: clean detached `0ba7fa7`. No product file was edited. The
0218/0220 exactly-once and latest-coverage replay contracts from R42 remain
unchanged. This round re-ran 0219/0227 as requested and restored the next
unique E–H baseline, FAE-1644 / static ledger TC-0231.

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

Tests:

- [`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js)
- [`f7-history-access-baseline-0227-0230.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-access-baseline-0227-0230.spec.js)
- [`f7-history-warm-cache-baseline-0231.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-warm-cache-baseline-0231.spec.js)

## Result matrix

| Case | Public capability and strict observable | Current public owner | `0ba7fa7` result |
|---|---|---|---|
| 0218 | Claude filter scans nonmatching physical pages; each physical page completion is exactly once by unique public identity | `channel-feed-runtime.loadHistory` | **RED maintained** — completion count remains `0`; R42 unique-ref/range checks remain in place |
| 0220 | Committed under-filled viewport admits demand once per latest coverage; same coverage replay is fenced | `useBrowsingReadingController` | **RED maintained** — no `history.viewport_underfilled`; R42 replay evidence remains finally-captured |
| 0219 | Exact partial → exact EOF, quiet UI, unchanged list geometry | `ConversationSurface` plus committed reading surface | **PASS**, 1 run and repeat-3: `3/3` passed |
| 0227 | Revocation has zero freshness frames; later grant has exactly one `channel_meta` through settling window | access/grant lifecycle → `refreshChannel` | **PASS**, repeat-3: `3/3` passed with exact-one frame |
| 0231 / FAE-1644 | Warm cache survives reload; bounded cache reaches ≥128 and <1000 rows; one top demand and a second gesture continue to older anchors | current `channel-replica-v1` durable cache + history demand owner | **RED** — canonical cache contains only `42` rows, below required `128` |

0219 and 0227 are reported here only as the requested exact-candidate
reverification; no changes were made to those tests in this round. 0218 and
0220 remain independent owner packets and were not closed by either PASS.

## Commands and results

Exact 0219/0227 candidate run, repeated three times:

```text
ATOLL_TEST_WEB_PORT=16751 ATOLL_TEST_MOCK_PORT=20151 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  tests/browser/f7-history-access-baseline-0227-0230.spec.js \
  --grep='TC0219|TC0227' --repeat-each=3 --reporter=line --workers=1
```

Result: `6 passed (59.3s)`. 0219 passed its exact partial text, definitive
EOF, quietness, and unchanged-geometry assertions in all three repetitions.
0227 passed zero revoked frames, one successor socket, and exactly one grant
frame after the 750ms settling window in all three repetitions.

Maintenance run for the R42 strict contracts:

```text
ATOLL_TEST_WEB_PORT=16754 ATOLL_TEST_MOCK_PORT=20154 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  --grep='TC0218|TC0220' --reporter=line --workers=1
```

Result: `2 failed`. 0218 still first fails at public completion count `0`
(required ≥2); 0220 still first fails at missing
`history.viewport_underfilled`. The R42 exactly-once and replay assertions
remain present and were not relaxed.

The next unique baseline run was:

```text
ATOLL_TEST_WEB_PORT=16753 ATOLL_TEST_MOCK_PORT=20153 npx playwright test \
  tests/browser/f7-history-warm-cache-baseline-0231.spec.js \
  --reporter=line --workers=1
```

Result: **RED** at the unchanged old startup bound: expected at least 128
canonical cached rows, observed 42 after 30 seconds. The finally attachment
records the public startup evidence even though the first strict bound fails.
The evidence had `wire.page_end` twice and no public
`history.batch_complete`; it does not turn the internal transport receipt into
a cache-completion substitute.

## 0218 / 0220 strict-contract maintenance

The R42 test and audit are the current contract owners:
[`E-H-R42-PHYSICAL-COMPLETION-UNDERFILL-REPLAY-FF6EFD2.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/E-H-R42-PHYSICAL-COMPLETION-UNDERFILL-REPLAY-FF6EFD2.md).
0218 still requires non-empty unique `detail.ref` and unique physical
`(scanLowSeq, scanHighSeq, nextBeforeSeq)` for every current-channel
`history.batch_complete`; a cold snapshot `completedPages` value is evidence
only. 0220 still requires the same latest public coverage detail to publish
`history.viewport_underfilled` once, while allowing only a changed coverage
detail to establish a new key. No assertion was deleted or weakened.

## 0219 — exact candidate PASS

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1103`.

The public action remains login, click the visible Claude filter, wait for the
exact partial notice, then exact EOF, and sample twelve quiet/stable frames.
On `0ba7fa7`, the owner change that keeps empty feedback out of the reading
flow now satisfies all original observables: exact partial text, exact EOF,
no foreground/confirmation status, and unchanged timeline geometry. Repeat-3
passed without borrowing evidence between cases.

Current owner remains
[`ConversationSurface.jsx:242`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:242),
with the committed empty-state branches at lines 317–328. This PASS does not
close 0218's feed completion contract or 0220's viewport admission contract.

## 0227 — exact-one candidate PASS

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1489`.

The public action remains revoke active `c0.project`, observe the inaccessible
state, grant membership, and observe WebSocket frames and successor sockets.
The test first waits for one grant-side `channel_meta`, then holds a 750ms
quiet window and requires the final count to remain exactly one. Repeat-3
passed with zero revoked frames, one successor socket, and one grant frame each
time.

The frame owner is
[`channel-feed-runtime.js:1180`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1180)
`refreshChannel`, invoked after grant through the existing access lifecycle at
[`useWireSession.js:799`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/hooks/useWireSession.js:799).

## 0231 / FAE-1644 — warm cache regression packet

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1644`.

User capability: opening a huge ledger warms a bounded durable tail, survives
reload, satisfies one physical top demand, and permits a second native gesture
to continue paging rather than suppressing all future demands. Strict
invariants are independent: startup cache rows are `>=128` and `<1000`; no
startup segment remains outstanding (`segment_requested - batch_complete = 0`);
one wheel after reload produces exactly one started and satisfied history
intent; a second wheel produces one new intent whose anchor sequence is older
than the first.

The old `atoll-feed-v8` 2-part IndexedDB key is not reopened or restored. The
current public persistence owner is
[`channel-replica.js:847`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:847)
`createChannelReplicaCache`, whose canonical browser database is
`atoll-channel-replica-v1` with owner/channel/sequence rows. The successor
test reads that current public durable row boundary, then uses the unchanged
public reload and native-wheel actions.

Clean evidence: the current canonical cache stabilized at `42` rows, so the
first old strict bound failed before reload. Startup diagnostics had two
`wire.page_end` receipts, but no `history.batch_complete`; those are recorded
as evidence and are not accepted as completion. This is a single cache-owner
regression packet. The later reload/gesture assertions remain in the test for
the owner candidate once the startup bound is restored; no fixture is weakened
to accept 42.

## Disposition

0218 and 0220 remain strict RED with their R42 identity/replay contracts.
0219 and 0227 are exact repeat-3 PASS on `0ba7fa7`. The next unique E–H
baseline FAE-1644/TC-0231 is restored as an explicit RED packet at the current
canonical cache owner's startup bound. Only tests and audit were changed; no
product, private export, legacy API, skip, deletion, or compatibility owner
was introduced.
