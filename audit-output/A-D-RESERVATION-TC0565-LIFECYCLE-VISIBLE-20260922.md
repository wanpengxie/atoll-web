# A–D reservation — TC-0565 / AD-271 lifecycle visible-row handoff

## Reservation

- **Case key:** `TC-0565` (A–D alias `AD-271`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:163`
- **Current declaration:** `tests/conversation-viewport.test.js:445`
- **Baseline title:** `records the actually visible row at lifecycle handoff without granting following`
- **Current base:** `5bea2e8d36da4158feeb8a43e716da1fb1ead41f`
- **Branch:** `unit-a-d/tc0565-lifecycle-visible-5bea2e8`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0565-lifecycle-visible-5bea2e8`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a browsing view is handed off by a lifecycle observation, the user must
return to the row that is actually visible at that handoff, while the handoff
must not silently take control and resume following. The session therefore
updates its browsing bookmark from the observed row and offset, but preserves
`browsing` mode because a lifecycle observation is not a current downward user
gesture.

The public contract is the existing `observeReading` transition: start with a
browsing bookmark for `m4`, observe the lifecycle handoff at `m7` with its
row-local offset, then assert that the session remains browsing and records the
new bookmark. The test retains the baseline setup, source, visible identity,
offset, and result. No DOM oracle, private state, second store, synthetic
gesture, or compatibility API is introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0565` row for
`tests/conversation-viewport.test.js:163`; the historical inventory maps it to
`AD-271`. Exact searches for `TC-0565`, `TC0565`, `AD-271`, `AD271`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior claim before this reservation. TC-0564
covers the geometry fence that rejects layout evidence as user intent; TC-0565
owns only the lifecycle bookmark handoff and its no-following result.

## Current public owner

The current public owner is the named reading-session model in
`src/model/reading-session.js`: `observeReading` consumes a lifecycle bookmark
for the current activation while changing neither mode nor following intent.
No private hook/export or alternate scrolling authority is needed.

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

- **Reservation commit:** `9fa4e0793cd4e17a0674890dab842f747e4064c4`
- **Migration:** the retained declaration is tagged `[TC-0565][AD-271]`; its
  browsing bookmark setup, lifecycle source, visible `m7` row and offset, and
  no-following result are unchanged.
- **Focused:** `npm test -- tests/conversation-viewport.test.js --run -t
  'TC-0565' --reporter=verbose` — 1 passed, 20 selection skips.
- **Viewport owner suite:** `tests/conversation-viewport.test.js` — 21 passed,
  0 failed.
- **Adjacent reading suites:** `tests/reading-session-ports.test.js
  tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js`
  — 17 passed, 0 failed.
- **Build:** `npm run build` — passed; Vite emitted only the existing large
  chunk advisory.
- **Disposition:** `PASS / MIGRATED`, credit 1. The public reading-session
  owner records the lifecycle-visible row and offset while preserving browsing
  mode; lifecycle evidence cannot silently grant following. No product change
  was made.
- **Final commit:** recorded after this closeout; only this report and the
  tagged existing test declaration are included.
