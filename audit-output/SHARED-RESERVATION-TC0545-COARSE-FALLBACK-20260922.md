# Reservation — TC-0545 coarse text-point fallback

## Claim

- **Case key:** `TC-0545` (CONTENT baseline; ledger owner `CONTENT`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:282`
- **Baseline title:** `reports a coarse block-offset fallback rather than guessing between repeated contexts`
- **Current base:** `e329ca5a1d4b0c47f4387c3a23848a8f46345536`
- **Branch/worktree:** `unit-e-h/tc0545-coarse-fallback-e329ca5`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0545-coarse-fallback-e329ca5`
- **Allowed change:** this report and the existing declaration in
  `tests/content-plan.test.js`; no product source, package, lockfile, vendor,
  fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline creates a saved public text point for `target` in
`before target after`, then supplies the wholly rewritten text
`completely rewritten` to `resolveContentTextOffset`. The user capability is a
safe reading/selection anchor when the original nearby context no longer
exists. The strict observable is deliberately conservative: return the
original block offset `7` with `match: 'block-offset'`, rather than guessing a
semantic location or claiming context recovery. This preserves an honest
distinction between a stable coarse anchor and a verified text match.

## Uniqueness and boundaries

The central migration ledger has one `TC-0545` row for
`tests/content-plan.test.js:282`. Exact searches for `TC-0545`, `TC0545`, the
baseline title, and the source declaration found no current reservation,
claim, branch, or migration commit. Historical `AD-251` references in the
generic 2026-09-19 restore ledger are evidence indexes, not a current TC-0545
claim; they do not contain a reservation or this test tag.

This is distinct from TC-0544, which proves a unique context match after a
prefix insertion, and from TC-0521, which proves DOM selection/remount
lifecycle through `ContentPlanBlocks`. TC-0545 covers only the no-context,
ambiguous/rewritten fallback and its exact result object; it must not be
merged with context recovery or upgraded to a guessed semantic offset.

## Current public owner

The existing public owner is the named `resolveContentTextOffset` API in
`src/model/content-plan.js`, using the existing `createContentTextPoint`
record. No private helper, DOM oracle, or alternate anchor store is
introduced. The baseline setup, public resolver action, offset, and
`match: 'block-offset'` assertion remain unchanged; migration adds only the
case tag.

## File boundary and reservation

Only this report and the existing test declaration may change. The worktree's
`node_modules` symlink, if present, is untracked test infrastructure and will
not be committed.

Closeout will append focused, adjacent, and build evidence plus the final
PASS/REGRESSION disposition.
