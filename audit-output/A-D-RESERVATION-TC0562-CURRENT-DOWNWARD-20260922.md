# A–D reservation — TC-0562 / AD-268 current downward evidence

## Reservation

- **Case key:** `TC-0562` (A–D alias `AD-268`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:93`
- **Current declaration:** `tests/conversation-viewport.test.js:375` (the file retained the exact case after earlier public history and reading-control cases were inserted)
- **Baseline title:** `only current downward user evidence can resume following`
- **Current base:** `390fa3af9cc7e34c15f1e7e2b9197843376c6021`
- **Branch:** `unit-a-d/tc0562-current-downward-390fa3`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0562-current-downward-390fa3`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

Passive layout or tail observations must not take control away from a user who
is browsing older content. Following may resume only after a current downward
user gesture establishes a newer input epoch and a matching tail observation
arrives in that same epoch. The retained behavior therefore keeps the session
in `browsing` after an older gesture even when its tail observation says
`atTail`, then transitions to `following` only after the newer gesture and its
same-epoch tail evidence.

The public contract is the existing `takeReadingControl` plus
`observeReading` transition: begin an `older` user gesture, observe tail in
that epoch and assert browsing; begin a `newer` user gesture, observe tail with
the current epoch and assert following. No DOM oracle, private state, second
store, synthetic gesture, or compatibility API is introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0562` row for
`tests/conversation-viewport.test.js:93`; the historical inventory maps it to
`AD-268`. Exact searches for `TC-0562`, `TC0562`, `AD-268`, `AD268`, the
baseline title, the current declaration, and adjacent following-evidence text
found no reservation report, claim commit, branch, or worktree before this
reservation. TC-0560 covers one-shot bottom-intent consumption, TC-0561 covers
durable target correlation, and TC-0563 covers direction updates within one
epoch; those contracts are not reused here.

## Current public owner

The current public owner is the named reading-session model in
`src/model/reading-session.js`: `takeReadingControl` owns user direction and
input epochs, while `observeReading` admits following only when current
downward evidence matches the same epoch and geometry. The retained test
reaches these exported transitions through its existing local `session`
wrapper. No private hook/export or alternate scrolling authority is needed.

## File boundary and atomic claim

Only this report and the existing `tests/conversation-viewport.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.
