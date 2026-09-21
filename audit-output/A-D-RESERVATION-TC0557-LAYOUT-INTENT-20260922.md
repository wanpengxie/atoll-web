# A–D reservation — TC-0557 / AD-263 layout-intent fence

## Reservation

- **Case key:** `TC-0557` (A–D alias `AD-263`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:27`
- **Current declaration:** `tests/conversation-viewport.test.js:80` (the file retained the exact case after earlier public history-intent cases were inserted)
- **Baseline title:** `never changes browsing intent because data or geometry changed`
- **Current base:** `35daba8c8ec1deb6164355c55a4403bb3de1dc55`
- **Branch:** `unit-a-d/tc0557-layout-intent-35daba8`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0557-layout-intent-35daba8`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

While the user is browsing a conversation, a data/layout observation at the
tail must not silently switch the session to following or move its saved
reading anchor. The invariant is the current public `createReadingSession`
and `observeReading` contract: starting in browsing mode with bookmark `m4`, a
layout observation at the tail leaves the mode as `browsing` and preserves the
bookmark's message ID. The test proves that geometry is evidence only, not
user intent, and does not create a navigation task or second authority.

## Exact uniqueness precheck

The central migration ledger has one `TC-0557` row for
`tests/conversation-viewport.test.js:27`; the historical inventory maps it to
`AD-263`. Exact searches for `TC-0557`, `TC0557`, `AD-263`, `AD263`, the
baseline title, and the current declaration found no reservation report, claim
commit, branch, or worktree before this reservation. The declaration moved to
line 80 only because earlier retained history-start cases were inserted; its
setup, action, and assertions are unchanged.

This case is distinct from TC-0556's saved-state restoration, TC-0558's
visible-row observation, TC-0559's native-input cancellation, and TC-0552's
broader data/layout event fuzz. It covers only the single layout observation
boundary that must not alter browsing intent or the current bookmark.

## Current public owner

The current public owner is the named `createReadingSession` state constructor
and `observeReading` transition in `src/model/reading-session.js`, reached by
the existing local `session` wrapper. No private hook/export, DOM oracle,
imperative navigation, alternate store, or compatibility API is introduced.
The existing bookmark fixture, layout observation, browsing-mode assertion,
and bookmark identity assertion remain unchanged; migration adds only the
case tag.

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

- **Reservation commit:** `bc62fb7` (`claim TC0557 layout intent baseline`).
- **Migration:** the retained declaration is tagged
  `[TC-0557][AD-263]`; its browsing bookmark, layout observation, browsing-mode
  assertion, and bookmark identity assertion remain unchanged. No test was
  deleted/skipped and no private oracle, imperative navigation, or second
  store was introduced.
- **Focused:**
  `npm test -- tests/conversation-viewport.test.js --run -t 'TC-0557' --reporter=verbose`
  — **1 passed, 20 selection skips**; the skips are Vitest selection output,
  not skipped declarations.
- **Adjacent owner suite:**
  `npm test -- tests/conversation-viewport.test.js --run --reporter=dot` —
  **21 passed, 0 failed**.
- **Adjacent reading suites:**
  `npm test -- tests/reading-session-ports.test.js tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js --run --reporter=dot`
  — **17 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. The public reading-session
  owner keeps browsing intent and the existing bookmark when a layout-tail
  observation arrives; geometry does not impersonate current downward user
  evidence. No product change or semantic weakening was required.
- **Final commit:** recorded below after this closeout and test-only tag.
