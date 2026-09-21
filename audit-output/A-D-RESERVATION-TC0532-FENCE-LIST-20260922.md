# A–D reservation — TC-0532 / AD-238 fence/list atomic parsing

## Reservation

- **Case key:** `TC-0532` (A–D alias `AD-238`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:100`
- **Baseline title:** `keeps unclosed fence/list semantics atomic instead of splitting lines independently`
- **Current base:** `2f90f9ed1c02ae00e20fb7fa5e6206a916b6a381`
- **Branch:** `unit-a-d/tc0532-fence-list-2f90f9e`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0532-fence-list-2f90f9e`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

During streamed Markdown rendering, an unfinished fenced code block must remain
one code block containing all received code, and a list with an indented
continuation must remain one list. The user must not see incomplete chunks
misclassified as independent paragraphs or list items merely because the
stream has not closed its syntax yet.

The invariant is a pure content-plan projection: `before` followed by an
unclosed ````js` fence and `still code` yields `['paragraph', 'code']`, with
the code block retaining `still code`; the three-line list with an indented
continuation yields one `list` block. The public owner is `createContentPlan`
in `src/model/content-plan.js`; no private hook or test-only export is
required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0532`
   row for `tests/content-plan.test.js:100`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-238` row.
2. Exact searches for `TC-0532`, `TC0532`, `AD-238`, `AD238`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0527 through TC-0531 cover separate content-plan identity and
   document-invalidation contracts. This claim covers only line 100 and does
   not duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: plan an unclosed fenced code
sample and assert paragraph/code kinds plus the retained code text; plan the
multi-line list and assert it has one block of kind `list`. Only the
declaration title receives the case tag; no setup, action, or atomicity
assertion is deleted or weakened.

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

- Reservation commit: `3bb9b0d` (`test(a-d): reserve TC-0532 fence list semantics`).
- The existing public declaration is tagged
  `[TC-0532][AD-238]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0532' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.95s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The unfinished fenced sample remained a
  paragraph plus one code block containing the streamed tail, and the
  indented list continuation remained within one list block. The public owner
  was sufficient, so no product gap or regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
