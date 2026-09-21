# A–D reservation — TC-0535 / AD-241 exact candidate replay

## Reservation

- **Case key:** `TC-0535` (A–D alias `AD-241`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:128`
- **Baseline title:** `reuses an exact unpublished render candidate without exposing it as committed identity`
- **Current base:** `0bf87035be1144437ca4e9d30ff52053a142c176`
- **Branch:** `unit-a-d/tc0535-replay-0bf8703`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0535-replay-0bf8703`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When the same unpublished render candidate is requested again with the exact
same key, source, and options, the content-plan store reuses the prepared
candidate instead of reparsing or creating a second identity. It remains
unpublished until the explicit commit boundary, after which the committed
lookup returns that same candidate.

The invariant is the public `createContentPlanStore` contract: two exact
`prepare('strict-candidate', 'one\n\ntwo', { metrics })` calls return the same
object and increment `metrics.parseCount` only once; `store.get` is null before
commit and returns the original object after `commit`. The public owner is
`createContentPlanStore` in `src/model/content-plan.js`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0535`
   row for `tests/content-plan.test.js:128`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-241` row.
2. Exact searches for `TC-0535`, `TC0535`, `AD-241`, `AD241`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0533/AD-239 covers bounded plan retention and TC-0534/AD-240 covers
   pre-commit publication. This claim covers only line 128 and does not
   duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: prepare the strict candidate
twice with identical key/source/options, assert object identity and one parse,
assert it is not committed before `commit`, commit the replay, and assert the
committed lookup returns the first object. Only the declaration title receives
the case tag; no replay, parse-count, or publication assertion is deleted or
weakened.

If the current public composition cannot express this contract without a
private implementation detail, record that first boundary as a bounded
product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the
declaration. Closeout will append exact focused/full test and build evidence,
the capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/content-plan.test.js` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports,
and other tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

## Closeout evidence

- Reservation commit: `f44399b` (`test(a-d): reserve TC-0535 exact candidate replay`).
- The existing public declaration is tagged
  `[TC-0535][AD-241]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0535' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.91s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Exact preparation returned one candidate and one
  parse, it remained absent before commit, and post-commit lookup returned the
  original object. The public owner was sufficient, so no product gap or
  regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
