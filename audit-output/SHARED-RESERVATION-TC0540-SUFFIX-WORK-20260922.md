# Reservation — TC-0540 strict append suffix parsing

## Claim

- **Case key:** `TC-0540` (CONTENT baseline; ledger owner `CONTENT`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:183`
- **Baseline title:** `reparses only the final top-level suffix for a strict append`
- **Current base:** `a0e9c74d0ecfe9856f4cac5bcc8faf27cc0f7330`
- **Branch/worktree:** `unit-e-h/tc0540-suffix-a0e9c74`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0540-suffix-a0e9c74`
- **Allowed change:** this report and the existing declaration in
  `tests/content-plan.test.js`; no product source, package, lockfile, vendor,
  fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline creates an 80-section Markdown prefix, plans it under
`message:suffix-fast-path:body`, appends one streamed paragraph under the same
content key using `previous: first` and a metrics object, and independently
plans the complete source under a different key. The user capability is
incremental content rendering that preserves the existing plan's block
identity while parsing only the newly appended top-level suffix. The observable
contract is exact: the incremental and full parser projections are equal;
`parseCount` and `suffixParseCount` are each `1`; `fullParseCount` is absent;
`parsedCharacters` is below one tenth of the complete source length; and the
first block's `blockID` is retained.

This is a strict public-owner behavior proof, not a performance-only claim:
the projection equality protects rendered semantics, the metrics distinguish
the suffix path from a full parse, and the identity assertion protects the
user's existing rendered block from replacement during streaming.

## Uniqueness and boundaries

The central migration ledger has one `TC-0540` row for
`tests/content-plan.test.js:183`. Exact searches for `TC-0540`, `TC0540`, the
baseline title, and the source declaration found no current claim report,
branch, or migration commit. Historical `AD-246` references in the generic
2026-09-19 restore ledger are evidence indexes, not a current TC-0540 claim;
they do not contain a reservation or this test tag.

Adjacent cases are not merged into this claim: TC-0539 proves unchanged-plan
identity and parse accounting; TC-0541 proves the full-parse fallback for a
document-wide definition; TC-0542 covers streamed construct differential
equivalence; TC-0543 is deterministic append fuzz; and TC-0544/0545 cover text
point recovery. This claim preserves only the strict top-level suffix fast
path and its exact metrics/identity observables.

## Current public owner

The existing public owner is the named `createContentPlan` export in
`src/model/content-plan.js`, reached by the test's existing `plan` wrapper.
No private helper or alternate parser is introduced. The test exercises the
same public setup, actions, and assertions from the baseline; migration adds
only its explicit case tag.

## File boundary and reservation

Only this report and the existing test declaration may change. The worktree's
`node_modules` symlink, if present, is untracked test infrastructure and will
not be committed.

Closeout will append focused, adjacent, and build evidence plus the final
PASS/REGRESSION disposition.
