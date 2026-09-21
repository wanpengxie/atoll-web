# A–D reservation — TC-0603 / AD-309 narrow non-touch device profile

## Reservation

- **Case key:** `TC-0603` (A–D alias `AD-309`)
- **Baseline:** `fae8b70:tests/device-profile.test.js:19`
- **Current declaration:** `tests/device-profile.test.js:19`
- **Baseline title:** `窄屏但不是触屏 → 桌面端`
- **Current base:** `73413e2b6e6734e8463b5a0b38a386d0b0e789f0`
- **Branch:** `unit-a-d/tc0603-device-profile-73413e2`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0603-device-profile-73413e2`
- **Allowed change:** this report and the existing declaration in `tests/device-profile.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

On a narrow viewport without touch capability, the user remains on the desktop
performance path. Width alone must not select mobile: the public profile owner
requires both `(pointer: coarse)` and `(max-width: 900px)` for mobile. The
touch-plus-narrow mobile contract is TC-0602; the wide-touch desktop contract
is TC-0604; the persisted `?perf` override is TC-0605. This case owns only the
narrow non-touch result and does not duplicate those behaviors.

The public contract is `detectProfile({ matchMedia, search, storage })` and
the public `PROFILE_DESKTOP` result. The test retains the baseline narrow-only
media fixture, empty search/storage action, and desktop result. It does not
inspect resolved state, call a private helper, add a second profile store, or
assert an implementation detail beyond the public profile value.

## Exact uniqueness precheck

The central migration ledger has one `TC-0603` row for
`tests/device-profile.test.js:19`; the historical inventory maps it to
`AD-309`. Exact searches for `TC-0603`, `TC0603`, `AD-309`, `AD309`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior claim before this reservation.
TC-0602, TC-0604, and TC-0605 own the neighboring profile contracts; this
reservation owns only the width-without-touch guard.

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
