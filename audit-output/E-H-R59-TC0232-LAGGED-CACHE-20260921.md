# E–H R59 — TC0232 / FAE-1711 lagged-cache seam

Date: 2026-09-22
Exact candidate: `54111bf` (`docs(sz181): normalize audit formatting`)  
Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](../docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

## Claim and non-duplication

This round claims exactly one central 1487 case: **TC-0232 / FAE-1711**. The
central ledger records the old declaration at
`fae8b70:tests/browser/f7-history-water.spec.js:1712` and the target path as
absent (`a8c9165`). A repository-wide exact-ID/source scan found no existing
TC0232/FAE-1711 audit, test, or candidate branch/worktree before this round.

TC-0232 is not the already merged EH25-63 / TC-0899 case. TC-0899 is a
`tests/history-scheduler.test.jsx` injection harness for selecting network
before a lagged cache at an exact coverage frontier. TC-0232 is a real browser
flow with `deep-history` seed 1711, a native top gesture, a reload, and a
user-visible cache/network seam. The setup, user action, presentation
observable, and old source sequence are not semantically covered by the unit
case; the two cases remain separately counted.

## Case contract

| Required field | TC-0232 evidence |
|---|---|
| Old setup/action | Reset `deep-history` seed `1711`; log in as `root`; verify `c0 history 120: ask steward for PONG`; wait for an accepted physical page; wheel the `.timeline-message-list` to the physical top; wait for one satisfied history intent; verify the canonical cache has at least 160 `c0` rows; return to the tail; close the page; send twenty server `pulse` actions; create a new page and reload. |
| Old observable / user capability | A lagged local cache leaves the reader with a readable, connected surface after the current tail is refreshed. On resume the current tail remains visible and the list does not expose a gap or duplicate presentation row. |
| Invariants | The durable rows are the current `atoll-channel-replica-v1` owner, not the removed `atoll-feed-v8`; a physical range is admitted once under one Feed authority; cache/network handoff follows the exact covered frontier; stale or unrelated rows cannot satisfy the seam; visible row IDs remain unique. |
| Current public owner | Feed source selection and physical admission: [`channel-feed-runtime.js:193`](../src/model/channel-feed-runtime.js#L193), [`channel-feed-runtime.js:1318`](../src/model/channel-feed-runtime.js#L1318), [`channel-feed-runtime.js:1743`](../src/model/channel-feed-runtime.js#L1743), and [`channel-feed-runtime.js:1780`](../src/model/channel-feed-runtime.js#L1780). Durable persistence is the single Replica cache owner at [`channel-replica.js:862`](../src/model/channel-replica.js#L862). User-driven history demand is the public Reading consumer at [`useHistoryConsumer.js:437`](../src/ui/timeline/useHistoryConsumer.js#L437). |
| Test migration | [`f7-history-lagged-cache-baseline-0232.spec.js:60`](../tests/browser/f7-history-lagged-cache-baseline-0232.spec.js#L60) keeps the old reset, login, native-wheel, reload, and pulse actions. It asserts only the public resumed surface (readable rows, current tail, no gap, no duplicate IDs); it does not reopen the old scheduler event or old database. |

The current Feed `history.batch_complete` source remains useful diagnostic
evidence, but its internal `indexeddb → network → indexeddb` ordering is not a
user-visible contract and is not a pass gate. The test still requires the
readable tail, a satisfied native top demand, the physical cache row bound,
reload readability, unique presentation IDs, and a bounded tail gap.

## Exact current result

Focused Chromium `--repeat-each=3` was run in the detached worktree from the
current test-only candidate:

```text
ATOLL_TEST_WEB_PORT=16535 ATOLL_TEST_MOCK_PORT=19535 \
  npx playwright test tests/browser/f7-history-lagged-cache-baseline-0232.spec.js \
  --config=playwright.config.js --workers=1 --repeat-each=3 --reporter=line
3 passed / 3 repetitions
```

All three repetitions pass the user-visible obligations: initial tail is
readable, a physical page completes, the top intent settles, the canonical
Replica cache reaches `>=160` rows, returning to tail reaches a gap `<=24`,
and the reloaded page reconnects with `c0 动态 #19` visible. The test then
checks non-empty, unique presentation row IDs and a resumed tail gap `<=24`.

Representative non-gating completion evidence from the earlier diagnostic run:

```json
{
  "source": "network",
  "priority": "background",
  "generation": 1,
  "attachEpoch": 1,
  "ref": "history_before-5",
  "rows": 44,
  "acceptedRows": 44,
  "hasOlder": true,
  "beforeSeq": 729,
  "requestedBeforeSeq": 859,
  "nextBeforeSeq": 729,
  "scanLowSeq": 729,
  "scanHighSeq": 858
}
```

Disposition: **PASS / test-only public-contract migration**. No product source
was changed. The Reading consumer remains the user-demand owner and Feed/Replica
remain the existing history and cache owners. Any future source-order work must
be tracked separately from this user-visible TC0232 contract.
