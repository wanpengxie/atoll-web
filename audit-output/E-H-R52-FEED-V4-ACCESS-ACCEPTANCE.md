# E–H Round 52 — Feed v4 access-authority acceptance

Date: 2026-09-20  
Scope: the two final Feed v4 access-failure obligations only. No product or
committed test file was edited by the verifier.

## Exact candidate and isolation

* Candidate: `badd7ef48ef412ea51fa71edd6c525b0d4689603`
* Base: `16ea78935c7d690e8a7655d62b3c52dc06ba2e4e`
* Candidate worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-v4`
* Independent verifier worktree: `/tmp/atoll-feed-v4`, detached at the exact candidate SHA

The candidate worktree was clean. The verifier's temporary test was
`/tmp/atoll-feed-v4/tests/r50-feed-v4-access-acceptance.test.jsx`; it was not
copied into the repository.

Focused candidate test:

```text
npx vitest run tests/channel-feed-runtime-physical-operation.test.jsx \
  --testNamePattern='ignores a late forbidden probe from a replaced physical authority' \
  --reporter=verbose
```

Result: **1 passed, 12 skipped**. The independent verifier ran both required
cases: **2 passed, 2 total**.

## Required case ledger

| Case | User capability | Invariant / current public owner | Exact action and observable | Result |
|---|---|---|---|---|
| Old-authority forbidden isolation | A late denial from a retired connection must not revoke a current grant or clear the current roster | `ChannelFeedRuntime` owns the complete physical authority tuple `(principalEpoch, worldEpoch, generation, attachEpoch)`; access/roster ports are the existing public revoke consumers | Start `refreshChannel(c0)` under old authority; replace same-generation grant with a new world; reject the old probe as `forbidden`. The old probe resolves `false`, while current `historyFor(c0)` remains `attached:true`, `messageCurrent:true`; `access.forbidden`, `roster.clearSelf`, `onAccessChanged`, and `onError` are all untouched | **PASS / ACCEPT** |
| Current-authority forbidden projection | A real current denial must revoke access and present the normal access-failure transition | Current Feed authority → `projectAccessFailure` → existing access forbidden/roster clearSelf/onAccessChanged ports; no generic error owner | Reject `refreshChannel(c0)` with current `forbidden`. It resolves `false`, calls `access.forbidden('c0')`, `roster.clearSelf('c0')`, and `onAccessChanged` once, leaves `onError` untouched, and publishes `attached:false`, `messageCurrent:false`, `controlCurrent:false`; a second refresh is not sent after the grant is revoked | **PASS / ACCEPT** |

## First safety boundary

`authorityTupleCurrent` is the first boundary: a failure is projectable only
when the principal/world/generation/attach tuple and current channel status all
match ([channel-feed-runtime.js:650](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-v4/src/model/channel-feed-runtime.js:650>)).
`projectAccessFailure` then performs the existing forbidden transition—removes
the grant, clears attached/message/control current state, advances the
notification authority revision, and notifies the access/roster owners
([channel-feed-runtime.js:667](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-v4/src/model/channel-feed-runtime.js:667>)).
The candidate's old-authority regression test exercises the late probe path
directly ([channel-feed-runtime-physical-operation.test.jsx:400](</home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/r50-feed-v4/tests/channel-feed-runtime-physical-operation.test.jsx:400)).

## Decision

**ACCEPT `badd7ef48ef412ea51fa71edd6c525b0d4689603` for the declared Feed v4
double gate.** Retired-authority forbidden results cannot revoke the new grant
or roster, while a current forbidden result still follows the normal access
failure owner and public detached state.
