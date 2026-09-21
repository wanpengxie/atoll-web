# Browser G–M case 7 / TC-0251 CAS

Date: 2026-09-22<br>
Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`)<br>
Current base: `c4906ca432ea9a25294a7e13f6a252b680273e6f` (`c4906ca`)<br>
Scope: one browser contract only — `history-start-boundary.spec.js:89` / TC-0251.

## Atomic uniqueness claim

The unique `audit-output/TEST-CASE-MIGRATION-LEDGER.md` contains TC-0251 as:

```text
fae8b70:tests/browser/history-start-boundary.spec.js:233
target a8c9165: path absent; blocked pending product decision
```

The preceding G–M CAS report closes only TC-0250 at
`history-start-boundary.spec.js:62`; it explicitly leaves TC-0251 (the second
contract in that file) unclaimed. No current report or successor audit claims
this declaration. This commit therefore claims exactly one previously
uncredited ledger declaration.

## User-visible contract

On the real `/` AppShell, after login and the `deep-history` scenario:

1. Three trusted upward wheel gestures move the reader into the older-history
   runway. A final trusted upward gesture crosses the open frontier and the
   public list grows (`scrollHeight` increases); the first materialized row ID
   changes, proving that an older page was admitted rather than merely repainting
   the same rows.
2. The same visible row selected immediately before that prepend remains
   connected, retains its presentation identity and height, and does not move
   upward by more than 2px (`after.top - before.top >= -2`). Positive movement
   is allowed because it is the direct result of the user's upward gesture;
   the forbidden behavior is transferring the history-boundary geometry into
   the retained row as a reverse jump.
3. The active list contains no duplicate history-boundary element.

All completion gates above use the production DOM, element identity, geometry,
text/row presentation, `scrollHeight`, and real Chromium wheel input. The mock
reset only selects the documented scenario. No cache snapshot, private
diagnostic, test-only product export, alternate list owner, source/vendor
change, package/lockfile change, fixture rewrite, skip, or weakened assertion
is used.

## Current successor hardening

The existing G–M successor had the right row-identity/height intent but moved
the reader by one large wheel from a tail-reset state and did not prove that an
older page had actually been admitted or that the retained row's screen
position stayed on the non-negative side of the old contract. The successor in
this commit keeps the same production path and scenario, then:

- drives the list with three real wheel bursts before the final frontier
  crossing;
- waits on public `scrollTop`/`scrollHeight` changes, not a private scheduler
  event or fixed readiness sleep;
- records the first fully visible `[data-presentation-row-id]` before the
  crossing and checks that exact ID after it;
- asserts public progress, connected identity, height, signed top movement,
  and boundary count.

The test does not inspect `window.__ATOLL_DIAGNOSTICS__`, cache state, request
IDs, or internal history/consumer state.

## Exact Chromium evidence

Clean detached worktree:

```text
worktree: /tmp/gm-case7-c4906ca
base:     c4906ca432ea9a25294a7e13f6a252b680273e6f
ports:    ATOLL_TEST_MOCK_PORT=26080 ATOLL_TEST_WEB_PORT=17080
```

Command:

```text
ATOLL_TEST_MOCK_PORT=26080 ATOLL_TEST_WEB_PORT=17080 \
npx playwright test tests/browser/history-start-boundary.spec.js \
  --grep='an open history frontier prepends without moving the existing row geometry' \
  --repeat-each=5 --workers=1 --reporter=line \
  --output=/tmp/gm-case7-c4906ca-strong-r5
```

Result:

```text
5 passed (34.0s)
```

Adjacent same-file smoke (the TC-0250 boundary contract plus TC-0251):

```text
ATOLL_TEST_MOCK_PORT=26081 ATOLL_TEST_WEB_PORT=17081 \
npx playwright test tests/browser/history-start-boundary.spec.js \
  --workers=1 --reporter=line \
  --output=/tmp/gm-case7-c4906ca-adjacent
```

Result: `2 passed (14.8s)`.

The committed test/audit revision was then rerun from the detached worktree:

```text
commit:   9e37a51 (test/audit only)
ports:    ATOLL_TEST_MOCK_PORT=26082 ATOLL_TEST_WEB_PORT=17082
command:  npx playwright test tests/browser/history-start-boundary.spec.js \
            --grep='an open history frontier prepends without moving the existing row geometry' \
            --repeat-each=3 --workers=1 --reporter=line \
            --output=/tmp/gm-case7-9e37a51-final-r3
result:   3 passed (22.2s)
```

The commit is test/audit-only; no product, vendor, package, or fixture source
was changed.
