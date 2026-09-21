# A–D reservation — TC-0530 / AD-236 local-edit identity

## Reservation

- **Case key:** `TC-0530` (A–D alias `AD-236`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:69`
- **Baseline title:** `keeps an unambiguous locally edited block identity but replaces ambiguous edits`
- **Current base:** `7723732cadfc18f658bd91ab73a988a6f415c0d9`
- **Branch:** `unit-a-d/tc0530-local-edit-7723732`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0530-local-edit-7723732`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a user makes an unambiguous local edit to one content block, the visible
block keeps its identity while its rendered revision advances. When an edit is
ambiguous because duplicate source blocks could match it equally, the content
plan must replace the old identities rather than guessing which block the user
edited.

The invariant is a pure content-plan projection: the unambiguous
`keep these words` → `**keep these words**` edit preserves that block's
`blockID` and increments `renderRevision`; the duplicate `same old` ×2 →
`same edited` ×2 edit transfers no old ID to either replacement. The public
owner is `createContentPlan` in `src/model/content-plan.js`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0530`
   row for `tests/content-plan.test.js:69`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-236` row.
2. Exact searches for `TC-0530`, `TC0530`, `AD-236`, `AD236`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. There was no reservation/closeout report,
   branch, or commit for this case before this reservation.
3. TC-0527/AD-233 covers unique IDs and unambiguous prefix survivors;
   TC-0528/AD-234 covers ambiguous duplicate insertion; TC-0529/AD-235
   covers an active tail. This claim covers only line 69 and does not duplicate
   those cases or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create a plan for
`fixed before\n\nkeep these words\n\nfixed after`, then apply the formatted
version through `previous`; assert that the middle block keeps its ID and has
the next render revision. Separately create two `same old` blocks and replace
both with `same edited`; assert that no replacement reuses an old ID. Only the
declaration title receives the case tag; no setup, action, or assertion is
deleted or weakened.

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

- Reservation commit: `77d2218` (`test(a-d): reserve TC-0530 local edit identity`).
- The existing public declaration is tagged
  `[TC-0530][AD-236]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0530' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.12s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The unambiguous formatted block retained its
  `blockID` and advanced `renderRevision`; the ambiguous duplicate replacement
  reused no old ID. The public owner was sufficient, so no product gap or
  regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
