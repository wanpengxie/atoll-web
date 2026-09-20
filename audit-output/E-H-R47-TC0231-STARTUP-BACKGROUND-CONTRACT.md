# E–H Round 47 — TC0231 startup warm contract

Date: 2026-09-20  
Scope: read-only architecture review and public browser oracle. No product
change, no new owner, and no change to the 6ab concurrent-operation join.

## Decision

**REJECT the current startup behavior for the requested contract.** The public
probe is healthy as an observation (one browser run passed), but the observed
state is the wrong contract: startup enters a foreground history demand and
Reading reports `pending`. The current first network page contains 42 physical
rows and `hasOlder: true`; it does not prove a 128-row warm working set and it
does not prove that a Feed-owned continuation exists.

The requested contract is:

* startup cache warm is a Feed-internal, finite, anticipatory obligation;
* channel entry remains readable and does not wait on that obligation;
* Reading does not enter its user-facing history-demand `pending` phase merely
  because warm work is running;
* a foreground wheel/older-history action may preempt the warm work;
* every continuation is bounded by a progress/EOF/budget rule and every result
  is fenced by the current attach, world, and principal;
* the 6ab physical-range join remains a separate exact-once concern.

## Case ledger

| Case | Old action and observable | User capability | Invariant | Current public owner and evidence | Current result |
|---|---|---|---|---|---|
| TC0231 | Reset `huge-history`, seed 1710; log in; wait for startup warm; inspect persisted rows and public page receipts; reload; issue one native top wheel and inspect one physical demand. The baseline test is [`f7-history-warm-cache-baseline-0231.spec.js:34`](../tests/browser/f7-history-warm-cache-baseline-0231.spec.js:34). | A user can enter a channel and read the current tail immediately while older rows become durable in the background; an explicit top-wheel can browse older history even while warm is incomplete. | Durable physical rows, not display rows or metadata, determine warm coverage. `hasOlder: true` plus a non-empty page requires a continuation unless EOF/no-progress/budget says otherwise. Each physical page has one canonical receipt/completion; no local echo or unrelated row may satisfy it. | Feed runtime is the physical history owner (`loadHistoryOnce`, cache commit, `history.batch_complete`); the current trigger is [`WorkspaceApp.jsx:953`](../src/app/WorkspaceApp.jsx:953), which calls `loadHistory(... initial-view, blocking)`. Reading owns user-driven demand through [`WorkspaceApp.jsx:1018`](../src/app/WorkspaceApp.jsx:1018) and `useHistoryConsumer`, not startup warm. The 6ab join is [`channel-feed-runtime.js:926`](../src/model/channel-feed-runtime.js:926)–[`channel-feed-runtime.js:1191`](../src/model/channel-feed-runtime.js:1191). | **RED for the requested architecture.** The clean browser oracle observed `foregroundLoading=true`, `backgroundLoading=false`, Feed demand `pending`, Reading `initializing=true/historyDemand.pending`, and a first `history.batch_complete` with `priority: foreground`, `rows: 38`, `acceptedRows: 38`, `hasOlder: true`, `beforeSeq: 99877`, `requestedBeforeSeq: 100007`. After settlement it observed only 42 physical rows and no background continuation. |

The old baseline's “cache >=128” assertion is retained as the user-visible
working-set capability. It must not be replaced by “one page completed” or by a
display-row count. The target owner must preserve the same capability through
the new non-blocking startup path.

## Proposed public contract

### Startup (`42 rows`, `hasOlder: true`)

After the current grant, world, principal, and local replica are admitted, Feed
starts one internal anticipatory operation. It may use the existing Feed
history request path and cache owner, but it must not be initiated as a
foreground `initial-view` request by Reading or by a UI loading gate.

The public browser oracle should observe all of the following while the warm
obligation is outstanding:

* `cold_entry.snapshot.history.foregroundLoading === false`;
* `cold_entry.snapshot.reading.historyDemand.phase === 'idle'` and the Reading
  surface remains mounted/readable;
* `cold_entry.snapshot.history.backgroundLoading === true` is allowed as
  internal Feed status, but it must not create `.timeline-history-demand` or a
  foreground `.timeline-history-status`;
* `history.batch_complete.detail.priority === 'background'` for warm pages;
* the cache/physical-row oracle reaches the target or a terminal condition,
  rather than inferring completion from `hasOlder: true`.

The target is a physical durable working set (the baseline target is at least
128 rows and less than 1,000), not `history.completedPages`,
`acceptedRows` of one projected page, or visible timeline rows. A page with
42 rows and `hasOlder: true` therefore schedules another page. If local cache
coverage is only the retained tail, Feed may publish each canonical page as it
arrives and continue against the next cursor; it must not treat the first
non-empty cache page as completion.

### Foreground takeover

While warm is pending, a real user wheel/top or explicit older-history action
creates the foreground demand owned by Reading/Feed. The observable contract
is:

1. the action emits one public `history.intent_started` with an interactive or
   blocking urgency and its real reason;
2. warm work yields, is cancelled, or is superseded according to the existing
   Feed executor, while the foreground page is given priority;
3. each physical range still has one canonical `wire.page_end` and matching
   `history.batch_complete` reference; no second completion is manufactured;
4. Reading may show its demand status only for this user action, and returns to
   idle after the canonical page is materialized.

This is deliberately not a request to change `historyOperationKey`. 6ab proves
that concurrent callers for the same admitted range share one promise and one
completion. Warm budgeting/priority is a lifecycle obligation above that join;
one joined completion is not evidence that warm coverage reached 128 rows.

### Budget and terminal progress

Warm work needs a finite bound using existing Feed page/byte/transport limits
(`HISTORY_PAGE_SIZE`, `HISTORY_BATCH_BYTES`, and the existing executor
timeout), not an unbounded retry loop or a new public owner. At the bound, the
Feed background status becomes idle and the channel remains usable. A budget
stop is not a Reading error and must not manufacture a successful EOF.

Two terminal cases must be distinguished in the acceptance evidence:

* **EOF:** a canonical page reports `has_older: false` (including the empty
  page with `next_before_seq: 0`). Warm settles once, no later
  `history_before` is issued, and the status is idle with no Reading
  `pending`/error.
* **No progress:** the response claims older data but has zero accepted rows or
  does not advance `next_before_seq` below the requested cursor. Feed stops the
  continuation once, records the bounded terminal outcome, and does not spin
  repeated identical requests. This is not equivalent to EOF.

The existing empty-EOF and lifecycle evidence in
[`channel-feed-runtime.test.jsx:169`](../tests/channel-feed-runtime.test.jsx:169),
[`channel-feed-runtime.test.jsx:239`](../tests/channel-feed-runtime.test.jsx:239),
and [`channel-feed-runtime.test.jsx:324`](../tests/channel-feed-runtime.test.jsx:324)
is useful owner evidence, but it does not yet prove startup warm continuation
or no-progress bounding.

### Lifecycle fencing matrix

| Event during warm | Required Feed action | Public evidence required | Reading outcome |
|---|---|---|---|
| disconnect/reconnect | Cancel the old background lease and in-flight batches; clear pending demand; a replacement grant starts only a current obligation. | `.connection-state.state-reconnecting` then `state-open`; no old `wire.page_end`/`history.batch_complete` is accepted after the attach epoch changes; no stale cache write. | No stale `pending`, no old rows presented as current. |
| world/boot change | Fence old generation/attach epoch; reselect the current cache owner before applying rows. | `wire.attached`/grant boot changes; old generation page is rejected; current page carries the new generation/world. | Current channel may become readable again; old operation cannot complete it. |
| principal change | Retire the old principal epoch and cache owner; select the new `(principal, world)` owner before warm resumes. | Old principal rows/receipts are not visible under the new identity; no old background completion is published. | No cross-principal warm state or error. |
| runtime clear/destroy | Abort leases and batches, clear deferred/join state, and make old snapshots fail closed. | No late completion or row insertion after destroy; `loadHistory` is cancelled and no new network request is sent. | No resurrected demand. |

`disconnectHistory` already cancels background interests and fences generation
at [`channel-feed-runtime.js:1609`](../src/model/channel-feed-runtime.js:1609);
principal/world admission is fenced in [`channel-feed-runtime.js:1312`](../src/model/channel-feed-runtime.js:1312)
and [`channel-feed-runtime.js:1407`](../src/model/channel-feed-runtime.js:1407);
destroy clears background work at [`channel-feed-runtime.js:1955`](../src/model/channel-feed-runtime.js:1955).
Those are the current public owner boundaries to verify, not invitations to
create another controller.

## Browser oracle and result

A disposable public probe was run against the clean product at `97ba8dc` (the
later HEAD `7c53338` contains no product change in this path):

```text
npx playwright test tests/browser/r47-tc0231-startup-oracle.spec.js \
  --config=playwright.config.js --workers=1 --reporter=line
1 passed (10.5s)
```

The probe used only public browser surfaces: `/mock/control/reset`, login,
`window.__ATOLL_DIAGNOSTICS__.snapshot()`, `cold_entry.snapshot`,
`history.intent_started`, `history.batch_complete`, the public status DOM, and
the mounted-row selector. It sampled 20 times at 250 ms. The first and settled
observations were:

```json
{
  "first": {
    "history": {
      "loading": true,
      "foregroundLoading": true,
      "backgroundLoading": false,
      "demand": {"revision": 2, "phase": "pending"},
      "completedPages": 0,
      "beforeSeq": 100007
    },
    "reading": {
      "initializing": true,
      "availability": "syncing",
      "historyDemand": {"revision": 2, "phase": "pending", "error": false}
    },
    "events": [
      {"event": "history.intent_started", "reason": "projection-underfill", "urgency": "anticipatory", "intent": "scroll-history"},
      {"event": "history.batch_complete", "priority": "foreground", "source": "network", "rows": 38, "acceptedRows": 38, "hasOlder": true, "requestedBeforeSeq": 100007, "nextBeforeSeq": 99877}
    ]
  },
  "settled": {
    "history": {
      "loading": false,
      "foregroundLoading": false,
      "backgroundLoading": false,
      "loaded": true,
      "demand": {"revision": 2, "phase": "idle"},
      "completedPages": 1,
      "beforeSeq": 99877
    },
    "reading": {
      "initializing": false,
      "availability": "readable",
      "historyDemand": {"revision": 0, "phase": "idle"}
    }
  }
}
```

The DOM had no visible history status in this short sample, but that does not
cancel the contract failure: the public diagnostic state still reports a
foreground/pending startup demand and Reading `syncing`. The probe's pass
means only that the observation harness was valid; this audit's architecture
verdict is **REJECT** until the same probe observes background-only startup and
a bounded continuation from 42 rows with `hasOlder: true`.

## Acceptance sequence for the product owner

1. Keep this probe as the startup oracle and add a strict assertion for
   foreground false, Reading demand idle, and background completion priority.
2. Extend it with a physical IndexedDB row count and canonical receipt/ref
   pairing until `>=128`, then repeat after reload.
3. Add a delayed-page fixture to issue a real wheel during warm; assert
   foreground priority and one completion per fixed page/ref.
4. Add EOF and no-progress fixtures and assert one terminal settlement with no
   repeated cursor.
5. Run disconnect, world/boot, principal, and destroy checks using the matrix
   above. Re-run the existing 6ab suite independently; do not make it carry
   warm-budget assertions.

No tests were weakened, skipped, deleted, or changed in this round; this file
is the test/audit handoff for the Feed owner.
