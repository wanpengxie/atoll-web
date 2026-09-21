# Reservation — TC-0544 text-point context recovery

## Claim

- **Case key:** `TC-0544` (CONTENT baseline; ledger owner `CONTENT`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:268`
- **Baseline title:** `resolves a saved text point by context after text is inserted before it`
- **Current base:** `e329ca5a1d4b0c47f4387c3a23848a8f46345536`
- **Branch/worktree:** `unit-e-h/tc0544-text-point-e329ca5`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0544-text-point-e329ca5`
- **Allowed change:** this report and the existing declaration in
  `tests/content-plan.test.js`; no product source, package, lockfile, vendor,
  fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline creates a public text point for `target` in
`alpha beta target gamma omega`, then prepends `new prefix ` to the same text
and resolves the saved point through the public `resolveContentTextOffset`
owner. The user capability is stable reading/selection anchoring after text is
inserted before a saved location. The strict observable is the context match:
the resolved offset equals the new text's `target` index and reports
`match: 'context'`. This proves semantic relocation rather than accepting the
old numeric offset or a diagnostic/private marker.

## Uniqueness and boundaries

The central migration ledger has one `TC-0544` row for
`tests/content-plan.test.js:268`. Exact searches for `TC-0544`, `TC0544`, the
baseline title, and the source declaration found no current reservation,
claim, branch, or migration commit. Historical `AD-250` references in the
generic 2026-09-19 restore ledger are evidence indexes, not a current TC-0544
claim; they do not contain a reservation or this test tag.

This is distinct from TC-0521, which proves DOM text-point description and
selection recovery through `ContentPlanBlocks` across local edit/remount; and
from TC-0545, which proves the documented coarse block-offset fallback when
context is ambiguous or fully rewritten. TC-0539–0543 cover parser identity,
suffix/fallback behavior, streamed equivalence, and fuzzing, not text-point
relocation. This claim preserves only the context-based offset result.

## Current public owner

The existing public owner is the named `createContentTextPoint` /
`resolveContentTextOffset` API in `src/model/content-plan.js`, exercised
directly by the existing test. No private helper, DOM oracle, or alternate
anchor store is introduced. The baseline setup, actions, and exact result
object remain unchanged; migration adds only the case tag.

## File boundary and reservation

Only this report and the existing test declaration may change. The worktree's
`node_modules` symlink, if present, is untracked test infrastructure and will
not be committed.

Closeout will append focused, adjacent, and build evidence plus the final
PASS/REGRESSION disposition.

## Closeout — 2026-09-22

- **Migration:** added only the explicit `[TC-0544]` tag to the existing test
  declaration. The saved point, prepended source, public resolver call, exact
  offset computation, and `match: 'context'` assertion remain unchanged; no
  skip/filter/private oracle was introduced.
- **Focused:**
  `npm test -- tests/content-plan.test.js --run -t 'TC-0544' --reporter=verbose`
  — `1 passed, 18 skipped` by Vitest selection (the 18 are not skipped test
  declarations).
- **Adjacent owner suite:**
  `npm test -- tests/content-plan.test.js --run --reporter=verbose` — `19
  passed`.
- **Adjacent semantic suite:**
  `npm test -- tests/content-plan-semantics.test.jsx --run --reporter=dot` —
  `10 passed`. It retains the pre-existing empty-`src` React warnings; no
  assertion failed.
- **Build:** `npm run build` — passed; Vite emitted only the existing large
  chunk advisory.
- **Disposition:** `PASS` / `MIGRATED`, credit `1`. The case remains a strict
  public-owner proof of context-based text-point relocation after prefix
  insertion. No product change or semantic weakening was required.
