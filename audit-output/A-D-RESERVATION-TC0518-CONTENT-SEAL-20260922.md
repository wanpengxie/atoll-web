# A–D reservation — TC-0518 / AD-224 sealed completed content tail

## Reservation

- **Case key:** `TC-0518` (A–D alias `AD-224`)
- **Baseline:** `fae8b70:tests/content-plan-blocks.test.jsx:43`
- **Baseline title:** `seals a completed tail without rerendering or remounting that unchanged block`
- **Current base:** `665e0b29738a15c4db9c4912c0f9a23a94ae9777`
- **Branch:** `unit-a-d/tc0518-content-seal-665e0b2`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0518-content-seal-665e0b2`
- **Allowed change:** this report and the existing declaration in `tests/content-plan-blocks.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a streaming response finishes an existing content block and appends a new
active block, the user keeps the completed block exactly where it was: its DOM
node and text node remain mounted, and its sealed render revision does not
change. Only the newly active tail is rendered.

The invariant is one public `ContentPlanBlocks` projection over an immutable
`createContentPlan` result: a completed block transitions to `sealed`, preserves
its block identity and render revision, and is not remounted or rendered again
when a later active block appears. The current public owner is
`createContentPlan` in `src/model/content-plan.js` composed by
`ContentPlanBlocks` in `src/ui/ContentPlanBlocks.jsx`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0518`
   row for `tests/content-plan-blocks.test.jsx:43`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0518`, `TC0518`, `AD-224`, `AD224`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   existed before this reservation.
3. TC-0517/AD-223 covers the separate native-selection declaration at line 13;
   this claim covers line 43's completion/sealing behavior and does not
   duplicate it or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: render `first` and `finishing`,
capture the second block and its text node, extend the source with `new active`
through `previous`, assert that the existing block becomes `sealed` while its
render revision, DOM node, and text node remain stable, and assert that exactly
one new render occurred. If the public owner cannot express this contract
without a private implementation detail, record that first boundary as a
product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the declaration.
Closeout will append exact focused/full test and build evidence, the
capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/content-plan-blocks.test.jsx` declaration
may change. Product source, vendor, package, lockfile, fixtures, private
exports, and other tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

## Closeout evidence

- The existing public declaration is tagged `[TC-0518][AD-224]` without changing
  its setup or assertions. It continues to exercise the public
  `createContentPlan` → `ContentPlanBlocks` composition.
- Focused case:
  `npm test -- tests/content-plan-blocks.test.jsx --run -t 'TC-0518' --reporter=verbose`
  — **1 passed, 6 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan-blocks.test.jsx --run --reporter=verbose`
  — **7 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 3.09s`; existing chunk-size
  advisory only).
- Result: **PASS / MIGRATE**. The completed block became `sealed`, retained its
  render revision, DOM node, and text node, while exactly one new active-tail
  render was admitted. No product gap or unrelated content change was found.
- Committed files are limited to this report and
  `tests/content-plan-blocks.test.jsx`; `node_modules` remains an untracked
  symlink.
