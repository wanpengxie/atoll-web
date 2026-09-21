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

## Closeout — 2026-09-22

- **Reservation commit:** `b1c06e2988cfa15ad2f3f195ed544d1ddc431750`
- **Migration:** the retained declaration is tagged
  `[TC-0602][AD-308]`; its coarse-pointer and narrow-width media fixtures,
  empty override input, storage fixture, and `PROFILE_MOBILE` result are
  unchanged.
- **Focused:** `npm test -- tests/device-profile.test.js --run -t
  'TC-0602' --reporter=verbose` — 1 passed, 4 selection skips.
- **Owner suite:** `tests/device-profile.test.js` — 5 passed, 0 failed.
- **Adjacent public profile contract:** `npm test --
  tests/i-m-exact-path-contracts.test.jsx --run -t 'memory-window baseline 36'
  --reporter=verbose` — 1 passed, 169 selection skips.
- **Build:** `npm run build` — passed; Vite emitted only the existing large
  chunk advisory.
- **Disposition:** `PASS / MIGRATED`, credit 1. The current public
  `detectProfile` owner selects mobile only when the touch and narrow viewport
  facts are both present. Neighboring desktop and `?perf` contracts remain
  separate cases; no product change was made.
- **Final commit:** recorded after this closeout; only this report and the
  tagged existing test declaration are included.
