# A–D reservation — TC-0525 / AD-231 document semantics

## Reservation

- **Case key:** `TC-0525` (A–D alias `AD-231`)
- **Baseline:** `fae8b70:tests/content-plan-semantics.test.jsx:42`
- **Baseline title:** `it.each keeps full-document semantics for %s when top-level blocks render independently`
- **Current base:** `4fe8add95a75ce7a9cc70384aa16a57e8c88f376` (candidate base; integrated after independent review)
- **Branch:** `unit-a-d/tc0525-document-semantics-4fe8add`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0525-document-semantics-4fe8add`
- **Allowed change:** this report and the existing `it.each` declaration in `tests/content-plan-semantics.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user can read Markdown containing document-wide references, continued
lists, fenced code, block/inline math, or GFM tables even when top-level blocks
are projected independently. The resulting document must match the canonical
React-Markdown document semantics, and the prepared projection must match the
planned projection for every listed source.

The invariant is a pure content-plan projection: block-local planning and
prepared rendering preserve document-wide Markdown meaning without writing
shared state or changing source identity. The public owners are
`createContentPlan` in `src/model/content-plan.js`, `PreparedMarkdown` in
`src/ui/PreparedMarkdown.jsx`, and the canonical `ReactMarkdown` composition
in this public semantic test; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0525`
   row for `tests/content-plan-semantics.test.jsx:42`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0525`, `TC0525`, `AD-231`, `AD231`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   `it.each` declaration. No dedicated reservation/closeout report, branch, or
   commit for this case existed before this reservation.
3. TC-0524/AD-230 and TC-0526/AD-232 cover separate declarations in the same
   semantic suite. This claim covers the one ledger `it.each` baseline as a
   single case and does not duplicate any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public table of five sources: reference definitions, one
continued list, fenced code, block/inline math, and a GFM table. For each
source, assert `plannedHTML(source) === html(source)` and
`preparedHTML(source) === plannedHTML(source)`; only the `it.each` title
receives the case tag. No source, expected HTML, or independent-block
assertion is widened or removed.

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

- Reservation commit: `aecfef4` (`test(a-d): reserve TC-0525 document semantics`).
- The existing public `it.each` declaration is tagged
  `[TC-0525][AD-231]` without changing its five sources, setup, action, or
  assertions. It remains one ledger case with five data rows.
- Focused case:
  `npm test -- tests/content-plan-semantics.test.jsx --run -t 'TC-0525' --reporter=verbose`
  — **5 passed, 5 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent semantic suite:
  `npm test -- tests/content-plan-semantics.test.jsx --run --reporter=verbose`
  — **10 passed, 0 failed**; the existing unsafe-URL warning remains
  non-fatal.
- Build: `npm run build` — **passed** (`✓ built in 3.21s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. Reference definitions, continued lists, fenced
  code, math, and GFM tables all matched canonical full-document HTML, and
  prepared output matched planned output. No product gap or unrelated change
  was found.
- Closeout changes remain limited to this report and
  `tests/content-plan-semantics.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
