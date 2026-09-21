# Reservation — TC-0542 streamed suffix equivalence

## Claim

- **Case key:** `TC-0542` (CONTENT baseline; ledger owner `CONTENT`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:225`
- **Baseline title:** `keeps suffix parsing byte-for-byte equivalent to full parsing across streamed constructs`
- **Current base:** `e329ca5a1d4b0c47f4387c3a23848a8f46345536`
- **Branch/worktree:** `unit-e-h/tc0542-streamed-equivalence-e329ca5`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0542-streamed-equivalence-e329ca5`
- **Allowed change:** this report and the existing declaration in
  `tests/content-plan.test.js`; no product source, package, lockfile, vendor,
  fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline feeds one public content-plan key incrementally through the
existing `plan` wrapper, appending the exact streamed corpus in chunks: a
heading and growing paragraph, list items, a JavaScript fence, a GFM table,
continued quote, inline math, and raw HTML. After every chunk it independently
plans the same complete source under a separate key and compares the public
parser projection. The user capability is faithful rendering while a message
arrives in fragments, including constructs whose parse boundaries span
multiple chunks.

The strict invariant is byte-for-byte-equivalent projection after every
append: `kind`, source, semantic text, source range, render source, and
dependency revision must match the independent full parse. No partial or
intermediate incremental result may silently change Markdown/GFM/math/HTML
semantics. This case is distinct from TC-0540's one suffix metrics assertion
and TC-0543's deterministic fuzz corpus because it explicitly exercises the
curated cross-construct stream and checks every intermediate prefix.

## Uniqueness and boundaries

The central migration ledger has one `TC-0542` row for
`tests/content-plan.test.js:225`. Exact searches for `TC-0542`, `TC0542`, the
baseline title, and the source declaration found no current reservation,
claim, branch, or migration commit. Historical `AD-248` references in the
generic 2026-09-19 restore ledger are evidence indexes, not a current TC-0542
claim; they do not contain a reservation or this test tag. TC-0540 and TC-0541
are already separate migrated cases on the current main and are not modified.

Adjacent cases remain separate: TC-0539 covers unchanged-plan identity and
parse accounting; TC-0540 covers strict top-level suffix work; TC-0541 covers
document-wide definition fallback; TC-0543 covers deterministic append fuzz;
and TC-0544/0545 cover text-point recovery. This claim preserves only the
curated streamed-construct equivalence and its complete per-prefix projection
observable.

## Current public owner

The existing public owner is the named `createContentPlan` export in
`src/model/content-plan.js`, reached through the test's existing `plan`
wrapper. No private helper, diagnostic event, or alternate parser is
introduced. The baseline chunks, public actions, full-plan comparison, and all
projection fields remain unchanged; migration adds only the case tag.

## File boundary and reservation

Only this report and the existing test declaration may change. The worktree's
`node_modules` symlink, if present, is untracked test infrastructure and will
not be committed.

Closeout will append focused, adjacent, and build evidence plus the final
PASS/REGRESSION disposition.

## Closeout — 2026-09-22

- **Migration:** added only the explicit `[TC-0542]` tag to the existing test
  declaration. All streamed chunks, incremental/full public `plan` calls, and
  per-prefix projection comparisons remain unchanged; no skip/filter/private
  oracle was introduced.
- **Focused:**
  `npm test -- tests/content-plan.test.js --run -t 'TC-0542' --reporter=verbose`
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
  public-owner proof of byte-for-byte parser projection equivalence at every
  streamed prefix across Markdown/GFM/math/HTML constructs. No product change
  or semantic weakening was required.
