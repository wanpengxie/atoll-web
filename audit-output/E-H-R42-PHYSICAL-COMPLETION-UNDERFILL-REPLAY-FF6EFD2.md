# E–H R42 physical completion and underfill replay contracts

Date: 2026-09-20

Product candidate: clean detached `ff6efd2`. This round intentionally revisits
only 0218 and 0220. Cases 0219 and 0227 are not re-run or re-counted here.
No product file was edited.

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

Tests:

- [`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js)

## Result matrix

| Case | Public capability | Exact owner contract added | Clean `ff6efd2` result |
|---|---|---|---|
| 0218 | Claude filtering silently scans nonmatching physical pages until semantic supply appears | Every completed physical page must publish exactly one public `history.batch_complete` identity: non-empty unique `ref` and unique `(scanLowSeq, scanHighSeq, nextBeforeSeq)` range; a cold snapshot counter is not a substitute | **RED** — target row and anticipatory intent exist, but public completion count is `0` while cold-entry evidence reports internal `completedPages: 4` |
| 0220 | A committed under-filled viewport admits one history demand for the latest coverage | For one latest public coverage detail, repeated layout callbacks may not replay `history.viewport_underfilled`; changed coverage may create a new key, but the same key must occur once | **RED** — no public `history.viewport_underfilled` arrived; replay attachment is still emitted with empty event evidence |

The two cases remain independent. 0218 proves feed physical-page completion
identity and exactly-once semantics; 0220 proves viewport-coverage admission
deduplication. Neither accepts the other's event, a cold snapshot, a row
appearance, or a demand receipt as a substitute.

## Verification command

```text
ATOLL_TEST_WEB_PORT=16746 ATOLL_TEST_MOCK_PORT=20146 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  --grep='TC0218|TC0220' --reporter=line --workers=1
```

Result: `2 failed`. The first strict failure for 0218 is unchanged at the
required `history.batch_complete >= 2`; the first strict failure for 0220 is
unchanged at missing `history.viewport_underfilled`. The new evidence checks
run after those boundaries when a future product owner supplies the missing
events; failures cannot be made green by deleting or skipping the identity
checks.

## 0218 — Feed physical page completion exactly once

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1063`.

User action: seed delayed deep history, append dense nonmatching physical
pages plus two Claude rows, login, and click the visible public Claude filter.
User observables: the filter starts an anticipatory `projection-underfill`
intent with zero installed visible rows; each physical page completion is
published once; at least two pages complete; no foreground/confirmation UI
appears; and the target Claude row becomes visible.

Current owner: [`channel-feed-runtime.js:950`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:950)
`loadHistory` owns the physical batch and increments the authoritative
`completedPages` counter at
[`channel-feed-runtime.js:1048`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1048).
[`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435)
starts the demand but cannot publish a page-completion substitute.

The test now keeps the old count requirement and adds a public identity
contract to the same evidence attachment:

- filter only `history.batch_complete` for the current public channel `c0`;
- require every completion to carry a non-empty `detail.ref`;
- reject duplicate refs, which represent the same physical batch completing
  twice;
- reject duplicate `(scanLowSeq, scanHighSeq, nextBeforeSeq)` ranges, which
  represent the same physical page being published twice even if a producer
  accidentally changes its ref;
- retain the quiet UI and target-row assertions.

This deliberately allows non-contiguous refs (cancellation can consume an
operation id) while requiring each committed physical range to be unique. It
also records the latest public `cold_entry.snapshot` `completedPages` value in
the attachment as diagnostic evidence only. On `ff6efd2`, that snapshot says
`4` but the public completion event count is `0`: this is the feed-owner
counterexample, not proof of completion.

## 0220 — underfill latest-coverage replay fence

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1149`.

User action: set a public `1280×5000` viewport, reset deep history, and login.
User observables: once the committed list has rows, both boundaries, current
attachment, older supply, positive geometry, and bottom readiness, the public
owner publishes `history.viewport_underfilled`; one history intent follows.
The same committed coverage must not trigger another admission when the
layout/height callbacks replay it.

Current owner: [`useBrowsingReadingController.js:121`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121)
gates the `viewport-coverage` branch and publishes the event at
[`useBrowsingReadingController.js:133`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:133).
Its internal key includes activation, presentation revision, geometry,
generation, completed pages, and reveal version; the test does not access that
private key.

The public replay evidence waits 500ms after the first event, serializes each
event's public detail, and requires the same latest detail to occur exactly
once. A changed public coverage detail is allowed to create a new admission;
the test only rejects a replay of the same latest coverage. The attachment is
written in `finally`, so a missing first event still leaves the public event
and intent evidence for the owner. Existing exact detail assertions remain:
positive client height, under-filled scroll height, rows, `attached`,
`messageCurrent`, `bottomReady`, and `hasOlder`.

On `ff6efd2`, no `history.viewport_underfilled` event arrived within the
unchanged strict wait. The attachment therefore contains no replay to bless,
and the case remains a product regression for the
`useBrowsingReadingController` owner rather than a test-fixture failure.

## Disposition

0218 remains RED with an explicit exactly-once physical completion contract;
its internal `completedPages` snapshot is recorded only as a counterexample to
false closure. 0220 remains RED with a public latest-coverage replay fence and
finally-captured evidence. No product code, private export, compatibility
owner, skip, deletion, or weakened observable was introduced. Cases 0219 and
0227 remain untouched in this round.
