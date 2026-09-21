# A–D reservation — TC-0554 / AD-260 suspended presentation fence

## Reservation

- **Case key:** `TC-0554` (A–D alias `AD-260`)
- **Baseline:** `fae8b70:tests/conversation-presentation-react.test.jsx:40`
- **Baseline title:** `does not rebase the committed view after a different view suspends`
- **Current base:** `b34b59d3ed825237033a8e35d1003f18b26dc6c5`
- **Branch:** `unit-a-d/tc0554-suspended-presentation-b34b59d`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0554-suspended-presentation-b34b59d`
- **Allowed change:** this report and the existing declaration in `tests/conversation-presentation-react.test.jsx`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a different conversation view suspends during rendering, the user must
continue seeing the already committed view rather than a speculative
projection from the suspended tree. The invariant is the public
`createConversationPresentation` contract: the initial view commits its
projection; a suspended candidate for another view is evaluated but not
committed; the Suspense fallback is observable; and the resumed original view
returns the same snapshot, entity identity, and revision. This protects
continuity without asserting DOM survival or creating a second presentation
owner.

## Exact uniqueness precheck

The central migration ledger has one `TC-0554` row for
`tests/conversation-presentation-react.test.jsx:40`; the historical inventory
maps it to `AD-260`. Exact searches for `TC-0554`, `TC0554`, `AD-260`, `AD260`,
the baseline title, and the declaration found no reservation report, claim
commit, branch, or worktree before this reservation. TC-0553 is separately
held by `unit-e-h/tc0553-activation-b92fe41` and is not touched.

This case is distinct from TC-0552's data/layout reading-intent fuzz, TC-0553's
A→B→A stale-save authority, and TC-0555's suspended-view latest-role
invariant. It covers only the React Suspense candidate/commit fence and
preservation of the already committed view.

## Current public owner

The current public owner is the named `createConversationPresentation` export
from `src/model/conversation-presentation.js`. The test uses the existing
public `evaluate`/`commitCandidate`/`current` surface through its local
projection helpers; no private hook, DOM diagnostic, alternate store, or
compatibility API is introduced. The original message fixture, committed
initial projection, suspended candidate, fallback assertion, resumed
projection, identity assertion, and revision assertion remain unchanged;
migration adds only the case tag.

## File boundary and atomic claim

Only this report and the existing
`tests/conversation-presentation-react.test.jsx` declaration may change.
Product source, vendor, package, lockfile, fixtures, private exports, and
unrelated tests are out of scope. The worktree `node_modules` symlink is
untracked test infrastructure and must not be committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.

## Closeout — 2026-09-22

- **Reservation commit:** `e8812e6` (`claim TC0554 suspended presentation
  baseline`).
- **Migration:** the existing declaration is tagged
  `[TC-0554][AD-260]`; its Suspense fallback, candidate evaluation,
  committed-snapshot identity, entity identity, and revision assertions remain
  unchanged. No test was deleted/skipped and no private oracle, alternate
  store, or compatibility path was introduced.
- **Focused:**
  `npm test -- tests/conversation-presentation-react.test.jsx --run -t 'TC-0554' --reporter=verbose`
  — **1 passed**.
- **Adjacent owner suite:**
  `npm test -- tests/conversation-presentation-react.test.jsx --run --reporter=verbose`
  — **1 passed, 0 failed**.
- **Adjacent reading/presentation suites:**
  `npm test -- tests/conversation-behavior-fuzz.test.js tests/reading-session-ports.test.js tests/view-session.test.js --run --reporter=dot`
  — **15 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. A suspended candidate for
  another view cannot rebase the committed presentation; the original view
  resumes with stable snapshot, entity, and revision identity. No product
  change or semantic weakening was required.
- **Final commit:** recorded below after this closeout and test-only tag.
