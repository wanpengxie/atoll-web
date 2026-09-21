# A–D reservation — TC-0526 / AD-232 protection semantics

## Reservation

- **Case key:** `TC-0526` (A–D alias `AD-232`)
- **Baseline:** `fae8b70:tests/content-plan-semantics.test.jsx:53`
- **Baseline title:** `it.each matches react-markdown protection and edge semantics for %s`
- **Current base:** `756d44513d1937c0c65406bf9b1de3d8724d3bd1`
- **Branch:** `unit-a-d/tc0526-protection-semantics-756d445`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0526-protection-semantics-756d445`
- **Allowed change:** this report and the existing `it.each` declaration in `tests/content-plan-semantics.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user’s Markdown remains safe and semantically faithful for unsafe URL
schemes, raw HTML/script input, soft and hard breaks, and footnotes. The
prepared projection must match the planned projection for each source, without
turning unsafe input into executable content or changing canonical Markdown
meaning.

The invariant is a pure content-plan projection: `createContentPlan` and
`PreparedMarkdown` preserve the same protection and edge semantics as the
canonical `ReactMarkdown` composition. No shared state is written and no
render option is silently broadened. The public owners are
`createContentPlan` in `src/model/content-plan.js`, `PreparedMarkdown` in
`src/ui/PreparedMarkdown.jsx`, and the canonical Markdown renderer used by this
public semantic contract; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0526`
   row for `tests/content-plan-semantics.test.jsx:53`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0526`, `TC0526`, `AD-232`, `AD232`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   `it.each` declaration. No dedicated reservation/closeout report, branch, or
   commit for this case existed before this reservation.
3. TC-0524/AD-230 and TC-0525/AD-231 cover separate declarations in the same
   semantic suite. This claim covers the one ledger `it.each` baseline as a
   single case with four data rows and does not duplicate any TC-1493/TC-1494
   row.

## Baseline-to-current plan

Retain the exact public table of four sources: unsafe URL schemes, raw HTML,
soft/hard breaks, and footnotes. For each source, assert
`preparedHTML(source) === plannedHTML(source)`; only the `it.each` title
receives the case tag. No source, security expectation, or edge assertion is
widened or removed.

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

- Reservation commit: `0246534` (`test(a-d): reserve TC-0526 protection semantics`).
- The existing public `it.each` declaration is tagged
  `[TC-0526][AD-232]` without changing its four sources, setup, action, or
  assertions. It remains one ledger case with four data rows.
- Focused case:
  `npm test -- tests/content-plan-semantics.test.jsx --run -t 'TC-0526' --reporter=verbose`
  — **4 passed, 6 selection skips**; the existing empty-image-src warning is
  non-fatal and no declaration was deleted or skipped.
- Adjacent semantic suite:
  `npm test -- tests/content-plan-semantics.test.jsx --run --reporter=verbose`
  — **10 passed, 0 failed**; the same warning remains non-fatal.
- Build: `npm run build` — **passed** (`✓ built in 2.91s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Unsafe URLs, raw HTML, soft/hard breaks, and
  footnotes all preserved the planned/prepared protection and edge semantics.
  No product gap or unrelated rendering change was found.
- Closeout changes remain limited to this report and
  `tests/content-plan-semantics.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
