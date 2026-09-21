# A–D reservation — TC-0524 / AD-230 prepared render cache

## Reservation

- **Case key:** `TC-0524` (A–D alias `AD-230`)
- **Baseline:** `fae8b70:tests/content-plan-semantics.test.jsx:34`
- **Baseline title:** `reuses one immutable prepared React description for exact render options`
- **Current base:** `28bc0b832414f2a7fcc4df4351a9b296ffe49500`
- **Branch:** `unit-a-d/tc0524-prepared-cache-28bc0b8`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0524-prepared-cache-28bc0b8`
- **Allowed change:** this report and the existing declaration in `tests/content-plan-semantics.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user sees the same prepared Markdown content reused when the exact render
options are requested again, avoiding needless re-preparation while preserving
correctness when the component options differ. Exact options share one
immutable prepared React description; a different component mapping must not
reuse that description.

The invariant is a pure prepared-render projection: `prepareMarkdownTree` is
stable for the same prepared root and exact components object, but its result is
not shared across different render options. The public owner is
`PreparedMarkdown`/`prepareMarkdownTree` in `src/ui/PreparedMarkdown.jsx`,
fed by `createContentPlan` in `src/model/content-plan.js`; no private hook or
test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0524`
   row for `tests/content-plan-semantics.test.jsx:34`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0524`, `TC0524`, `AD-230`, `AD230`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0517/AD-223 through TC-0523/AD-229 cover separate declarations in
   adjacent content-plan suites. This claim does not duplicate them or any
   TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: create the `prepared-cache` plan
with `**stable** [link](https://example.test)`, read its prepared root, invoke
`prepareMarkdownTree(root, components)` twice and assert referential identity,
then invoke it with a different components object and assert a different
description. Only the declaration title receives the case tag; no cache or
option assertion is weakened.

If the current public composition cannot express this contract without a
private implementation detail, record that first boundary as a bounded
product/fixture gap and do not change product code.

This is an atomic claim: the report is committed before changing the
declaration. Closeout will append exact focused/full test and build evidence,
the capability/owner mapping, and PASS or a bounded regression packet.

## File boundary

Only this report and the existing `tests/content-plan-semantics.test.jsx`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and other tests are out of scope. The worktree `node_modules`
symlink is untracked test infrastructure and must not be committed.

## Closeout evidence

- Reservation commit: `0ed8a91` (`test(a-d): reserve TC-0524 prepared cache`).
- The existing public declaration is tagged
  `[TC-0524][AD-230]` without changing its setup, action, or assertions. It
  continues to exercise `prepareMarkdownTree` through the public prepared
  Markdown owner.
- Focused case:
  `npm test -- tests/content-plan-semantics.test.jsx --run -t 'TC-0524' --reporter=verbose`
  — **1 passed, 9 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent semantic suite:
  `npm test -- tests/content-plan-semantics.test.jsx --run --reporter=verbose`
  — **10 passed, 0 failed**; the existing unsafe-URL warning remains
  non-fatal.
- Build: `npm run build` — **passed** (`✓ built in 2.87s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Exact root/options returned the same prepared
  description, while a different components object returned a distinct one.
  No product gap or unrelated rendering change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan-semantics.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
