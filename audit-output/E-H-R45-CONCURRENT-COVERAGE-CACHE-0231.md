# E–H R45: concurrent completion, coverage revision identity, and warm-cache owner

Date: 2026-09-20

This is a test/audit-only round. No product source, fixture, vendor package,
manifest, lockfile, skip, or legacy API was changed. The governing contract is
[`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md).

## Case ledger

| Baseline case | User capability and invariant | Current public owner / entry point | Result and disposition |
|---|---|---|---|
| TC0218, [`f7-history-water-baseline-0217-0221.spec.js:70`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js:70) | Claude filtering may scan several non-matching physical pages without foreground confirmation. Each completed current physical page must publish exactly one non-empty public completion identity: unique `ref` and unique `(scanLowSeq, scanHighSeq, nextBeforeSeq)`. | [`createChannelFeedRuntime.loadHistory` and `publishBatchComplete`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1036); the projection consumer may request history but cannot publish completion. | The old clean `9896328` owner is **REJECT** under the stricter concurrent proof: two same-frontier default demands produced two public completions for one physical range. Current owner candidate `6ab6896` is accepted by the added public-diagnostic unit proof; browser TC0218's sequential multi-page contract remains separate and was not recounted here. |
| TC0220, [`f7-history-water-baseline-0217-0221.spec.js:184`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js:184) | A committed under-filled viewport admits one history demand for one physical coverage. Replaying the same coverage must not publish a second admission; a genuinely changed presentation revision is a new coverage identity. | [`VendorListExecutor` source/admission key](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:329) plus the public [`history.viewport_underfilled` gate](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121). | **PASS for source-key semantics; observability gap recorded.** On f004, revision 1 and revision 2 each admitted once, as required for changed coverage, but both public diagnostic `detail` objects were identical because `presentationRevision` is omitted. This is a counterexample for consumers that infer identity from detail alone, not evidence that the two changed revisions are an illegal duplicate. |
| FAE-1644 / TC0231, [`f7-history-warm-cache-baseline-0231.spec.js:44`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-warm-cache-baseline-0231.spec.js:44) | A huge-history login must establish a bounded durable working set of `128 ≤ c0 rows < 1000`; after reload, two native top gestures must each own one older physical demand. The test reads the canonical durable rows, not a transport receipt or a metadata estimate. | Durable store: [`createChannelReplicaCache`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:847), `saveRows` at line 1291. Upstream write boundary: [`channel-feed-runtime` network completion](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1135), which sends `outcome.rows` to `cache.saveRows`. | **REJECT / product regression.** Clean `9896328` stabilizes at 42 physical `c0` rows (<128) after 30s. The first divergence is Feed's startup warm demand/page continuation: the fixture has head `100006` and `hasOlder:true`, but the first projected network page has only 38 rows. The cache is not showing a quota error; it faithfully retains those rows (plus four live rows). Meta's `rowCount:80` is a duplicate-write estimate and cannot substitute for physical row count. Current candidate browser run still receives 42, so this remains open with the Feed history-demand owner. |

## 1. TC0218: strict concurrent exactly-once proof

### Old action and observable

The browser case resets delayed deep history, applies a dense non-matching
physical tail, selects the public Claude filter, and waits for the target row.
The user must not see a foreground history confirmation. The old observable
requires at least two physical completions with unique refs and unique scanned
ranges before the semantic target appears.

### Minimal concurrent reproduction

The disposable clean-`9896328` probe grants `c0` at `head_seq:20`, then calls
the same public `snapshot.loadHistory('c0', { intent: 'initial-view',
urgency: 'blocking' })` twice before either page completes. The wire saw:

```text
requests: 2
beforeSeq: [21, 21]
refs: [r45-concurrent-1, r45-concurrent-2]
pageEnd range for both: scan_low=20, scan_high=20, next_before=20
acceptedRows: [1, 0]
history.batch_complete count: 2
```

The strict assertion is one completion for one physical `(channel, generation,
range)`; clean `9896328` fails it deterministically on repeat 3 (`3/3` red).
The second completion is not made legitimate by `acceptedRows:0`: it still
exposes another `ref` for the same physical range to the public diagnostic
owner.

The regression test now committed at
[`tests/channel-feed-runtime-concurrent-completion.test.jsx:23`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/channel-feed-runtime-concurrent-completion.test.jsx:23)
asserts both sides of the contract: two default-page callers share one wire
request and one `history.batch_complete` whose ref/range/accepted-row detail
matches the page receipt. It uses only `createChannelFeedRuntime`,
`enqueue`, `pageEnd`, and the public diagnostics snapshot.

### Current owner disposition

The existing Feed owner candidate `6ab6896` joins admitted requests by
`generation + attachEpoch + channel + beforeSeq + limit + byteLimit`, while
leaving lifecycle fences intact. The new unit proof passes and the existing
Feed ownership suite passes; no second store or compatibility owner was
introduced. The clean `9896328` result remains a historical REJECT and is not
retroactively relabeled by the candidate.

## 2. f004: changed presentation revision versus same-coverage replay

### User capability and invariant

When the current Reading surface is physically under-filled, the public owner
must request older history only after rows, both boundaries, current attachment,
older supply, and bottom readiness are true. Repeated callbacks for the same
coverage are one demand. A new mounted presentation revision is a new physical
coverage source and may be admitted once.

### Source-key evidence

The f004 owner uses the following publication key in
[`VendorListExecutor.jsx:329`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:329):

```text
activationID:presentationRevision:clientHeight
```

The admission key at [`VendorListExecutor.jsx:1349`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:1349)
resets the publication fence when that source changes. The public diagnostic
gate at [`useBrowsingReadingController.js:129`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:129)
also includes `presentationRevision` in its internal demand key, but emits a
detail object containing only channel, geometry, row count, and authority
facts.

The added unit case at
[`tests/reading-observation-settle.test.jsx:217`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/reading-observation-settle.test.jsx:217)
replays an under-filled range at revision 1, rerenders a changed row/presentation
revision 2, and replays the same range. It proves:

```text
owner.onUnderfill calls: 2
history.viewport_underfilled events: 2
event[1].detail === event[0].detail: true
```

Targeted result: `2 passed, 5 skipped` (the second selected test is the
readiness replay proof). This is deliberately an evidence test: it preserves
the distinction between a valid new revision and an invalid same-key replay,
and records that the public detail alone cannot identify the revision. No
product change or assertion weakening was made.

## 3. TC0231: warm-cache first boundary and owner handoff

### Old action and observable

The FAE-1644 case resets `huge-history`, logs in through the real app, waits for
the durable `atoll-channel-replica-v1` `rows` store to reach at least 128 `c0`
records and below 1000, reloads, then performs two native top gestures. The
first strict boundary is the durable row count; no later gesture result can
close a failure at that boundary.

### Exact clean browser evidence

Command (detached clean `9896328`, `workers=1`):

```text
npx playwright test tests/browser/f7-history-warm-cache-baseline-0231.spec.js \
  --config=playwright.config.js --reporter=line
```

Result: `1 failed`; after the 30-second poll, `Expected >=128, Received 42`.
The direct IndexedDB owner probe recorded:

```text
physical c0 rows: 42
seq range: 99877..100010 (sparse projected rows)
history batch_complete: rows=38, acceptedRows=38, requestedBeforeSeq=100007,
  nextBeforeSeq=99877, hasOlder=true
second same-range batch_complete: rows=38, acceptedRows=0
live rows additionally persisted: seq 100007..100010 (4 rows)
meta.value.rowCount: 80  // not a physical-row count
headSeq: 100010, oldestSeq: 99877, newestSeq: 100010
```

The fixture remains valid: `huge-history` has 14,286 turns / 100,006 history
rows, and the network reports `hasOlder:true`. The `38` rows are the current
projected page, not a malformed or shortened fixture. The duplicate second
completion is the old 989 behavior; even after the Feed join candidate removes
that duplicate, the current browser run still reports `42`, so the warm-cache
shortfall is independently reproducible.

### First public owner boundary

`createChannelFeedRuntime` receives the network page and applies it to the
Replica, then asynchronously calls `cache.saveRows(outcome.rows)` at
[`channel-feed-runtime.js:1135`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1135).
`createChannelReplicaCache` at
[`channel-replica.js:847`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-replica.js:847)
is the sole public durable owner and does not fabricate rows to satisfy the
bound. Its physical store is therefore correctly reporting the short upstream
window. The first product divergence is the Feed startup warm-demand/page
continuation contract: it must collect enough real projected pages to reach the
128-row durable bound while retaining the bounded-window invariant. The
metadata overcount is a secondary diagnostic; it is not accepted as proof of
the user capability.

Disposition: **product regression packet returned to the Feed/cache owner**;
the browser contract remains strict and unchanged. No cache quota, malformed
fixture, or old `atoll-feed-v8` implementation was used to explain away the
red result.

## Verification and changed files

Focused verification on the current candidate:

```text
npx vitest run tests/channel-feed-runtime-concurrent-completion.test.jsx \
  --retry=0 --reporter=verbose
  1 passed

npx vitest run tests/channel-feed-runtime.test.jsx \
  tests/channel-feed-runtime-concurrent-completion.test.jsx \
  --retry=0 --reporter=dot
  27 passed

npx vitest run tests/reading-observation-settle.test.jsx \
  --retry=0 --reporter=verbose \
  -t 'changed presentation revision|replays the latest physical coverage once'
  2 passed, 5 skipped

npx playwright test tests/browser/f7-history-warm-cache-baseline-0231.spec.js \
  --config=playwright.config.js --reporter=line
  1 failed: Expected >=128, Received 42
```

Changed test/audit files in this round:

- [`tests/channel-feed-runtime-concurrent-completion.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/channel-feed-runtime-concurrent-completion.test.jsx)
- [`tests/reading-observation-settle.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/reading-observation-settle.test.jsx:217)
- this audit
