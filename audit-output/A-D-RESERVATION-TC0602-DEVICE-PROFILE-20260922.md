# A–D reservation — TC-0602 / AD-308 touch-and-narrow device profile

## Reservation

- **Case key:** `TC-0602` (A–D alias `AD-308`)
- **Baseline:** `fae8b70:tests/device-profile.test.js:14`
- **Current declaration:** `tests/device-profile.test.js:14`
- **Baseline title:** `触屏 + 窄屏 → 移动端`
- **Current base:** `73413e2b6e6734e8463b5a0b38a386d0b0e789f0`
- **Branch:** `unit-a-d/tc0602-device-profile-73413e2`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0602-device-profile-73413e2`
- **Allowed change:** this report and the existing declaration in `tests/device-profile.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

On a touch device with a narrow viewport, the user receives the mobile
performance path. The profile is selected only when both public media-query
facts are true: `(pointer: coarse)` and `(max-width: 900px)`. A narrow
non-touch device and a wide touch device are separate contracts owned by
TC-0603 and TC-0604; the persisted `?perf` override is TC-0605 and is not
duplicated here.

The public contract is `detectProfile({ matchMedia, search, storage })` and
the public `PROFILE_MOBILE` result. The test retains the baseline media setup,
empty search/storage action, and mobile result. It does not inspect resolved
state, call a private helper, add a second profile store, or assert an
implementation detail beyond the public profile value.

## Exact uniqueness precheck

The central migration ledger has one `TC-0602` row for
`tests/device-profile.test.js:14`; the historical inventory maps it to
`AD-308`. Exact searches for `TC-0602`, `TC0602`, `AD-308`, `AD308`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior claim before this reservation.
TC-0603, TC-0604, and TC-0605 own the neighboring desktop and override
contracts; this reservation owns only the touch-plus-narrow selection.

## Current public owner

The current public owner is `detectProfile` in
`src/model/device-profile.js`, with `PROFILE_MOBILE` as its public result.
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
