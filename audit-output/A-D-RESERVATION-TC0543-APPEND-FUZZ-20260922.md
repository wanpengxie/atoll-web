# A–D reservation — TC-0543 / AD-249 deterministic append fuzz

## Reservation

- **Case key:** `TC-0543` (A–D alias `AD-249`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:250`
- **Baseline title:** `differentially matches full parsing for deterministic append fuzz`
- **Current base:** `e329ca5a1d4b0c47f4387c3a23848a8f46345536`
- **Branch:** `unit-a-d/tc0543-append-fuzz-e329ca5`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0543-append-fuzz-e329ca5`
- **Allowed change:** this report and the existing declaration in `tests/content-plan.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

As streamed Markdown arrives in deterministic fragments, the user must see the
same rendered content as a fresh parse of the complete source at every append.
The invariant is the public `createContentPlan` contract: after each of the 64
deterministic fragment appends, the incremental parser projection must equal
the independently computed full parser projection. The case protects the
streaming path from silently changing block kind, source, semantic text,
source range, render source, or document-dependency metadata for punctuation,
fences, links, tables, math, and raw HTML fragments.

## Exact uniqueness precheck

The central migration ledger has one `TC-0543` row for
`tests/content-plan.test.js:250`; the historical inventory maps it to
`AD-249`. Exact searches for `TC-0543`, `TC0543`, `AD-249`, `AD249`, the
baseline title, and the source declaration found no reservation report,
claim commit, branch, or worktree before this claim. TC-0542 is already held
by the separate `unit-e-h/tc0542-streamed-equivalence-e329ca5` worktree and is
not touched here.

The neighboring content-plan cases remain separate: TC-0533–0538 cover plan
retention, commit/candidate boundaries, and prepared-byte accounting; TC-0539
covers unchanged publication and parser-work accounting; TC-0540 covers the
strict suffix fast path; TC-0541 covers document-wide-definition fallback;
TC-0542 covers a fixed streamed-construct corpus; and TC-0544/0545 cover text
point recovery. This claim covers only the deterministic 64-step differential
append sequence and its per-step projection equality.

## Current public owner

The current public owner is the named `createContentPlan` export from
`src/model/content-plan.js`, reached through the existing local `plan` wrapper
in the test. The declaration uses no private helper, store, fixture, or
diagnostic export. Its original setup, fragment sequence, seed, append loop,
independent full parse, and per-append equality assertion are retained; only
the explicit case tag is added.

## File boundary and atomic claim

Only this report and the existing `tests/content-plan.test.js` declaration may
change. Product source, vendor, package, lockfile, fixtures, private exports,
and unrelated tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append the focused, adjacent, semantic,
and build evidence plus the final PASS or bounded regression disposition.

## Closeout — 2026-09-22

- **Reservation commit:** `aad4481` (`claim TC0543 deterministic append fuzz
  baseline`).
- **Migration:** the existing declaration is tagged
  `[TC-0543][AD-249]`; the deterministic fragment list, seed, 64-append loop,
  public `plan` calls, independent full parse, and per-step projection equality
  assertion are unchanged. No declaration was deleted/skipped and no private
  oracle or compatibility path was added.
- **Focused:**
  `npm test -- tests/content-plan.test.js --run -t 'TC-0543' --reporter=verbose`
  — **1 passed, 18 selection skips**; the skips are Vitest selection output,
  not skipped declarations.
- **Adjacent owner suite:**
  `npm test -- tests/content-plan.test.js --run --reporter=verbose` — **19
  passed, 0 failed**.
- **Adjacent semantic suite:**
  `npm test -- tests/content-plan-semantics.test.jsx --run --reporter=dot` —
  **10 passed**. It retains the pre-existing empty-`src` React warnings; no
  assertion failed.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. At every deterministic
  append the current public incremental projection remained byte-for-byte
  equivalent to the independent full projection. No product change or
  semantic weakening was required.
- **Final commit:** recorded below after this closeout and test-only tag.
