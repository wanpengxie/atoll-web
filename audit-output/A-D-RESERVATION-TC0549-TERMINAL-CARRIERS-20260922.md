# A–D reservation — TC-0549 / AD-255 terminal payload carriers

## Reservation

- **Case key:** `TC-0549` (A–D alias `AD-255`)
- **Baseline:** `fae8b70:tests/contract-fixtures.test.js:33`
- **Baseline title:** `pins the real terminal payload carriers`
- **Current base:** `c7649ae8d0fdabaf400df18b6827ef4331747c31`
- **Branch:** `unit-a-d/tc0549-terminal-c7649ae`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0549-terminal-c7649ae`
- **Allowed change:** this report and the existing declaration in `tests/contract-fixtures.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

Terminal downstream replies and errors must retain their real public carriers
so the client can display authoritative outcomes without guessing a shape or
manufacturing a success. The invariant is the existing v5 contract fixture:
registrar success carries `{status, value}`, registrar failure carries the
authoritative `error_code`, member list/create and agent reply retain their
documented carriers, actor description remains the declared public shape, and
resource receipt retains its `ticket` and `redeem` payload fields. The test
pins those exact carriers, including the distinction between nested and
flattened terminal replies.

## Exact uniqueness precheck

The central migration ledger has one `TC-0549` row for
`tests/contract-fixtures.test.js:33`; the historical inventory maps it to
`AD-255`. Exact searches for `TC-0549`, `TC0549`, `AD-255`, `AD255`, the
baseline title, and the declaration found no reservation report, claim
commit, branch, or worktree before this reservation. TC-0546 is already
migrated on the current base, TC-0547 is a separate feed-envelope claim, and
TC-0548 is held by `unit-e-h/tc0548-observation-165453a`; none is touched.

This claim is distinct from TC-0546's downstream frame discriminator checks,
TC-0547's closed feed-envelope fields, and TC-0548's six OBS observation kinds
and completeness. Earlier TC-0533–0545 content-plan contracts are unrelated
parser/text-point behavior. TC-0549 covers only terminal payload carriers and
their nested/flat shape boundaries.

## Current public owner

The current public protocol owner is the v5 downstream frame projection
contract implemented by `parseDownstream` in `src/protocol/frame.js`, with
the checked-in `atoll-contract-v5.json` fixture supplying the authoritative
terminal carriers. This test deliberately exercises the public fixture
projection rather than a private parser/helper; it introduces no second
authority, fabricated backend result, or compatibility path. The existing
fixture lookups and all carrier assertions remain unchanged; migration adds
only the case tag.

## File boundary and atomic claim

Only this report and the existing `tests/contract-fixtures.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.
