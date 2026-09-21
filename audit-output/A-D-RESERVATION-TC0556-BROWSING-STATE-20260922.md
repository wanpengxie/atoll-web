# A–D reservation — TC-0556 / AD-262 browsing-state restore

## Reservation

- **Case key:** `TC-0556` (A–D alias `AD-262`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:19`
- **Current declaration:** `tests/conversation-viewport.test.js:72` (the file retained the exact case after earlier public Home-intent cases were inserted)
- **Baseline title:** `restores saved browsing state without creating an imperative navigation task`
- **Current base:** `5288a26068b1f4053b0a40e9750aca6678130457`
- **Branch:** `unit-a-d/tc0556-browsing-state-5288a26`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0556-browsing-state-5288a26`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a user returns to a conversation during the current page session, saved
browsing position must be restored as reading state without creating an
imperative navigation task. The invariant is the existing public
`createReadingSession` contract: a saved bookmark retains its message ID,
viewport offset, and row viewport offset; the session remains in browsing mode;
and the resulting session has no `navigation` task. This preserves user
reading intent while keeping navigation ownership separate.

## Exact uniqueness precheck

The central migration ledger has one `TC-0556` row for
`tests/conversation-viewport.test.js:19`; the historical inventory maps it to
`AD-262`. Exact searches for `TC-0556`, `TC0556`, `AD-262`, `AD262`, the
baseline title, and the current declaration found no reservation report, claim
commit, branch, or worktree before this reservation. The declaration moved to
line 72 only because earlier retained Home history-start cases now precede it;
its setup, action, and assertions are unchanged. TC-0555 was not claimed: its
old role-finalizer owner and declaration were explicitly removed by the current
owner reconciliation and cannot be restored under this migration contract.

This case is distinct from TC-0557's layout/data non-interference, TC-0558's
visible-row observation, and TC-0559's native-input cancellation. It covers
only saved browsing-state restoration and the absence of an imperative
navigation task.

## Current public owner

The current public owner is the named `createReadingSession` export and its
`READING_MODE.browsing` state in `src/model/reading-session.js`. The existing
`session` test wrapper calls that public constructor directly; no private hook,
DOM oracle, navigation task, alternate store, or compatibility API is
introduced. The bookmark fixture, browsing-mode assertion, bookmark projection,
and no-navigation assertion remain unchanged; migration adds only the case
tag.

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

- **Reservation commit:** `eda3631` (`claim TC0556 browsing state baseline`).
- **Migration:** the retained declaration is tagged
  `[TC-0556][AD-262]`; its bookmark fixture, browsing-mode assertion,
  bookmark projection, and no-navigation assertion remain unchanged. No test
  was deleted/skipped and no private oracle, imperative fallback, or second
  store was introduced.
- **Focused:**
  `npm test -- tests/conversation-viewport.test.js --run -t 'TC-0556' --reporter=verbose`
  — **1 passed, 20 selection skips**; the skips are Vitest selection output,
  not skipped declarations.
- **Adjacent owner suite:**
  `npm test -- tests/conversation-viewport.test.js --run --reporter=dot` —
  **21 passed, 0 failed**.
- **Adjacent reading suites:**
  `npm test -- tests/reading-session-ports.test.js tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js --run --reporter=dot`
  — **16 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. The public reading-session
  owner restores the saved browsing bookmark while keeping intent in browsing
  mode and creating no imperative navigation task. No product change or
  semantic weakening was required.
- **Final commit:** recorded below after this closeout and test-only tag.
