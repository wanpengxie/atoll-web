# A–D reservation — TC-0564 / AD-270 layout clamp evidence

## Reservation

- **Case key:** `TC-0564` (A–D alias `AD-270`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:147`
- **Current declaration:** `tests/conversation-viewport.test.js:429`
- **Baseline title:** `does not reinterpret a later layout clamp as downward user evidence`
- **Current base:** `5bea2e8d36da4158feeb8a43e716da1fb1ead41f`
- **Branch:** `unit-a-d/tc0564-layout-clamp-5bea2e8`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0564-layout-clamp-5bea2e8`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

A layout clamp is a physical rendering correction, not a new downward user
gesture. If a newer-direction gesture's tail evidence is followed by a later
layout observation at a newer geometry revision, that stale evidence must not
be reinterpreted as user intent. A subsequent tail observation at the clamped
geometry therefore keeps the reader in `browsing` until a fresh authorized
gesture establishes new evidence.

The public contract is the existing `takeReadingControl` plus
`observeReading` transition: create newer evidence at geometry revision 4,
observe a layout tail at revision 5, then observe a user tail at that same
revision and assert that both observations leave the session browsing. The
test retains the baseline setup, sources, revisions, and result. No DOM oracle,
private state, second store, synthetic gesture, or compatibility API is
introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0564` row for
`tests/conversation-viewport.test.js:147`; the historical inventory maps it to
`AD-270`. Exact searches for `TC-0564`, `TC0564`, `AD-270`, `AD270`, the
baseline title, the current declaration, reservation reports, claim commits,
branches, and worktrees found no prior claim before this reservation. TC-0562
covers current downward evidence resuming following, and TC-0563 covers
direction updates plus cancellation within one epoch; neither claims the
layout-clamp geometry fence here. TC-0565 is the distinct lifecycle bookmark
handoff case.

## Current public owner

The current public owner is the named reading-session model in
`src/model/reading-session.js`: `takeReadingControl` records the user
direction and geometry revision, while `observeReading` admits following only
for matching current user evidence and exact geometry. Layout observations can
advance geometry without authorizing following. No private hook/export or
alternate scrolling authority is needed.

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

- **Reservation commit:** `8b30fc1b4af605a134afc77f0af1e7bd6998110a`
- **Migration:** the retained declaration is tagged `[TC-0564][AD-270]`; its
  newer gesture, later layout clamp, same-revision user observation, and final
  `browsing` assertions are unchanged.
- **Focused:** `npm test -- tests/conversation-viewport.test.js --run -t
  'TC-0564' --reporter=verbose` — 1 passed, 20 selection skips.
- **Viewport owner suite:** `tests/conversation-viewport.test.js` — 21 passed,
  0 failed.
- **Adjacent reading suites:** `tests/reading-session-ports.test.js
  tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js`
  — 17 passed, 0 failed.
- **Build:** `npm run build` — passed; Vite emitted only the existing large
  chunk advisory.
- **Disposition:** `PASS / MIGRATED`, credit 1. The public reading-session
  owner keeps a layout clamp from authorizing following and requires fresh
  matching user evidence after the geometry revision changes. No product
  change was made.
- **Final commit:** recorded after this closeout; only this report and the
  tagged existing test declaration are included.
