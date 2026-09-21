# A–D reservation — TC-0559 / AD-265 native-input cancellation

## Reservation

- **Case key:** `TC-0559` (A–D alias `AD-265`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:47`
- **Current declaration:** `tests/conversation-viewport.test.js:100` (the file retained the exact case after earlier public history-intent cases were inserted)
- **Baseline title:** `invalidates a pending return-to-bottom synchronously on native input`
- **Current base:** `35daba8c8ec1deb6164355c55a4403bb3de1dc55`
- **Branch:** `unit-a-d/tc0559-native-input-35daba8`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0559-native-input-35daba8`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a user starts browsing upward while a return-to-bottom request is still
pending, native input must synchronously take back reading control. The pending
application-owned bottom intent must be cleared, the session must be in
`browsing`, and a stale copy of the old intent must be unable to consume or
restore following. This protects the user's explicit scroll choice from a
late return-to-bottom command and does not require mirroring or cancelling
the list component's internal work.

The preserved public contract is the current `requestLatest` plus
`takeReadingControl`/`consumeLatestIntent` transition: request `latest`, then
apply a newer native `older` gesture, and assert the returned session remains
`browsing`, has an empty bottom-intent id, and rejects the old intent by
identity/authority. No DOM oracle, private state, second store, or compatibility
API is introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0559` row for
`tests/conversation-viewport.test.js:47`; the historical inventory maps it to
`AD-265`. Exact searches for `TC-0559`, `TC0559`, `AD-265`, `AD265`, the
baseline title, and the current declaration found no reservation report, claim
commit, branch, or worktree before this reservation. `TC-0558` is separately
claimed by `unit-e-h/tc0558-visible-row-35daba8`; that visible-row case is not
reused here. This case is also distinct from TC-0556's saved-state restoration,
TC-0557's layout/data non-interference, and TC-0552's broader reading fuzz.

## Current public owner

The current public owner is the named reading-session model in
`src/model/reading-session.js`: `requestLatest`, `takeReadingControl`, and
`consumeLatestIntent` are the only public transition functions exercised by
the retained contract. `takeReadingControl` is the native-input boundary and
clears the application-owned bottom intent while advancing the input epoch.
No private hook/export or UI workaround is needed.

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

- **Reservation commit:** `c1079fe` (`chore(a-d): reserve TC0559 native input cancellation`).
- **Migration:** the retained declaration is tagged `[TC-0559][AD-265]`; its
  `latest` request, native `older` gesture, browsing-mode assertion, empty
  bottom-intent assertion, and stale-intent rejection remain unchanged. No
  test was deleted/skipped and no private oracle, second store, or product
  code was introduced.
- **Focused:**
  `npm test -- tests/conversation-viewport.test.js --run -t 'TC-0559' --reporter=verbose`
  — **1 passed, 20 selection skips**; the skips are Vitest selection output,
  not skipped declarations.
- **Owner suite:**
  `npm test -- tests/conversation-viewport.test.js --run --reporter=dot`
  — **21 passed, 0 failed**.
- **Adjacent reading suites:**
  `npm test -- tests/reading-session-ports.test.js tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js --run --reporter=dot`
  — **17 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. The public
  reading-session owner synchronously revokes the pending return-to-bottom
  intent when native input starts browsing, preserving the user's browsing
  choice and rejecting the stale command without a product change.
- **Final commit:** recorded below after this closeout and test-only tag.
