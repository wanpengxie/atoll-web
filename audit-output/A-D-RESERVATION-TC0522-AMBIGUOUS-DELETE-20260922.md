# A–D reservation — TC-0522 / AD-228 ambiguous deleted block

## Reservation

- **Case key:** `TC-0522` (A–D alias `AD-228`)
- **Baseline:** `fae8b70:tests/content-plan-blocks.test.jsx:136`
- **Baseline title:** `does not guess a deleted block from ambiguous duplicate fingerprints`
- **Current base:** `640d4459317e472ad3d9912ac36f21c95208d481`
- **Branch:** `unit-a-d/tc0522-ambiguous-delete-640d445`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0522-ambiguous-delete-640d445`
- **Allowed change:** this report and the existing declaration in `tests/content-plan-blocks.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a saved text point belongs to a deleted content identity and identical
text later appears under another content identity, the user must not be shown a
guessed bookmark or selection. Resolution returns no point rather than
transferring identity from an ambiguous duplicate fingerprint.

The invariant is a pure content-plan boundary: a text point carries its public
content identity and block/text context, and `resolveContentTextPoint` refuses
to resolve it against a different content key even when the rendered text is
identical. The public owner is the `ContentPlanBlocks`/content-plan composition
in `src/ui/ContentPlanBlocks.jsx` and `src/model/content-plan.js`; no private
hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0522`
   row for `tests/content-plan-blocks.test.jsx:136`; it remains a static
   `blocked pending product decision` row and is not runtime evidence.
2. Exact searches for `TC-0522`, `TC0522`, `AD-228`, `AD228`, and the baseline
   title found only that ledger row, the historical
   `RESTORE-CASES-A-D-20260919.md` inventory row, and the untagged current
   declaration. No dedicated reservation/closeout report, branch, or commit
   for this case existed before this reservation.
3. TC-0517/AD-223 through TC-0521/AD-227 cover separate declarations in this
   file. This claim does not duplicate them or any TC-1493/TC-1494 row.

## Baseline-to-current plan

Retain the exact public setup and assertions: render two identical
`same text` blocks under `message:deleted:body`, describe a point in the first
block, replace the rendered plan with identical text under
`message:other:body`, and resolve the original point through
`ContentPlanBlocks`. Assert `null`; do not widen matching to raw text or
ordinary indexes. Only the declaration title receives the case tag.

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

- Reservation commit: `fc18f66` (`test(a-d): reserve TC-0522 ambiguous delete`).
- The existing public declaration is tagged
  `[TC-0522][AD-228]` without changing its setup, action, or assertions. It
  continues to exercise the public text-point resolution boundary.
- Focused case:
  `npm test -- tests/content-plan-blocks.test.jsx --run -t 'TC-0522' --reporter=verbose`
  — **1 passed, 6 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan block suite:
  `npm test -- tests/content-plan-blocks.test.jsx --run --reporter=verbose`
  — **7 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.80s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. An identical `same text` body under a different
  content key did not resolve the old point; the resolver returned `null`
  instead of guessing a block. No product gap or unrelated rendering change
  was found.
- Closeout changes remain limited to this report and
  `tests/content-plan-blocks.test.jsx`; `node_modules` is an untracked
  worktree symlink and is not committed.
