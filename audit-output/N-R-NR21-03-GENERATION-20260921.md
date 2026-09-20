# NR21-03 roster attach-generation authority — 2026-09-21

## Contract

User capability: after a wire disconnect/reconnect, the current human identity
is hidden for the whole detached interval and is restored immediately from the
new attach membership. A late OBS result started by the old attach cannot
restore the old self or roster authority.

Invariant: `close` is a fail-stop boundary. It revokes the current roster
authority, fences scheduled/in-flight OBS refreshes, and clears the visible
self identity. `attach(generation, memberships)` creates one opaque token for
the new attach. `refresh`/`ensure` and OBS timer callbacks capture that token;
both the admission and post-OBS commit compare token identity and the current
Feed generation before writing.

Public owners: `useChannelRoster` owns roster/cache/self projection and the
attach token; `useWireConnection` is the only lifecycle adapter that calls
`roster.close()` for open/disconnected/reconnecting/closed and calls
`roster.attach()` on an attach receipt before `noteSelf`. `WorkspaceApp` does
not own the token or derive self identity.

## Old setup/action/result

The previous roster owner keyed refreshes by a local per-channel refresh
counter and React owner only. `close()` did not revoke `selves`, and Wire did
not close the roster on transport loss. A late `channelActors` result could
therefore repopulate the old projection, while `self()` fell back to cached
rows during reconnect. The prior public tests did not prove the entire
disconnect → detached → new attach sequence.

## Current evidence

1. `tests/roster.test.js` now starts a refresh under attach A, closes the
   roster, changes the Feed generation, resolves the old OBS promise, and
   asserts no authority/self write. It then issues attach B and proves only
   B's token can restore `human:root:new`.
2. `tests/world-change-reset.test.js` drives the public Wire session seam:
   reconnect closes roster authority; a new attach issues a token and passes
   it to `noteSelf`.
3. `tests/roster-self-from-attach.test.js` proves seed rows stay visible while
  identity is committed only through the attach-authorized port; cached rows
  cannot re-admit `我` before a current attach.
4. `tests/browser/nr21-roster-reconnect.spec.js` exercises the public DOM ten
   times: after each mock transport drop it observes `RECONNECTING` with zero
   `我` markers, then observes `OPEN` with exactly one marker after the new
   attach. It does not use mock call arrays as the identity oracle.

Focused unit command:

```text
node_modules/.bin/vitest run tests/roster.test.js tests/roster-self-from-attach.test.js tests/world-change-reset.test.js --reporter=verbose
```

Result: **22 passed**.

Browser repeat10:

```text
ATOLL_TEST_WEB_PORT=16695 ATOLL_TEST_MOCK_PORT=19995 node_modules/.bin/playwright test tests/browser/nr21-roster-reconnect.spec.js --reporter=line --workers=1
```

Result: **1 passed** (10 disconnect → reconnect cycles).

Required regression matrix: TC-0191/0195 **2 passed**, responsive **3
passed**, wire/server unit **20 passed**, and `npm run build` **passed**.

No product capability was removed, no private API was exported, and no second
roster store or compatibility path was introduced. The implementation remains
within the existing roster/Wire owners.
