# E–H Round 50 — Feed v2 independent attack of `b3bf7b3`

Date: 2026-09-20  
Scope: read-only product verification plus a temporary test file outside the
repository. No product source, committed test, package, vendor, or lockfile
was changed.

## Frozen commits and commands

The root checkout was `97c7938cae79a13f7d998e551ea02c7fc1334169` and the
candidate under attack was its direct Feed parent
`b3bf7b3573c7895bfedb01d1fe7a4033fbdbf484`. Independent detached worktrees
were used at `/tmp/atoll-r50-head` and `/tmp/atoll-r50-b3`.

The frozen baseline command on both exact worktrees was:

```text
npx vitest run tests/channel-feed-runtime-physical-operation.test.jsx \
  tests/channel-feed-runtime-concurrent-completion.test.jsx \
  tests/channel-feed-runtime.test.jsx \
  tests/history-scheduler-modules.test.js --reporter=verbose
```

Results:

* `97c7938`: 4 files, 44 tests passed.
* `b3bf7b3`: 4 files, 44 tests passed.

The independent attack file was only
`/tmp/atoll-r50-b3/tests/r50-independent-feed-attack.test.jsx`; it was not
copied into the repository. It exercised seven public-owner cases. Result:
**4 passed, 3 failed**.

## Case ledger and result

| Case | User capability | Invariant and public owner | Baseline action / observable | Candidate result | Disposition |
|---|---|---|---|---|---|
| R50-01 raw/background | Background history warming can populate Feed without presenting a Reading load | One raw physical batch; caller semantics stay in the Feed semantic lease; owner is `ChannelFeedRuntime` → `historyBefore`, `historyFor` | `loadHistory(c0,{urgency:'anticipatory',intent:'search-prefetch'})`; wire had `priority:'background'` and no `purpose/intent/urgency/rangeKind`; `historyDemand.phase` stayed `idle`, background flags cleared after page | PASS | Accept; same user capability and owner preserved |
| R50-02 same authority join | Duplicate callers of one reveal authority share one physical page and one Admission transaction | Existing Admission owner; Feed semantic identity joins by view/epoch/activation while raw owner remains range keyed | Two same-range callers with same view/epoch/activation but different operation IDs generated one request and retained the first token; frozen baseline join case also passed | PASS (join portion) | Accept join evidence; do not infer replacement safety from this case |
| R50-03 different authority replace / stale waiters | A new activation/view/epoch must supersede the old user action without leaving a hanging promise | `ChannelFeedRuntime` `semanticDemandFor`/`retireSemanticDemand`; old waiter and physical ref must be retired before the new Admission owner proceeds | Start A and a same-authority join, then start B with new activation+epoch before A page. A and join promises never became `{kind:'cancelled',reason:'stale-authority'}` within 100 ms; they timed out | **REJECT** | Product regression packet P-R50-01; owner boundary is Feed semantic lease bookkeeping |
| R50-04 old physical ref after semantic replace | A stale raw page cannot mutate Replica or settle the replacement | `ChannelFeedRuntime` physical authority/ref admission; old `pageEnd` must be false and new request must have a new ref | Start A, start B with new semantic authority, then call old A `pageEnd` before B. It returned `true` instead of `false` | **REJECT** | Product regression packet P-R50-01; same first owner boundary, not a cache/fixture issue |
| R50-05 two-range completion | Two physical ranges on one channel remain represented until the last range settles | Feed active-physical aggregate; `historyFor(c0).loading/foregroundLoading` | Start A before 3 and B before 6; complete B first, then A. Loading/foreground remained true after B and became false only after A | PASS | Accept reverse completion |
| R50-06 two-range failure aggregate | One range failure must not make a still-active aggregate idle; terminal aggregate error remains explicit | Feed semantic demand aggregate; `historyDemand` phase/error | Fail B (`offline`) while A remains pending, then complete A. Candidate exposed `{phase:'idle',error:'offline'}` rather than terminal `{phase:'error',error:'offline'}` | **REJECT** | Product regression packet P-R50-02; stale error/idle state is not a fixture issue |
| R50-07 queued promotion | A foreground caller joining queued background work must affect the actual wire request | Existing bounded executor + HistorySourceAdapters; `loadHistory`/lease promotion and `historyBefore` are the public boundary | Occupy two executor slots, start c0 anticipatory, join c0 blocking, release blockers. c0 wire request carried `priority:'foreground'` | PASS | Accept |
| R50-08 cache late write | Owner replacement cannot expose a late save to the new owner; old data may remain only under its keyed owner | `ChannelReplicaCache.saveRows` owner/epoch fence; public `ensureOwner/readBefore` | Delay IndexedDB transaction completion after `put`, switch owner, then finish. Save rejected `cache_owner_changed`; new owner read zero rows; old owner read only its own row | PASS | Accept cross-authority cache isolation |

## Product-regression packets

### P-R50-01 — semantic replacement does not retire old Feed leases

Minimal reproduction (public API only):

```text
setHistoryGrants([{channel_id:'c0', head_seq:20, has_rows:true}], generation 1)
A = loadHistory('c0', {beforeSeq:3, limit:2, urgency:'blocking',
    historyRevealIntent:{viewID:'c0:timeline', epoch:'c0:1', activationID:'a',
      operationID:'old'}})
J = loadHistory('c0', {same physical range, same viewID/epoch/activationID,
    operationID:'join'})
B = loadHistory('c0', {beforeSeq:4, limit:2, urgency:'blocking',
    historyRevealIntent:{viewID:'c0:timeline', epoch:'c0:2', activationID:'b',
      operationID:'new'}})
```

Observed on `b3bf7b3`: B gets a second wire ref, but A/J remain unresolved and
the old ref accepts `pageEnd` (`true`). The old physical operation can therefore
settle its old waiters and install rows after the new semantic authority is
current. This is a real user regression: a changed Reading activation can hang
and a stale page can overwrite the current presentation.

First owner boundary: the Feed semantic lease. `retireSemanticDemand` only
settles `demand.waiters` and retires an operation when its
`operation.waiters` set is empty ([channel-feed-runtime.js:1148](../src/model/channel-feed-runtime.js:1148)).
`attachHistoryWaiter` creates the waiter and adds it only to
`operation.waiters`; it does not register it in `semanticDemand.waiters`
([channel-feed-runtime.js:1545](../src/model/channel-feed-runtime.js:1545)).
Consequently the semantic replacement sees an empty demand waiter set while
the operation still has live old waiters. The old operation is neither retired
nor cancelled, and its old network ref remains accepted by `pageEnd`.

Required owner-preserving repair: register each waiter with its existing
semantic demand and ensure replacement retires/cancels that operation before
the new demand can proceed. Do not add a compatibility owner or alter the
test to accept a stale page.

### P-R50-02 — aggregate failure ends as `idle` with an error

Minimal reproduction: start two blocking ranges on c0 (before 3 and before 6),
fail the second with `offline`, keep the first pending, then complete the first.
The second waiter correctly resolves failed and loading remains true while the
first is active. After the first succeeds, the public state is
`historyDemand:{phase:'idle',error:'offline'}`.

First owner boundary: Feed semantic demand aggregate. The failed operation
stores `demand.error`, but the later successful operation chooses the `idle`
phase while forwarding the retained error through
`settleSemanticOperations` ([channel-feed-runtime.js:1218](../src/model/channel-feed-runtime.js:1218)).
The public contract allows a per-range error while another range is active and
requires an explicit terminal aggregate error after all ranges finish; it must
not publish the contradictory idle-with-error state.

Required owner-preserving repair: make the terminal aggregate phase/error
consistent with the existing Feed contract (for example, retain `error` phase
when any constituent range failed), then re-run the exact two-range failure
case. No test weakening or range merging is authorized.

## Acceptance decision

**REJECT `b3bf7b3` for the E–H Feed v2 four-layer contract.** Raw batch purity,
same-authority join evidence, reverse range aggregation, queued promotion, and
cache late-write isolation pass. The two semantic replacement failures and the
inconsistent aggregate terminal error remain product regressions and require
their existing Feed owner to repair before acceptance. The root `97c7938` has
the same 44/44 frozen baseline result; no green count substitutes for the
failed public contracts above.
