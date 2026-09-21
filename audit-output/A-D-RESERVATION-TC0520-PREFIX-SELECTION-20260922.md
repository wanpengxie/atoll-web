# A–D reservation — TC-0520 / AD-226 prefix insertion selection

## Reservation

- **Case key:** `TC-0520` (A–D alias `AD-226`)
- **Baseline:** `fae8b70:tests/content-plan-blocks.test.jsx:82`
- **Baseline title:** `keeps selected unchanged siblings mounted when a new prefix block is inserted`
- **Current base:** `1cef84fdca12add9cf2041bba1d1ad9cdf95177f`
- **Branch:** `unit-a-d/tc0520-prefix-selection-1cef84f`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0520-prefix-selection-1cef84f`
- **Allowed change:** this report and the existing declaration in `tests/content-plan-blocks.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When new content is inserted before an already selected block, the user keeps
the selected text and its native selection while the existing block remains
mounted. The new prefix may mount and the active tail may update, but the
unchanged selected sibling must not be remounted or replaced beneath the user.

The invariant is a pure content-plan projection: block identity matching is
stable across the prefix insertion, and `ContentPlanBlocks` preserves the
selected block DOM node, its text node, and the browser selection. The public
owner is `createContentPlan` in `src/model/content-plan.js`, composed by
`ContentPlanBlocks` in `src/ui/ContentPlanBlocks.jsx`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0520`
   row for `tests/content-plan-blocks.test.jsx:82`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0520`, `TC0520`, `AD-226`, `AD226`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0517/AD-223, TC-0518/AD-224, and TC-0519/AD-225 cover separate
   declarations in this file. This claim does not duplicate them or any
   TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: render
`message:prefix:body` as `selected text\n\ntail`, select the first block's
`selected` text, create a next plan with `new prefix\n\nselected text\n\ntail
grows` and the prior plan, rerender through `ContentPlanBlocks`, then assert
the selected block and text node are the same DOM nodes and the native
selection still reads `selected`. Only the declaration title receives the case
tag; no selector is widened and no selection assertion is removed.

If the current public composition cannot express this contract without a
private implementation detail, record that first boundary as a bounded
product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the
declaration. Closeout will append exact focused/full test and build evidence,
the capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/content-plan-blocks.test.jsx`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and other tests are out of scope. The worktree `node_modules`
symlink is untracked test infrastructure and must not be committed.

## Closeout evidence

- Reservation commit: `e06476f` (`test(a-d): reserve TC-0520 prefix selection`).
- The existing public declaration is tagged
  `[TC-0520][AD-226]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` and `ContentPlanBlocks` only.
- Focused case:
  `npm test -- tests/content-plan-blocks.test.jsx --run -t 'TC-0520' --reporter=verbose`
  — **1 passed, 6 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan block suite:
  `npm test -- tests/content-plan-blocks.test.jsx --run --reporter=verbose`
  — **7 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.95s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. After the prefix insertion, the selected block
  and its text node remained the same DOM nodes and the native selection still
  read `selected`. No product gap or unrelated rendering change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan-blocks.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
