# A–D reservation — TC-0531 / AD-237 document-wide invalidation

## Reservation

- **Case key:** `TC-0531` (A–D alias `AD-237`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:92`
- **Baseline title:** `expands invalidation for document-wide reference definitions without changing text identity`
- **Current base:** `2f90f9ed1c02ae00e20fb7fa5e6206a916b6a381`
- **Branch:** `unit-a-d/tc0531-document-invalidation-2f90f9e`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0531-document-invalidation-2f90f9e`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a document-wide reference definition changes, the user must see the
updated rendered link everywhere it is used without losing the stable content
block identities. The content plan must invalidate every affected block's
render revision while preserving each block's `blockID` and publishing the new
reference target in the rendered source.

The invariant is a pure content-plan projection: planning the same
`message:m4:body` first with `https://one.example` and then with
`https://two.example` keeps the block ID sequence unchanged, advances every
block's `renderRevision`, and exposes `https://two.example` in the first
block's `renderSource`. The public owner is `createContentPlan` in
`src/model/content-plan.js`; no private hook or test-only export is required.

## Exact uniqueness precheck

1. The central `audit-output/TEST-CASE-MIGRATION-LEDGER.md` has one `TC-0531`
   row for `tests/content-plan.test.js:92`; it is a static blocked baseline,
   not runtime evidence. The historical inventory has the corresponding
   `AD-237` row.
2. Exact searches for `TC-0531`, `TC0531`, `AD-237`, `AD237`, and the baseline
   title found only that ledger row, the historical inventory row, and the
   untagged current declaration. No dedicated reservation/closeout report,
   branch, or commit for this case existed before this reservation.
3. TC-0527/AD-233 covers unique surviving IDs, TC-0528/AD-234 covers
   ambiguous replacement, and TC-0529/AD-235 covers active-tail growth. This
   claim covers only line 92 and does not duplicate them or any TC-1493/TC-1494
   row.

## Baseline-to-current plan

Retain the exact public setup and assertions: plan
`[link][ref]\n\nplain\n\n[ref]: https://one.example`, re-plan the same content
key with `https://two.example` and `previous: first`, then assert that block
IDs are unchanged, every block render revision changed, and the first
rendered source contains `https://two.example`. Only the declaration title
receives the case tag; no setup, action, or invalidation assertion is deleted
or weakened.

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

- Reservation commit: `8d3d86e` (`test(a-d): reserve TC-0531 document invalidation`).
- The existing public declaration is tagged
  `[TC-0531][AD-237]` without changing its setup, action, or assertions. It
  continues to exercise `createContentPlan` only.
- Focused case:
  `npm test -- tests/content-plan.test.js --run -t 'TC-0531' --reporter=verbose`
  — **1 passed, 18 selection skips**; no declaration was deleted or skipped in
  the committed test.
- Adjacent content-plan suite:
  `npm test -- tests/content-plan.test.js --run --reporter=verbose`
  — **19 passed, 0 failed**.
- Build: `npm run build` — **passed** (`✓ built in 2.97s`; existing
  chunk-size advisory only).
- Result: **PASS / MIGRATE**. The document-wide reference update preserved all
  block IDs, advanced each block's render revision, and exposed the new URL in
  the rendered source. The public owner was sufficient, so no product gap or
  regression packet was found.
- Closeout changes remain limited to this report and
  `tests/content-plan.test.js`; `node_modules` is an untracked worktree
  symlink and is not committed.
