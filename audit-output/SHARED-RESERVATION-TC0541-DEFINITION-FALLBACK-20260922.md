# Reservation — TC-0541 document-wide definition fallback

## Claim

- **Case key:** `TC-0541` (CONTENT baseline; ledger owner `CONTENT`)
- **Baseline:** `fae8b70:tests/content-plan.test.js:204`
- **Baseline title:** `falls back to a full parse when an append introduces a document-wide definition`
- **Current base:** `565e7163c04df056a822db3dd70f42763e98fb03`
- **Branch/worktree:** `unit-e-h/tc0541-definition-fallback-565e716`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0541-definition-fallback-565e716`
- **Allowed change:** this report and the existing declaration in
  `tests/content-plan.test.js`; no product source, package, lockfile, vendor,
  fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline first plans `prefix\n\n[reference][target]` under
`message:suffix-definition:body`. It then appends the document-wide definition
`[target]: https://example.test` with `previous: first` and metrics, and builds
an independent full plan for the resulting source. The user capability is
correct streaming Markdown rendering when a later append changes the
document-global reference environment. The invariant is fail-safe fallback:
the incremental result's public parser projection exactly equals the
independent full result, one suffix parse and one full parse are recorded, and
the rendered first block includes the appended definition. The test therefore
guards both semantic correctness and the explicit choice not to run an
isolated suffix parser against document-wide definitions.

## Uniqueness and boundaries

The central migration ledger has one `TC-0541` row for
`tests/content-plan.test.js:204`. Exact searches for `TC-0541`, `TC0541`, the
baseline title, and the source declaration found no current reservation,
claim, branch, or migration commit. Historical `AD-247` references in the
generic 2026-09-19 restore ledger are evidence indexes, not a current TC-0541
claim; they do not contain a reservation or this test tag. TC-0540 is a
separate active claim owned by this agent and covers strict top-level suffix
parsing without document-wide definitions; it is not modified here.

Adjacent cases remain separate: TC-0539 covers unchanged-plan identity and
parse accounting; TC-0540 covers suffix-only work and identity; TC-0542 covers
streamed-construct byte equivalence; TC-0543 is deterministic append fuzz;
and TC-0544/0545 cover text-point recovery. This claim preserves only the
document-wide-definition fallback and its exact projection/metrics/render
observables.

## Current public owner

The existing public owner is the named `createContentPlan` export in
`src/model/content-plan.js`, reached through the test's existing `plan`
wrapper. Its public implementation intentionally returns `null` from the
suffix fast path when prior blocks carry a document dependency, then performs
the normal full parse. No private helper or alternate parser is introduced;
the baseline setup, actions, and assertions are preserved exactly and only
the case tag is added.

## File boundary and reservation

Only this report and the existing test declaration may change. The worktree's
`node_modules` symlink, if present, is untracked test infrastructure and will
not be committed.

Closeout will append focused, adjacent, and build evidence plus the final
PASS/REGRESSION disposition.
