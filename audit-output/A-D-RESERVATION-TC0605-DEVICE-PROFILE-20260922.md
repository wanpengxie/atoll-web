# A–D reservation — TC-0605 / AD-311 persisted performance override

## Reservation

- **Case key:** `TC-0605` (A–D alias `AD-311`)
- **Baseline:** `fae8b70:tests/device-profile.test.js:28`
- **Current declaration:** `tests/device-profile.test.js:28`
- **Baseline title:** `?perf=mobile 压过判据,并被记住`
- **Current base:** `a08ecd792a0b7fce6a28ae86112c5ac3e330cfa9`
- **Branch:** `unit-a-d/tc0605-device-profile-a08ecd7`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/.tmp-tc0605-device-profile-a08ecd7-6aK4Tk`
- **Allowed change:** this report and the existing declaration in `tests/device-profile.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

The user may explicitly open the mobile performance path on a desktop device
with `?perf=mobile`, and that preference remains effective on the next
profile resolution when the URL no longer carries the override. An explicit
`?perf=desktop` selection returns to and persists the desktop path. The
override is a public diagnostic/user preference boundary, not a second
profile store or a restoration of any deleted compatibility API.

The public contract is
`detectProfile({ matchMedia, search, storage })` and the public
`PROFILE_MOBILE`/`PROFILE_DESKTOP` results. The retained baseline drives
desktop media, `?perf=mobile`, an empty search with the same storage, and
`?perf=desktop`; those inputs and assertions remain unchanged. The test does
not inspect the private `OVERRIDE_KEY`, module-level `resolved` state, a
private helper, or any implementation-specific storage shape beyond the
public storage boundary.

## Exact uniqueness precheck

The central migration ledger has one `TC-0605` row for
`tests/device-profile.test.js:28`; the historical inventory maps it to
`AD-311`. Exact searches for `TC-0605`, `TC0605`, `AD-311`, `AD311`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior TC-0605 claim before this reservation.
TC-0602 owns touch-plus-narrow selection, TC-0603 owns narrow non-touch
desktop, and TC-0604 owns wide-touch desktop; this reservation owns only the
explicit persisted override contract.

## Current public owner

The current public owner is `detectProfile` in
`src/model/device-profile.js`, with `PROFILE_MOBILE` and `PROFILE_DESKTOP`
as its public results. The test-local `matchMedia`, search, and storage
fixtures supply the same public input boundary used by the owner. No
Workspace hook, private export, alternate authority, or second preference
store is needed.

## File boundary and atomic claim

Only this report and the existing `tests/device-profile.test.js` declaration
may change. Product source, vendor, package, lockfile, fixtures, private
exports, and unrelated tests are out of scope. The worktree `node_modules`
symlink is untracked test infrastructure and must not be committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, owner-suite, adjacent,
and build evidence plus the final PASS or bounded regression disposition.
