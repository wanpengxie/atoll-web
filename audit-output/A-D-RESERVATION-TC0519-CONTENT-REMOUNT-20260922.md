# A–D reservation — TC-0519 / AD-225 content remount identity

## Reservation

- **Case key:** `TC-0519` (A–D alias `AD-225`)
- **Baseline:** `fae8b70:tests/content-plan-blocks.test.jsx:66`
- **Baseline title:** `restores the same block ids after component unmount while never claiming DOM survival`
- **Current base:** `871ca7e9f6a2bc4b42e97f528b1c0ed9d1eb9af2`
- **Branch:** `unit-a-d/tc0519-content-remount-871ca7`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0519-content-remount-871ca7`
- **Allowed change:** this report and the existing declaration in `tests/content-plan-blocks.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a user reopens or remounts a content body, the visible blocks retain their
stable logical `data-reading-block-id` identities and order. Unmounting removes
the old DOM nodes; a later mount must create new nodes, so the contract does not
claim DOM-node survival across an unmount.

The invariant is a pure content-plan projection: the same content key and
source recover the same logical block identities through the public store, while
`ContentPlanBlocks` renders a fresh DOM tree after remount. The public owner is
`createContentPlanStore` in `src/model/content-plan.js`, composed by
`ContentPlanBlocks` in `src/ui/ContentPlanBlocks.jsx`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0519`
   row for `tests/content-plan-blocks.test.jsx:66`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0519`, `TC0519`, `AD-225`, `AD225`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. TC-0517/AD-223 and TC-0518/AD-224 cover separate declarations in this file.
   TC-0515/AD-221 and TC-0516/AD-222 are diagnostics-only declarations and are
   not claimed here. This claim does not duplicate any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: plan
`message:remount:body` with `one\n\ntwo`, render through
`ContentPlanBlocks`, capture the two block IDs, unmount, plan the same key and
source again, render a second time, and assert the IDs match while
`isSameNode` is false. Only the declaration title receives the case tag; no
assertion is weakened and no DOM-survival claim is introduced.

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

- Reservation commit: `e4027a9` (`test(a-d): reserve TC-0519 content remount`).
- The existing public declaration is tagged
  `[TC-0519][AD-225]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlanStore` and `ContentPlanBlocks` only.
- Focused case:
  `npm test -- tests/content-plan-blocks.test.jsx --run -t 'TC-0519' --reporter=verbose`
  — **1 passed, 6 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan block suite:
  `npm test -- tests/content-plan-blocks.test.jsx --run --reporter=verbose`
  — **7 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.09s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The remounted view retained the same logical
  block IDs in order while the first node was not the same DOM node after
  unmount. No product gap or unrelated rendering change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan-blocks.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
