# Reservation — TC-0548 OBS observation kinds and completeness

## Claim

- **Case key:** `TC-0548` (OBS baseline; ledger owner `OBS`)
- **Baseline:** `fae8b70:tests/contract-fixtures.test.js:24`
- **Baseline title:** `pins all six real OBS observation kinds and completeness`
- **Current base:** `165453af9b8fd552d7c21835ab065b3e89fe5274`
- **Branch/worktree:** `unit-e-h/tc0548-observation-165453a`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0548-observation-165453a`
- **Allowed change:** this report and the existing declaration in
  `tests/contract-fixtures.test.js`; no product source, package, lockfile,
  vendor, fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline loads the existing `atoll-contract-v5.json` OBS evidence fixture,
enumerates its six authoritative observation streams (`actors`, `channels`,
`daemons`, `decls`, `principals`, and `profile`), and checks each stream's
declared kind, boolean completeness marker, and array-shaped items. The user
and evidence capability is to distinguish a complete observation stream from
an absent, mislabelled, or structurally invalid OBS result. The strict
observable is the exact six-kind set and the per-kind `kind`/`complete`/
`items` shape; the fixture iteration and assertions remain unchanged.

## Current public owner and invariant

The ledger's single owner is OBS, represented by the existing diagnostics and
contract-evidence path (`src/model/diagnostics.js` plus
`tests/fixtures/atoll-contract-v5.json`). This case is evidence-shape
validation only: it does not invent a diagnostics provider, second observation
store, RPC-like synchronizer, private oracle, or frontend authority. The
existing fixture remains the sole source of the six public observation kinds.

## Uniqueness and boundaries

The central migration ledger has one `TC-0548` row for
`tests/contract-fixtures.test.js:24`. Exact searches for `TC-0548`, `TC0548`,
the baseline title, and the source declaration found no current reservation,
claim, branch, or migration worktree before this reservation. TC-0547 is
already reserved by another agent and is not touched here; historical restore
indexes are not current claims.

This case is distinct from TC-0546, which recognizes downstream frame
discriminators; TC-0547, which checks feed-envelope field vocabulary; and
TC-0549, which checks terminal payload carriers. TC-0548 only proves the
closed OBS observation-kind set and completeness/item shape, and must not be
merged with frame or payload semantics.

## Reservation

Only the explicit `[TC-0548]` label and this audit report may change. The
existing fixture, exact six-kind expectation, loop, and kind/completeness/items
assertions are preserved byte-for-byte in meaning. Closeout will append
focused, adjacent, and build evidence plus the final PASS/REGRESSION
disposition.
