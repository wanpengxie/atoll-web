# E–H Round 51 — Feed v3 P0 acceptance

Date: 2026-09-20  
Scope: the two obligations named by the P0 convergence contract only. No
product or committed test file was edited by the verifier.

## Exact candidate and isolation

* Candidate: `16ea78935c7d690e8a7655d62b3c52dc06ba2e4e`
* Base: `0410012960ba5d1710502fe24fa679e5b3c7fb08`
* Candidate worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack`
* Independent verifier worktree: `/tmp/atoll-r50-v3`, detached at the exact candidate SHA

The candidate worktree was clean. The verifier's temporary test was
`/tmp/atoll-r50-v3/tests/r50-v3-independent-acceptance.test.jsx` and was not
copied into the repository.

Focused candidate tests:

```text
npx vitest run tests/channel-feed-runtime-physical-operation.test.jsx \
  --testNamePattern='retires every waiter of a replaced reveal demand|keeps aggregate demand pending across failure plus success' \
  --reporter=verbose
```

Result: **2 passed, 10 skipped**. The independent verifier reproduced the same
two cases: **2 passed, 2 total**.

Priority downgrade, immediate cancellation, and arbitrary interleavings were
not used as acceptance or rejection criteria, per the P0 convergence decision.

## Required case ledger

| Case | User capability | Invariant / current public owner | Exact action and observable | Result |
|---|---|---|---|---|
| Replacement old waiter/result isolation | A new Reading activation can replace an in-flight history reveal without an old promise hanging or an old page writing current rows | `ChannelFeedRuntime` semantic demand lease owns waiter/result authority; `enqueue`/`pageEnd` are the existing physical receipt boundary; Replica is the only canonical row state | Start old reveal A (`beforeSeq:3`, activation `old`), then replacement B (`beforeSeq:6`, activation `new`). A resolves `{kind:'cancelled',reason:'stale-authority'}`; current Admission token is `new`; old `enqueue` is `false`; old `pageEnd` is `false`; old row is absent; B row installs and B resolves satisfied | **PASS / ACCEPT** |
| Public terminal error shape | A range failure followed by successful completion of the same aggregate must not leave contradictory public state | `ChannelFeedRuntime` semantic demand aggregate publishes `historyDemand` and `status.error`; no second error owner | Fail range A with `offline` while range B remains active. Public state stays `loading:true`, `historyDemand.phase:'pending'`. Complete B; terminal public state is `historyDemand:{phase:'idle',error:''}` and `status.error === ''` | **PASS / ACCEPT** |

## First safety boundaries

Replacement safety is established at the semantic lease boundary:

* `retireSemanticDemand` advances the semantic authority fence, iterates the
  waiter-to-operation map, settles every old waiter, and retires an orphaned
  physical operation ([channel-feed-runtime.js:1158](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack/src/model/channel-feed-runtime.js:1158>)).
* `attachHistoryWaiter` registers the waiter in that map before invoking the
  caller callback ([channel-feed-runtime.js:1591](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack/src/model/channel-feed-runtime.js:1591>)).
* A physical completion checks the demand authority before projecting or
  settling a waiter ([channel-feed-runtime.js:1477](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack/src/model/channel-feed-runtime.js:1477>)).
* An unknown retired ref is rejected rather than falling through to live-row
  ingestion ([channel-feed-runtime.js:1713](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack/src/model/channel-feed-runtime.js:1713>)); `pageEnd` also rejects a missing/stale batch ([channel-feed-runtime.js:1741](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack/src/model/channel-feed-runtime.js:1741>).

The terminal-state boundary is the semantic aggregate, not an individual
physical callback. `finishSemanticDemand` publishes `error` only when an
unsatisfied demand has a terminal error; otherwise it clears both the public
phase error and `status.error`, preventing `idle+error`
([channel-feed-runtime.js:1132](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-attack/src/model/channel-feed-runtime.js:1132>)).

## Decision

**ACCEPT `16ea78935c7d690e8a7655d62b3c52dc06ba2e4e` for the declared two-case
P0 gate.** Both independent public-owner reproductions pass on the exact SHA;
no stale replacement result reaches the new authority, and no public terminal
state exposes `idle+error`.
