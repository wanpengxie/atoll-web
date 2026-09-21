# A–D reservation — TC-0560 / AD-266 bottom-intent epoch fence

## Reservation

- **Case key:** `TC-0560` (A–D alias `AD-266`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:56`
- **Current declaration:** `tests/conversation-viewport.test.js:338` (the file retained the exact case after earlier public history and reading-control cases were inserted)
- **Baseline title:** `consumes the one bottom intent only in its activation and input epoch`
- **Current base:** `357de99c273e1e9da1cd87e95eb20465b627e7a2`
- **Branch:** `unit-a-d/tc0560-bottom-intent-357de99`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0560-bottom-intent-357de99`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

An explicit return-to-bottom request is a one-shot user command. It may be
consumed only by the same reading activation and input epoch that created it;
a stale activation must not clear or execute the command. The public behavior
is that an explicit `latest` request carries its presentation revision and
tail identity, rejects an activation-mismatched consume attempt without
mutation, and consumes exactly once for the matching activation/epoch.

The retained contract exercises the current public
`requestLatest`/`consumeLatestIntent` transition. It verifies the bottom
intent remains bound to `afterPresentationRevision` and `baselineTailID`, a
stale activation returns the same session, and the matching activation clears
the one intent while preserving following mode. No DOM oracle, private state,
second store, or compatibility API is introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0560` row for
`tests/conversation-viewport.test.js:56`; the historical inventory maps it to
`AD-266`. Exact searches for `TC-0560`, `TC0560`, `AD-266`, `AD266`, the
baseline title, and the current declaration found no reservation report, claim
commit, branch, or worktree before this reservation. The adjacent native-input
cancellation is TC-0559/AD-265, while the later durable-target test is
TC-0561/AD-267; neither is reused here.

## Current public owner

The current public owner is the named reading-session model in
`src/model/reading-session.js`: `requestLatest` creates the typed bottom
intent and `consumeLatestIntent` is its epoch/activation-gated consumer. The
retained test reaches these exported model transitions through its local
`session` wrapper. No private hook/export, imperative navigation, alternate
store, or UI workaround is needed.

## File boundary and atomic claim

Only this report and the existing `tests/conversation-viewport.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.
