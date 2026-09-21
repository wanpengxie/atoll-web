# A–D reservation — TC-0606 / AD-312 missing profile signals

## Reservation

- **Case key:** `TC-0606` (A–D alias `AD-312`)
- **Baseline:** `fae8b70:tests/device-profile.test.js:36`
- **Current declaration:** `tests/device-profile.test.js:36`
- **Baseline title:** `判据缺失（jsdom、旧浏览器）恒落到今天已经在跑的那条路径`
- **Current base:** `546a3d53dd59d16d04dc28a19bada7117dc46650`
- **Branch:** `unit-a-d/tc0606-device-profile-546a3d5`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0606-device-profile-546a3d5`
- **Allowed change:** this report and the existing declaration in `tests/device-profile.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a browser does not expose `matchMedia` (for example jsdom or an older
browser), the profile decision must safely remain on the existing desktop
path. Missing capability signals must not throw, guess mobile, or create a
second fallback authority. This case owns only the missing-`matchMedia`
desktop result; touch/width and explicit `?perf` cases are separate baselines.

The public contract is `detectProfile({ matchMedia, search, storage })` and
the public `PROFILE_DESKTOP` result. The test retains the baseline undefined
`matchMedia`, empty search/storage action, and desktop result. It does not
inspect resolved state, call a private helper, add a second profile store, or
assert an implementation detail beyond the public profile value.

## Exact uniqueness precheck

The central migration ledger has one `TC-0606` row for
`tests/device-profile.test.js:36`; the historical inventory maps it to
`AD-312`. Exact searches for `TC-0606`, `TC0606`, `AD-312`, `AD312`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior claim before this reservation.
TC-0602 through TC-0605 own the explicit touch/width and override contracts;
this reservation owns only the missing-signal fallback.

## Current public owner

The current public owner is `detectProfile` in
`src/model/device-profile.js`, with `PROFILE_DESKTOP` as its public result.
The test-local storage fixture supplies the same public input boundary used by
the owner. No Workspace private hook or alternate authority is needed.

## File boundary and atomic claim

Only this report and the existing `tests/device-profile.test.js` declaration
may change. Product source, vendor, package, lockfile, fixtures, private
exports, and unrelated tests are out of scope. The worktree `node_modules`
symlink is untracked test infrastructure and must not be committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.
