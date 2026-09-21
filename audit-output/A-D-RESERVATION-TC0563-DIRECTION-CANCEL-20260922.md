# A–D reservation — TC-0563 / AD-269 direction cancellation

## Reservation

- **Case key:** `TC-0563` (A–D alias `AD-269`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:106`
- **Current declaration:** `tests/conversation-viewport.test.js:388`
- **Baseline title:** `updates direction evidence inside one input epoch and cancellation revokes it`
- **Current base:** `08f9d76962abebf73639fb1b19e90d5cd7178d95`
- **Branch:** `unit-a-d/tc0563-direction-cancel-08f9d76`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0563-direction-cancel-08f9d76`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

While a user changes direction during one input epoch, the reading session must
retain that epoch and replace the pending directional evidence with the latest
direction. Once that gesture is cancelled, its evidence must be revoked: a
later tail observation from the cancelled epoch cannot silently resume
following. The user therefore keeps browsing after cancellation until a fresh,
authorized interaction establishes a new following transition.

The public contract is the existing
`takeReadingControl`/`updateReadingControl`/`cancelReadingControl` plus
`observeReading` transition. The test preserves the baseline sequence: start
older, reverse to newer in the same epoch, reverse back to older, establish a
newer direction, cancel that gesture, then prove stale tail evidence leaves the
session in `browsing`. No DOM oracle, private state, second store, synthetic
gesture, or compatibility API is introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0563` row for
`tests/conversation-viewport.test.js:106`; the historical inventory maps it to
`AD-269`. Exact searches for `TC-0563`, `TC0563`, `AD-269`, `AD269`, the
baseline title, and the current declaration found no reservation report, claim
commit, branch, or worktree before this reservation. TC-0562 covers only the
current downward evidence needed to resume following; TC-0564 covers layout
clamp evidence and is not reused here.

## Current public owner

The current public owner is the reading-session model in
`src/model/reading-session.js`: `takeReadingControl` starts the user epoch,
`updateReadingControl` replaces direction evidence within that epoch, and
`cancelReadingControl` revokes the gesture before `observeReading` evaluates
tail evidence. No private hook/export or alternate scrolling authority is
needed.

## File boundary and atomic claim

Only this report and the existing `tests/conversation-viewport.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.

## Closeout — 2026-09-22

- **Reservation commit:** `5c82391c79d3495d71d502ae90fc420739fe82f7`
- **Migration:** the retained declaration is tagged `[TC-0563][AD-269]`; its
  original same-epoch direction updates, cancellation, and stale observation
  assertions are unchanged.
- **Focused:** `npm test -- tests/conversation-viewport.test.js --run -t
  'TC-0563' --reporter=verbose` — 1 passed, 20 selection skips.
- **Viewport owner suite:** `tests/conversation-viewport.test.js` — 21 passed,
  0 failed.
- **Adjacent reading suites:** `tests/reading-session-ports.test.js
  tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js`
  — 17 passed, 0 failed.
- **Build:** `npm run build` — passed; Vite emitted only the existing large
  chunk advisory.
- **Disposition:** `PASS / MIGRATED`, credit 1. The public reading-session
  owner preserves one input epoch while direction evidence changes and revokes
  cancelled evidence before tail observations can restore following. No
  product change was made.
- **Final commit:** recorded after this closeout; only this report and the
  tagged existing test declaration are included.
