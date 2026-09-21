# A–D reservation — TC-0533 / AD-239 bounded plan retention

## Reservation

- **Case key:** `TC-0533` (A–D alias `AD-239`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:110`
- **Baseline title:** `persists plans across unmount-like release and bounds retained sources`
- **Current base:** `b3681ea6a876268d984dd401aadae697d94ebda2`
- **Branch:** `unit-a-d/tc0533-plan-store-b3681ea`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0533-plan-store-b3681ea`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a content view is released and later revisited, the public content-plan
store can return the exact retained plan for the same key. Retention remains
bounded: once the configured limit is exceeded, the oldest plan is evicted
instead of allowing unbounded source memory.

The invariant is the public `createContentPlanStore` contract: with
`limit: 2`, planning key `a` twice returns the same plan object; adding keys
`b` and `c` leaves two retained plans and makes `a` unavailable. The public
owner is `createContentPlanStore` in `src/model/content-plan.js`; no private
hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0533`
   row for `tests/content-plan.test.js:110`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-239` row.
2. Exact searches for `TC-0533`, `TC0533`, `AD-239`, `AD239`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0527 through TC-0532 cover distinct block identity, invalidation, and
   parser-semantics contracts. This claim covers only line 110 and does not
   duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create a store with `limit: 2`,
plan key `a` twice with the same source and assert object identity, then plan
keys `b` and `c`, assert `a` is evicted, and assert the store size remains two.
Only the declaration title receives the case tag; no retention, identity, or
eviction assertion is deleted or weakened.

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

- Reservation commit: `cef0922` (`test(a-d): reserve TC-0533 bounded plan retention`).
- The existing public declaration is tagged
  `[TC-0533][AD-239]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0533' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.38s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Replanning the same key returned the retained
  plan object, adding two newer keys evicted the oldest plan, and the store
  stayed within its configured size of two. The public owner was sufficient,
  so no product gap or regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
