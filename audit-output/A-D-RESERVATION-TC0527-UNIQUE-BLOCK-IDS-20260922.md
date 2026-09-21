# A–D reservation — TC-0527 / AD-233 unique block IDs

## Reservation

- **Case key:** `TC-0527` (A–D alias `AD-233`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:32`
- **Baseline title:** `keeps unique surviving block ids and never duplicates ids for repeated content`
- **Current base:** `8002bd3836b26c2cf7a98f71ec7e73d697d5cc57`
- **Branch:** `unit-a-d/tc0527-unique-block-ids-8002bd`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0527-unique-block-ids-8002bd`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

As content grows with repeated text, the user’s surviving blocks retain unique
logical identities. A newly inserted prefix must not duplicate any block ID,
and unambiguous surviving `alpha` and `omega` blocks must keep their original
IDs so selection/reading ownership does not jump to a duplicate.

The invariant is a pure content-plan projection: `createContentPlan` produces
unique IDs for every block and carries only unambiguous identities into the
next plan. Repeated `repeat` content remains distinct without guessing. The
public owner is `createContentPlan` in `src/model/content-plan.js`; no private
hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0527`
   row for `tests/content-plan.test.js:32`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0527`, `TC0527`, `AD-233`, `AD233`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0528/AD-234 onward cover separate declarations in `tests/content-plan.test.js`;
   this claim covers only line 32 and does not duplicate them or any
   TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create `message:m1:body` with
`alpha`, two repeated `repeat` blocks, and `omega`; then create a next plan
with a new prefix and the prior plan. Assert every plan’s block IDs are
unique, and assert the unambiguous `alpha` and `omega` IDs survive unchanged.
Only the declaration title receives the case tag; no identity or duplicate
assertion is weakened.

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

- Reservation commit: `dcd7b1e` (`test(a-d): reserve TC-0527 unique block ids`).
- The existing public declaration is tagged
  `[TC-0527][AD-233]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0527' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.84s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. All initial and next-plan block IDs remained
  unique; unambiguous `alpha` and `omega` identities survived the inserted
  prefix while repeated `repeat` blocks did not duplicate IDs. No product gap
  or unrelated change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
