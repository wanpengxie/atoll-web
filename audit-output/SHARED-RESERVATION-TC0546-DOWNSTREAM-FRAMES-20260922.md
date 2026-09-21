# Reservation — TC-0546 authoritative downstream frame shapes

## Claim

- **Case key:** `TC-0546` (OBS baseline; ledger owner `OBS`)
- **Baseline:** `fae8b70:tests/contract-fixtures.test.js:9`
- **Baseline title:** `parses every authoritative downstream frame shape`
- **Current base:** `509a43cacafa6c8b01fac28be35fc56aa694bbc6`
- **Branch/worktree:** `unit-e-h/tc0546-downstream-509a43c`
  / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0546-downstream-509a43c`
- **Allowed change:** this report and the existing declaration in
  `tests/contract-fixtures.test.js`; no product source, package, lockfile,
  vendor, fixture, private export, or unrelated test.

## Old behavior, user capability, and invariant

The baseline loads the existing `atoll-contract-v5.json` fixture and sends
each authoritative downstream frame shape through the public
`parseDownstream(JSON.stringify(value))` action. The user/evidence capability
is to recognize the six real v5 downstream carriers (`attach_receipt`,
`submit_receipt`, `feed`, `error`, `observe_ended`, and `resource_receipt`)
without treating a valid protocol frame as malformed or unknown. The strict
observable is that every parsed result is neither `invalid`, `bad_version`,
nor `unknown`; the fixture loop and all assertions remain unchanged.

## Current public owner and invariant

The sole public owner is `parseDownstream` in
`src/protocol/frame.js`. Its v5 discriminator checks the existing
`FRAME_VERSION` and closed `DOWN` vocabulary, returning the frame kind and
payload for recognized shapes. This migration does not add a parser,
fixture, protocol alias, private oracle, or second authority.

## Uniqueness and boundaries

The central migration ledger has one `TC-0546` row for
`tests/contract-fixtures.test.js:9`. Exact searches for `TC-0546`, `TC0546`,
the baseline title, and the source declaration found no current reservation,
claim, branch, or migration worktree before this reservation. Historical
restore indexes are not current claims.

This case is distinct from TC-0547, which checks the feed envelope's closed
field vocabulary; TC-0548, which checks the six OBS observation kinds and
completeness; and TC-0549, which checks terminal payload carriers. TC-0546
only proves downstream frame-shape recognition through `parseDownstream` and
must not be merged with those payload or observation contracts.

## Reservation

Only the explicit `[TC-0546]` label and this audit report may change. The
existing fixture, loop, parser call, and invalid/version/unknown assertions
are preserved byte-for-byte in meaning. Closeout will append focused,
adjacent, and build evidence plus the final PASS/REGRESSION disposition.
