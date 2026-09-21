# A–D reservation — TC-0529 / AD-235 active tail identity

## Reservation

- **Case key:** `TC-0529` (A–D alias `AD-235`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:57`
- **Baseline title:** `keeps one unambiguous growing active tail id while sealed prefix revisions stay fixed`
- **Current base:** `4f051f9d4896141396f6a79c1eaeb5bdae16f296`
- **Branch:** `unit-a-d/tc0529-active-tail-4f051f9`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0529-active-tail-4f051f9`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

As a streamed response grows, the user keeps one stable active-tail identity
while already completed content remains sealed and unchanged. The sealed block
must keep its ID and render revision; the active block must keep its ID but
receive a new render revision for the growth.

The invariant is a pure content-plan projection: `createContentPlan` marks the
completed prefix sealed, preserves its immutable identity/revision, and updates
only the unambiguous growing tail. The public owner is `createContentPlan` in
`src/model/content-plan.js`; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0529`
   row for `tests/content-plan.test.js:57`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0529`, `TC0529`, `AD-235`, `AD235`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0527/AD-233 covers unique IDs and unambiguous prefix survivors; TC-0528/
   AD-234 covers ambiguous replacement. This claim covers only line 57 and
   does not duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create `message:m3:body` with
`sealed\n\nactive`, then plan `sealed\n\nactive grows` with the prior plan.
Assert the first block keeps its ID, render revision, and `sealed` state; assert
the active tail keeps its ID while its render revision changes. Only the
declaration title receives the case tag; no state or revision assertion is
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

- Reservation commit: `d95661c` (`test(a-d): reserve TC-0529 active tail`).
- The existing public declaration is tagged
  `[TC-0529][AD-235]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0529' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.98s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The sealed prefix kept its block ID, revision,
  and `sealed` state; the active tail kept its ID and changed revision. No
  product gap or unrelated change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
