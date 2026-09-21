# A–D reservation — TC-0456 / AD-162 Feed producer-owner fence

## Reservation

- **Case key:** `TC-0456` (A–D alias `AD-162`)
- **Baseline:** `fae8b70:tests/channel-feed-startup.test.jsx:315`
- **Baseline title:** `carries the committed producer owner through rAF batching and delayed roster callbacks`
- **Current base:** `d754f0d4e8b13ec316630732a86adb18a4b967d5`
- **Branch:** `unit-a-d/tc0456-feed-owner-d754f0d`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0456-feed-owner-d754f0d`
- **Allowed change:** this report and, if the public contract is not already exercised, an A–D test under `tests/`; no product source, package, lockfile, vendor, or private export.

## User contract

The user can receive a live channel row while the Feed owner is being committed or
replaced. A row admitted by the committed producer remains visible and its
submission/roster projection carries that same owner. A late callback or stable
enqueue retained by the replaced producer cannot write a row, cache entry, or
submission projection into the current channel.

The invariant is one public Feed/Replica owner fence over `(principal, channel,
boot/generation, revision)`: asynchronous batching and delayed callbacks may
settle, but they cannot cross the committed owner boundary or publish a false
success. The only current public owner is `createChannelFeedRuntime()` and its
typed `getOwnerSnapshot(ownerToken)` ingress; `ChannelReplica` is the canonical
row owner and `onSubmissionFeed`/roster ports are projections.

## Exact uniqueness precheck

1. The central `TEST-CASE-MIGRATION-LEDGER.md` has exactly one `TC-0456` row at
   line 807, and it is still `blocked pending product decision` in the static
   ledger.
2. Exact title/path search found no prior `TC-0456`, `TC0456`, `AD-162`, or
   dedicated `channel-feed-startup.test.jsx:315` reservation/closeout report
   outside the historical A–D restore inventory. No `TC-0456`/`AD-162` branch or
   worktree existed before this reservation.
3. The historical `RESTORE-CASES-A-D-20260919.md` row is an inventory note only;
   the later A–D verification does not include AD-162 in its independently
   promoted PASS set. This reservation supplies the missing current public-owner
   evidence and does not duplicate a prior dedicated claim.
4. Nearby central rows were not substituted: `TC-0457`/`AD-163` already has
   public-owner evidence in `blocked-round20-public-owner.test.jsx`, while
   `TC-1493`/`TC-1494` are already represented by SZ-322/SZ-323.

## Planned evidence

Drive the current `ChannelFeedRuntime` public owner with two immutable producer
tokens. Verify that the committed token publishes the landed row and owner
projection, then replace it and deliver a late row through the old public owner
snapshot. The final observable must retain only the current producer's row and
callback; no old row may reach the Replica or cache. If the current public API
cannot express the delayed-roster half of the baseline without a private export,
record that first boundary as a product/fixture gap rather than widening the API
or changing product code.

This is an atomic claim: the report is committed before focused execution. The
closeout will append the exact focused test/build results and the final
PASS/BLOCKED disposition.

## Current-owner verification

The successor was added only to the existing public
`tests/channel-feed-runtime.test.jsx` suite. It uses
`createChannelFeedRuntime`, `runtime.bind({ ownerToken })`,
`getOwnerSnapshot(ownerToken).enqueue`, `ChannelReplica.stateFor`,
`onSubmissionFeed`, and the public `rosterRef` port. It does not import a
private hook, inspect cache internals, add a store, or change product code.

The case drives owner A through an accepted live row, lets the submission and
roster projections settle across two animation-frame turns, then commits owner
B. The old owner-A snapshot is exercised again with a late row; the row,
submission callback, and roster callback are all absent from the current
projection. A current owner-B row remains visible and its callback carries
owner B. This proves the user-visible owner handoff and the no-late-write
invariant at the current public Feed/Replica boundary.

Focused command and result:

```text
npm test -- tests/channel-feed-runtime.test.jsx --reporter=dot --testNamePattern='\[TC-0456\]\[AD-162\]'
Test Files  1 passed (1)
Tests       1 passed | 27 skipped (28)
```

Adjacent `ChannelFeedRuntime` ownership run:

```text
npm test -- tests/channel-feed-runtime.test.jsx --reporter=verbose --testNamePattern='TC-0456|ChannelFeedRuntime ownership'
Test Files  1 passed (1)
Tests       26 passed | 2 skipped (28)
```

Build:

```text
npm run build
✓ built in 3.21s
```

**Disposition: PASS for the current public owner contract.** The test is an
independent current-owner proof for TC-0456/AD-162; it does not alter or
deprecate the historical baseline and no product gap was encountered at this
public boundary.

## Boundary audit

Changed files are only this report and
`tests/channel-feed-runtime.test.jsx`. Product source, vendor, package,
lockfile, and private exports are unchanged. The worktree's `node_modules`
symlink is an untracked test environment convenience and is not part of the
commit.
