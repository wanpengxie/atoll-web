# A–D reservation — TC-0528 / AD-234 ambiguous replacement

## Reservation

- **Case key:** `TC-0528` (A–D alias `AD-234`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:48`
- **Baseline title:** `treats ambiguous duplicate insertion as replacement instead of transferring identity`
- **Current base:** `bf119bb77358598762d2a6b124b0d062459cb4e3`
- **Branch:** `unit-a-d/tc0528-ambiguous-replacement-bf119bb`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0528-ambiguous-replacement-bf119bb`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When two identical blocks become three and the old plan cannot identify which
duplicate survived, the user must see a replacement set rather than a guessed
identity transfer. All new blocks receive fresh unique IDs, both old IDs are
reported removed, and no old identity is silently reused for ambiguous text.

The invariant is a pure content-plan projection: `createContentPlan` treats an
ambiguous duplicate insertion as replacement at its commit boundary, preserving
unique logical identity and explicit `changes.removed` facts. The public owner
is `createContentPlan` in `src/model/content-plan.js`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0528`
   row for `tests/content-plan.test.js:48`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0528`, `TC0528`, `AD-234`, `AD234`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0527/AD-233 covers unique IDs and unambiguous survivors at line 32;
   TC-0529/AD-235 covers active-tail growth at line 57. This claim covers only
   line 48 and does not duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create `message:m2:body` with
two `same` blocks, create the same key with three `same` blocks and the prior
plan, then assert every next block has a fresh ID, both old IDs appear in
`changes.removed`, and the three next IDs are unique. Only the declaration title
receives the case tag; no ambiguity or replacement assertion is weakened.

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

- Reservation commit: `20e6ef3` (`test(a-d): reserve TC-0528 ambiguous replacement`).
- The existing public declaration is tagged
  `[TC-0528][AD-234]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0528' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 5.52s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. All three next blocks received fresh unique IDs,
  both old IDs were listed as removed, and no ambiguous duplicate identity was
  transferred. No product gap or unrelated change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
