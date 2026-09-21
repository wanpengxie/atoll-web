# A–D reservation — TC-0510 / AD-216 Replica durable/materialized coverage

## Reservation

- **Case key:** `TC-0510` (A–D alias `AD-216`)
- **Baseline:** `fae8b70:tests/channel-replica.test.js:25`
- **Baseline title:** `keeps durable and materialized coverage as different facts`
- **Current base:** `e409c5109b3fa5f99b176484c03b055404f1bda1`
- **Branch:** `unit-a-d/tc0510-replica-coverage-e409c51`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0510-replica-coverage-e409c51`
- **Allowed change:** this report and the existing declaration in `tests/channel-replica.test.js`; no product source, package, lockfile, vendor, fixture, private export, or second store.

## User capability and invariant

The user-visible channel can distinguish durable server coverage from rows that are
actually materialized in the current Replica. Installing durable Meta for a broad
range must not make every row appear present; committing one row must update only
the materialized coverage for that row while retaining the durable range fact.

The invariant is that `durableCoverage` and `materializedCoverage` remain separate
facts owned by one `createChannelReplicaStore()` instance. `headSeq` may describe
the durable frontier, but it cannot manufacture physical rows or widen the
materialized set. Duplicate sequence admission remains idempotent and no second
cache/history/live owner is introduced.

The current public owner is the exported `createChannelReplicaStore()` contract,
using its public `installMeta`, `commit`, and `record` methods. No private hook,
internal map, or implementation-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0510`
   row for `tests/channel-replica.test.js:25`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0510`, `TC0510`, `AD-216`, `AD216`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. The adjacent `TC-0509`/`AD-215` claim binds only the declaration at line 13
   and its closeout explicitly leaves this line-25 declaration separate. This
   claim therefore does not duplicate TC-0509 or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup: install durable Meta for `c0` with head sequence
100 and coverage `[1,100]`, commit only row 100, then inspect the public record.
The expected result is `headSeq: 100`, durable coverage `[1,100]`, and
materialized coverage only `[100,100]`. If the public owner cannot express that
distinction without a private API, record the first boundary as a product/fixture
gap and do not modify product code.

This is an atomic claim: the report is committed before changing the test
declaration. Closeout will append exact focused/full test and build evidence,
the capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/channel-replica.test.js` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports, and
other tests are out of scope. The worktree `node_modules` symlink is untracked
test infrastructure and must not be committed.

## Closeout evidence

- The existing public declaration is tagged `[TC-0510][AD-216]` without changing
  its setup, action, or assertions. It still uses only
  `createChannelReplicaStore()`, `installMeta`, `commit`, and `record`.
- Focused case:
  `npm test -- tests/channel-replica.test.js --run -t 'TC-0510' --reporter=verbose`
  — **1 passed, 1 selection skip**; no declaration was deleted or skipped in the
  committed test.
- Adjacent Replica suite:
  `npm test -- tests/channel-replica.test.js --run --reporter=verbose`
  — **2 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.10s`; existing chunk-size
  advisory only).
- Result: **PASS / MIGRATE**. The public owner retained `headSeq: 100` and
  durable coverage `[1,100]` while materialized coverage remained only
  `[100,100]` after one physical commit. The durable frontier did not fabricate
  rows, and no second owner/store was introduced.
- Product boundary: no regression found and no product-regression packet is
  required.
- Committed files are limited to this audit report and
  `tests/channel-replica.test.js`; `node_modules` remains an untracked symlink.
