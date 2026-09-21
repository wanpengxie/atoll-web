# Reservation — TC-0539 parser work accounting

## Claim

- **Case key:** `TC-0539` (CONTENT baseline; ledger owner `CONTENT`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:173`
- **Baseline title:** `reports honest parser work while making unchanged publication a no-op`
- **Current base:** `8c2939e350bc554d02f606cb4df9347ec3b89d76`
- **Branch/worktree:** `unit-e-h/tc0539-parser-work-8c2939e`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0539-claim-8c2939e`
- **Allowed change:** this report and the existing declaration in
  `tests/content-plan.test.js`; no product source, package, lockfile, vendor,
  fixture, private export, or unrelated test.

## User capability and invariant

For unchanged content, the public content-plan owner must reuse the immutable
plan without pretending that parser work happened. When content grows under
the same key, it must produce a new plan and honest parse accounting while
preserving the unchanged block's durable identity. The baseline's public
invariant is the existing `createContentPlan` contract: the same source is the
same object, the append increments parser work exactly once, and the first
block's render revision remains unchanged.

## Uniqueness and boundaries

The central migration ledger has one `TC-0539` row for
`tests/content-plan.test.js:173`; exact searches for `TC-0539`, `TC0539`, the
baseline title, and the source declaration found no existing claim, report,
branch, or migration commit. `TC-0538` is separately active on
`unit-a-d/tc0538-delete-bytes-8c2939e` and is not touched.

Adjacent content-plan cases are distinct: TC-0533 covers count-based store
retention, TC-0534–0537 cover commit/candidate/byte-retention boundaries, and
TC-0540+ cover suffix parsing and document-wide parse fallback. This claim is
only the unchanged-publication/no-op and append parse-accounting case.

## Current public owner

The existing public owner is the named `createContentPlan` export in
`src/model/content-plan.js`. The current declaration already drives that owner
directly; migration will add only its case tag and preserve every setup,
action, and observable assertion.

## File boundary

Only this report and the existing test declaration may change. The worktree
`node_modules` symlink is untracked test infrastructure and will not be
committed.

Closeout will append focused, adjacent, and build evidence plus the final
PASS/REGRESSION disposition.

## Closeout — 2026-09-22

- **Migration:** added only the explicit `[TC-0539]` tag to the existing test
  declaration. Setup, public `plan` calls, metrics, identity comparison, and
  render-revision assertions are unchanged; no skip/filter/private oracle was
  introduced.
- **Focused:**
  `npm test -- tests/content-plan.test.js --run -t 'TC-0539' --reporter=verbose`
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
  public-owner proof of unchanged-plan identity, exact parse accounting, and
  append identity preservation. No product change or semantic weakening was
  required.
