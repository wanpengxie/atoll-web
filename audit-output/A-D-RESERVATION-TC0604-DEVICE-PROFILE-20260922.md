# A–D reservation — TC-0604 / AD-310 wide touch device profile

## Reservation

- **Case key:** `TC-0604` (A–D alias `AD-310`)
- **Baseline:** `fae8b70:tests/device-profile.test.js:23`
- **Current declaration:** `tests/device-profile.test.js:23`
- **Baseline title:** `触屏但宽屏（平板横放、触屏一体机）→ 桌面端`
- **Current base:** `528d5f7695ef0b71fbf82bb707326ae2e976b945`
- **Branch:** `unit-a-d/tc0604-device-profile-528d5f7`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0604-device-profile-528d5f7`
- **Allowed change:** this report and the existing declaration in `tests/device-profile.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

On a wide touch device, the user remains on the desktop performance path.
Touch alone must not select mobile: the public profile owner requires both
`(pointer: coarse)` and `(max-width: 900px)` for mobile. The touch-plus-narrow
mobile contract is TC-0602, the narrow non-touch desktop guard is TC-0603, and
the persisted `?perf` override is TC-0605. This case owns only the wide-touch
result and does not duplicate those behaviors.

The public contract is `detectProfile({ matchMedia, search, storage })` and
the public `PROFILE_DESKTOP` result. The test retains the baseline coarse-only
media fixture, empty search/storage action, and desktop result. It does not
inspect resolved state, call a private helper, add a second profile store, or
assert an implementation detail beyond the public profile value.

## Exact uniqueness precheck

The central migration ledger has one `TC-0604` row for
`tests/device-profile.test.js:23`; the historical inventory maps it to
`AD-310`. Exact searches for `TC-0604`, `TC0604`, `AD-310`, `AD310`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior claim before this reservation.
TC-0602, TC-0603, and TC-0605 own the neighboring profile contracts; this
reservation owns only the touch-without-narrow guard.

## Current public owner

The current public owner is `detectProfile` in
`src/model/device-profile.js`, with `PROFILE_DESKTOP` as its public result.
The test-local `matchMedia` and storage fixtures supply the same public input
boundary used by the owner. No Workspace private hook or alternate authority
is needed.

## File boundary and atomic claim

Only this report and the existing `tests/device-profile.test.js` declaration
may change. Product source, vendor, package, lockfile, fixtures, private
exports, and unrelated tests are out of scope. The worktree `node_modules`
symlink is untracked test infrastructure and must not be committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.
