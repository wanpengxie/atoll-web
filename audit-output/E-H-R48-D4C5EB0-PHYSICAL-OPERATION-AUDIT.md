# E–H Round 48 — d4c5eb0 PhysicalOperation audit

Date: 2026-09-20  
Scope: read-only acceptance of Feed candidate
d4c5eb027033c2c7b1b07bd55c8f6ddf234c46ad. No product or committed test
change was made in this round.

## Verdict

**REJECT.**

The candidate correctly separates one physical range from caller-specific
waiters for ordinary projections and fences principal/world/attach replacement,
but it has three blocking semantic failures:

1. a later caller for a different physical range can clear the channel's
   global demand status while the earlier range is still pending;
2. a foreground waiter joining a queued background operation does not update the
   batch object captured by the source adapter, so the wire request remains
   background/anticipatory;
3. two callers with different reveal/Admission tokens overwrite one
   channel-global Admission transaction; the first token is stale and the
   second token can be reset instead of reaching its normal
   pending-baseline-commit settle.

The cache owner itself does prevent a replacement principal/world from reading
an old fire-and-forget save. Abort and authority late-result cases otherwise
pass.

## Baseline run

On a clean detached worktree at d4c5eb0:

~~~text
npx vitest run \
  tests/channel-feed-runtime-physical-operation.test.jsx \
  tests/channel-feed-runtime-concurrent-completion.test.jsx \
  tests/channel-feed-runtime.test.jsx \
  tests/history-scheduler-modules.test.js --reporter=verbose

Test Files  4 passed (4)
Tests       41 passed (41)
~~~

The green baseline is not sufficient for the contracts below: it does not
exercise different physical ranges on one channel, two reveal tokens, or the
wire payload after a queued promotion.

## Case-by-case result

| Scenario | Result | Evidence and owner |
|---|---|---|
| Two callers, same physical range, different viewSpec | **ACCEPT** | Candidate test [channel-feed-runtime-physical-operation.test.jsx:38](../tests/channel-feed-runtime-physical-operation.test.jsx:38) produced one wire request and two distinct promises. The all projection had 2 items while mine had 1; one history.batch_complete was published. historyViewSpecSnapshot and settleWaiterFromPhysical are the right Feed/Replica boundary. |
| First caller aborts, second caller remains | **ACCEPT** | Candidate test [channel-feed-runtime-physical-operation.test.jsx:99](../tests/channel-feed-runtime-physical-operation.test.jsx:99) leaves the physical request alive, resolves the second waiter, and does not call cancelHistory. |
| Second caller aborts, first caller remains | **ACCEPT** | Independent probe: second promise resolves kind cancelled/reason aborted; the first remains pending, receives the same page, and settles satisfied; no duplicate request. |
| Last waiter aborts | **ACCEPT** | Independent probe: one abort resolves cancelled, historyFor(c0) returns loading false/historyDemand idle, cancelHistory is called exactly once, a late page is rejected, and Replica has no rows. |
| Background operation promoted by a foreground waiter | **REJECT** | Independent queued probe kept two executor slots occupied, started c0 as anticipatory, then joined it with interactive. The eventual c0 historyBefore detail was still priority background/urgency anticipatory, not foreground/interactive. See first failure below. |
| Principal replacement while the page is in flight | **ACCEPT** | Candidate test [channel-feed-runtime-physical-operation.test.jsx:137](../tests/channel-feed-runtime-physical-operation.test.jsx:137) cancels the waiter with stale-generation, rejects the old pageEnd, and leaves no old Replica row. |
| World/attach replacement while the page is in flight | **ACCEPT** | Candidate test [channel-feed-runtime-physical-operation.test.jsx:157](../tests/channel-feed-runtime-physical-operation.test.jsx:157) rejects the old generation/ref and leaves no stale row. attachEpoch and worldEpoch are included in the operation authority. |
| Fire-and-forget cache.saveRows after authority replacement | **ACCEPT for cross-authority isolation** | Direct IndexedDB probe changed cache owner between put and transaction completion. The save rejected cache_owner_changed; the replacement owner read zero rows, while an explicit old-owner reader saw only the old-owner row. saveRows captures owner/epoch at [channel-replica.js:1291](../src/model/channel-replica.js:1291), and persistBatch asserts before and after the transaction at [channel-replica.js:971](../src/model/channel-replica.js:971). Runtime's ignored promise at [channel-feed-runtime.js:1247](../src/model/channel-feed-runtime.js:1247) cannot cross-write into the replacement owner. An old-owner transaction may finish physically after revocation, but it remains keyed to the old owner and is unreadable by the replacement. |
| Network error after a cache prefix | **ACCEPT** | Existing candidate test [channel-feed-runtime.test.jsx:936](../tests/channel-feed-runtime.test.jsx:936) retains the cached row, returns kind failed, leaves hasOlder true/historyDemand error, and calls onError once. It does not convert the prefix into local EOF. |
| Different physical ranges on one channel | **REJECT** | Independent probe: range A (beforeSeq 3) remained in flight; range B (beforeSeq 5) completed first. Immediately after B, historyFor(c0) was loading false, foregroundLoading false, historyDemand phase idle even though A had not received pageEnd. |
| Two callers with different reveal/Admission tokens | **REJECT** | A single reveal leaves presentationAdmissionState phase pending-baseline-commit after page materialization. Two callers (reveal-a/c0:all and reveal-b/c0:mine) leave only token B in pending before the page; after completion the state is idle with no committed token. The first waiter observes stale against B, then admission.settle resets B because it has no staged IDs. This violates independent waiter Admission settle. |

## First blocking breakpoints

### 1. Demand status is a single revision, not a live-operation aggregate

The candidate starts a channel-global demand in
[channel-feed-runtime.js:1063](../src/model/channel-feed-runtime.js:1063) and
increments operation.demandRevision. Each physical operation on the same
channel gets another revision. Settlement clears only when its own revision is
current at [channel-feed-runtime.js:1077](../src/model/channel-feed-runtime.js:1077).
That revision guard protects an older operation from clearing a newer one, but
it does not protect a newer operation from clearing an older one: operation B
owns the newest revision, so B settles and clears the status while operation A
is still pending. The global loading/foregroundLoading/backgroundLoading
fields then lie about A.

Reproduction (temporary, uncommitted probe):

~~~text
range A: loadHistory(c0, {beforeSeq: 3, limit: 2})  # page held
range B: loadHistory(c0, {beforeSeq: 5, limit: 2})  # page completes first
status after B:
  loading: false
  historyDemand: {revision: 2, phase: "idle"}
range A: still has no pageEnd
~~~

This is the first direct lifecycle red: it is observable without any private
export and can make Reading stop showing an active demand while an older
physical operation still owns a real network wait.

### 2. Promotion changes operation.batch, not the queued adapter batch

[promotePhysicalOperation](../src/model/channel-feed-runtime.js:1122)
updates operation.batch and calls the executor handle's promote, but
[runPhysicalOperation](../src/model/channel-feed-runtime.js:1165) has already
captured let batch = operation.batch, and
[executeBatch](../src/model/channel-feed-runtime.js:946) closes over that
original object in adapters.execute(batch). When the job is queued, promotion
can change queue order but cannot change the priority and urgency sent by
[history-source-adapters.js:57](../src/model/history-source-adapters.js:57).
The existing executor unit test proves ordering only; it does not prove the
wire detail.

Observed result:

~~~text
foreground waiter joined queued c0 operation
wire request detail:
  priority: "background"
  urgency: "anticipatory"
expected:
  priority: "foreground"
  urgency: "interactive"
~~~

This is a foreground takeover failure even though the scheduler's queue order
test is green.

### 3. Admission is channel-global while waiter reveal is caller-local

attachHistoryWaiter creates one reveal token per waiter at
[channel-feed-runtime.js:1362](../src/model/channel-feed-runtime.js:1362), but
createHistoryPresentationAdmission stores only one state per channel.
admission.begin for token B replaces token A. On page settlement,
settleWaiterFromPhysical then observes each token in waiter order. A's
observation is stale against B; its subsequent admission.settle can reset B
because B has no staged IDs yet. B has no valid pending transaction left to
settle. A and B still receive a raw projection result, so a promise-only test
looks green while the public Admission owner is wrong.

This is why separate waiter promises do not by themselves prove separate
reveal semantics. Either reveal ownership must remain singular and additional
reveal callers must be rejected/merged by an existing owner, or the existing
Admission owner needs a caller-safe sequencing rule; this audit does not
authorize a new owner or compatibility path.

## Authority and cache conclusion

The candidate's authority fence is sound for the requested late-result cases:

* physicalAuthorityCurrent checks principal epoch, world epoch, generation,
  attach epoch, attached/current status, operation retirement, and abort state
  at [channel-feed-runtime.js:1024](../src/model/channel-feed-runtime.js:1024);
* principal replacement cancels operations before cache-owner selection at
  [channel-feed-runtime.js:1549](../src/model/channel-feed-runtime.js:1549);
* attach/world replacement cancels operations before replacement cache/meta work
  at [channel-feed-runtime.js:1603](../src/model/channel-feed-runtime.js:1603);
* disconnectHistory and destroy cancel operations before clearing lifecycle
  stores;
* the cache's owner/epoch checks isolate the ignored saveRows promise.

These passes do not offset the demand, promotion, and Admission failures.

## Acceptance gate for a revised candidate

Before acceptance, rerun the same public probes and require:

1. a later different-range completion cannot clear status while any admitted
   operation remains pending; status must represent the current set/owner, not
   only the latest revision;
2. a queued background operation joined by a foreground waiter sends a
   foreground/interactive batch, not merely a promoted queue position;
3. different reveal callers either have an explicit existing serialization
   contract or each retain a valid Admission settle/cleanup path;
4. first/second/last waiter aborts continue to show the pass behavior above;
5. principal/world/attach late pages and late cache saves remain fenced;
6. cache-prefix plus network failure remains visible and explicitly failed,
   never local EOF.

No source, product, or committed test file was changed for this audit.
