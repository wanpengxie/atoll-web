# A-D reservation: TC-0509 / AD-215 Replica materialized owner

## Reservation

- Case key: `TC-0509` / `AD-215`.
- Baseline: `fae8b70:tests/channel-replica.test.js:13`.
- Baseline title: `is the single materialized owner for cache, history and live commits`.
- Current base: `1a73a6ee0cf9755222d761236e71a3f7feeea2ca` (`refactor/frontend-subtractive-cleanup`).
- Branch: `unit-a-d/tc0509-replica-owner-1a73a6`.
- Worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0509-replica-owner-1a73a6`.
- Reservation owner: unit-a-d.
- Allowed files: `tests/channel-replica.test.js` and this audit report only.
- Forbidden files: product source, vendor, package/lock files, private exports, compatibility owners, and any second cache/history/live store.

## Contract

- User capability: one channel conversation remains coherent when a cached row, a history row, and a live row are materialized; duplicate sequence admission does not create a second visible copy.
- Invariant: `createChannelReplicaStore` is the sole materialized owner for cache, history, and live commits. Durable coverage and materialized coverage remain separate facts; callers cannot derive one from the other or maintain a parallel projection.
- Current public owner: `createChannelReplicaStore()` from `src/model/channel-replica.js`, with its public `commit`, `state`, and coverage snapshots. No private helper is imported or exported.
- Baseline setup: create one Replica store and commit representative rows through the public `commit` boundary with their source provenance.
- Baseline action: admit cache/history/live rows for the same channel and sequence range, including a repeated sequence.
- Observable result: one materialized channel state owns all accepted rows; duplicate sequence admission is rejected, cache/history/live commits do not create a second owner, and durable versus materialized coverage remains distinguishable.

## Uniqueness precheck

- The central ledger contains the single row `TC-0509` for this baseline identity. Its static status is not runtime proof.
- Exact search across `audit-output/**/*.md` found only the aggregate `RESTORE-CASES-A-D-20260919.md` row for `AD-215`; there is no TC-0509/AD-215 reservation, closeout, or regression packet.
- `git branch --all`, `git worktree list`, and all commit subjects contain no TC-0509/AD-215 claim. The existing `tests/channel-replica.test.js` is current public-owner coverage without a case reservation/tag; this commit binds only the first baseline declaration and does not count the adjacent AD-216 declaration.
- `TC-0473` is a separate Feed replay contract already reserved on its own branch. `TC-1493` and `TC-1494` are excluded as instructed; neither is reused here.

## Pending disposition

The reservation is made before changing the test. Run the exact public-owner case and the adjacent Replica suite. If the current owner fails, record the first public boundary as a product-regression packet and do not modify product code. If it passes, close this report with exact test/build evidence and the case-to-owner mapping.

## Closeout evidence

- Test migration: `tests/channel-replica.test.js` binds the exact first declaration to `[TC-0509][AD-215]` without changing its behavioral setup or assertions. The test exercises only the exported `createChannelReplicaStore` public boundary; the adjacent AD-216 declaration remains separate and untagged.
- Focused case: `npm test -- tests/channel-replica.test.js --run -t 'TC-0509' --reporter=verbose` — **1 passed, 1 focused skip** (Vitest selection only; no declaration was deleted or skipped in the committed test).
- Adjacent owner suite: `npm test -- tests/channel-replica.test.js --run --reporter=verbose` — **2 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.06s`; existing chunk-size advisory only).
- Result: **PASS / MIGRATE**. The public Replica owner accepted two distinct sequence rows, rejected duplicate sequence admission, and exposed one materialized state with the expected coverage. No second cache/history/live owner was introduced.
- Product boundary: no regression found; no product-regression packet is required.
- Committed files are limited to this report and `tests/channel-replica.test.js`. The worktree's `node_modules` symlink is untracked and is not part of the commit.
