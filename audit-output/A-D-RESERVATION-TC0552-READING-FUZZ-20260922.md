# A–D reservation — TC-0552 / AD-258 reading-intent fuzz

## Reservation

- **Case key:** `TC-0552` (A–D alias `AD-258`)
- **Baseline:** `fae8b70:tests/conversation-behavior-fuzz.test.js:30`
- **Baseline title:** `keeps data/layout events powerless over reading intent and keeps semantic rows unique`
- **Current base:** `be18ef084676c91c58780b5d65a45190efb618b1`
- **Branch:** `unit-a-d/tc0552-reading-fuzz-be18ef0`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0552-reading-fuzz-be18ef0`
- **Allowed change:** this report and the existing declaration in `tests/conversation-behavior-fuzz.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

While a user browses a conversation, incoming data and layout changes must not
silently change reading intent, while the rendered semantic rows remain
one-to-one with their durable identities. The existing 400-run property test
exercises prepend, append, layout-tail, upward user input, downward tail input,
latest requests, and stale/latest-intent consumption. Its invariants are
strict: data/layout events preserve `reading.mode` and `inputEpoch`; explicit
user gestures alone change browsing/following; stale intent consumption is a
no-op; and every committed presentation has unique ordered row IDs whose rows
resolve to the same entity objects.

## Exact uniqueness precheck

The central migration ledger has one `TC-0552` row for
`tests/conversation-behavior-fuzz.test.js:30`; the historical inventory maps it
to `AD-258`. Exact searches for `TC-0552`, `TC0552`, `AD-258`, `AD258`, the
baseline title, and the declaration found no reservation report, claim
commit, branch, or worktree before this reservation. TC-0550/0551 remain
blocked path-absent control-state baselines and are not substituted here.

This case is distinct from TC-0553's A→B→A stale-save authority and from the
later conversation-presentation and viewport cases. It covers only the
data/layout-versus-user-intent boundary plus semantic row uniqueness under the
existing deterministic fast-check event model; it does not claim browser DOM
behavior, a second reading store, or a new navigation mechanism.

## Current public owner

The current public owners are `createReadingSession` and its named reading
controls (`observeReading`, `takeReadingControl`, `requestLatest`, and
`consumeLatestIntent`) in `src/model/reading-session.js`, composed with the
named `createConversationPresentation` owner in
`src/model/conversation-presentation.js`. The existing test calls these public
constructors and methods directly; no private hook/export, DOM diagnostic, or
alternate authority is introduced. Its event generator, 400-run bound,
projection commit, and every mode/epoch/row/entity assertion remain unchanged;
migration adds only the case tag.

## File boundary and atomic claim

Only this report and the existing `tests/conversation-behavior-fuzz.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.

## Closeout — 2026-09-22

- **Reservation commit:** `6a5779b` (`claim TC0552 reading intent fuzz
  baseline`).
- **Migration:** the existing declaration is tagged
  `[TC-0552][AD-258]`; its event generator, 400-run property, public reading
  controls, projection commits, mode/epoch assertions, and row/entity
  uniqueness checks remain unchanged. No test was deleted/skipped and no
  private oracle or second store was introduced.
- **Focused:**
  `npm test -- tests/conversation-behavior-fuzz.test.js --run -t 'TC-0552' --reporter=verbose`
  — **1 passed, 1 selection skip**; the skip is Vitest selection output, not a
  skipped declaration.
- **Adjacent owner suite:**
  `npm test -- tests/conversation-behavior-fuzz.test.js --run --reporter=verbose`
  — **2 passed, 0 failed**.
- **Adjacent owner suites:**
  `npm test -- tests/reading-session-ports.test.js tests/view-session.test.js tests/conversation-presentation-react.test.jsx --run --reporter=dot`
  — **14 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. Across the deterministic
  event model, only explicit user evidence changes reading intent, stale
  latest consumption is fenced, and presentation rows remain uniquely and
  consistently identified. No product change or semantic weakening was
  required.
- **Final commit:** recorded below after this closeout and test-only tag.
