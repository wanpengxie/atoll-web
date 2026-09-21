# A-D reservation: TC-0473 / AD-179 feed replay versus live control evidence

## Reservation

- Case key: `TC-0473` / `AD-179`.
- Baseline: `fae8b70:tests/channel-feed-startup.test.jsx:1178`.
- Baseline title: `replay only folds ledger state while live delivery may update live control evidence and invalidate snapshots`.
- Current base: `c4906ca432ea9a25294a7e13f6a252b680273e6f` (`refactor/frontend-subtractive-cleanup`).
- Branch: `unit-a-d/tc0473-feed-replay-c4906ca`.
- Worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0473-feed-replay-c4906ca`.
- Reservation owner: unit-a-d.
- Allowed files: `tests/channel-feed-runtime.test.jsx` and this audit report only.
- Forbidden files: product source, vendor, package/lock files, private exports, compatibility owners, and any second feed/cache store.

## Contract

- User capability: a channel's history replay can materialize previously committed ledger rows without falsely treating replay as a live delivery; a subsequently delivered live fact can update the live access/control projection and invalidate the directory snapshot.
- Invariant: `ChannelFeedRuntime` is the sole public Feed/Replica admission boundary. Replay and live delivery remain distinguished by source; live facts may update live control evidence only after the current `(principal, channel, boot/generation, revision)` authority fence accepts them. A replayed row must not call live access, directory invalidation, or roster observation callbacks.
- Current public owner: `createChannelFeedRuntime(options)` from `src/model/channel-feed-runtime.js`; public snapshot methods `prepareLocalReplica`, `enqueue`, `stateFor`, and `historyFor`, with typed `accessRef`, `rosterRef`, and `onDirectoryInvalidated` callbacks supplied as options. No private helper is imported or exported.
- Baseline setup: seed one current channel Meta record and one cached `system.channel.set` row, create the feed hook with access/roster/directory spies, and prepare the local Replica.
- Baseline action: wait for the cached row to replay, then enqueue a current-generation live `system.channel.set` fact.
- Observable result: replay does not call `access.live`, `onDirectoryInvalidated`, or `roster.handleEnvelope`; the accepted live fact calls `access.live('c0')`, invalidates the directory once, and reaches `roster.handleEnvelope` once.

## Uniqueness precheck

- The central ledger contains the single row `TC-0473` for this baseline identity. Its static status is not runtime proof.
- Exact search across `audit-output/**/*.md` found only the pre-existing aggregate `RESTORE-CASES-A-D-20260919.md` row for `AD-179`; there is no TC-0473/AD-179 reservation, closeout, or case-specific regression packet.
- `git branch --all` and `git worktree list` contain no TC-0473/AD-179/feed-replay claim.
- `TC-0458` is already closed by the separate agent-activity reservation; `TC-1493` is excluded because the central ledger maps it to the already-counted SZ-322 numeric case. Neither is reused here.
- Existing `tests/channel-feed-runtime.test.jsx` contains related lifecycle ownership contracts but no exact TC-0473 case title or ID. The implementation below will preserve the baseline's two-phase replay/live observable boundary rather than count a suite summary as proof.

## Pending disposition

The reservation is made before changing the test. Run the focused public-owner contract and the adjacent feed-runtime suite. If the current owner fails the baseline behavior, record the first public boundary as a regression packet and do not modify product code. If it passes, close this report with exact test/build evidence and the case-to-owner mapping.

## Closeout evidence

- Test migration: `tests/channel-feed-runtime.test.jsx` adds the exact `[TC-0473][AD-179]` case. It seeds the current Replica cache through the exported `createChannelReplicaCache`, replays through `createChannelFeedRuntime`, and then admits one current-generation live fact through the same public snapshot. No source-private helper is imported.
- Focused case: `npm test -- tests/channel-feed-runtime.test.jsx --run -t 'TC-0473' --reporter=verbose` — **1 passed, 28 skipped** (the skips are Vitest's focused selection, not deleted or skipped declarations).
- Adjacent owner suite: `npm test -- tests/channel-feed-runtime.test.jsx --run --reporter=verbose` — **29 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.15s`; existing chunk-size advisory only).
- Result: **PASS / MIGRATE**. Cache replay produced the row without `access.live`, directory invalidation, or roster observation; the accepted live `system.channel.set` produced exactly one call to each current public projection. The product owner did not change.
- Product boundary: no regression found; no product-regression packet is required.
- Committed files are limited to this report and `tests/channel-feed-runtime.test.jsx`. The worktree's `node_modules` symlink is untracked and is not part of the commit.
