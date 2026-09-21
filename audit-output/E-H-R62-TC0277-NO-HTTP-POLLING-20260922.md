# E–H R62 — TC0277 no-HTTP-polling public successor

Date: 2026-09-22

Base: `c4906ca432ea9a25294a7e13f6a252b680273e6f` (`c4906ca`).

Scope: exactly one central 1,487-case ledger declaration: **TC-0277**,
`fae8b70:tests/browser/no-http-polling.spec.js:4`.  TC-0278 is the raw
`.test(...)` token at line 10, not a declaration and not counted.

## De-duplication / claim

TC-0244–TC-0276 were already represented by the existing
`BROWSER-G-M-FAE8B70-MIGRATION.md` case table (including TC-0250/0251 and the
model-selector cases); the raw-token rows TC-0249, TC-0254, TC-0256 and TC-0274
are excluded by the central ledger.  No other audit in `audit-output/` names
TC-0277 or the source declaration.  This report and the successor test claim
only TC-0277; no adjacent case is used as a pass surrogate.

## Contract and current public owner

| Field | Evidence |
|---|---|
| User capability | After a real login reaches the public WebSocket `OPEN` state and `c0.project` is visible, the workspace must not periodically re-read the whole channel tree or each channel's actor roster over HTTP. |
| Invariant | WebSocket/session state is the live channel transport.  `/obs/space/channels*` and `/obs/channel/*/actors` may be used for the initial committed observation, but a settled session must not restart those reads on a timer or hide polling behind UI rendering. |
| Current public owner | [`useWireSession.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/hooks/useWireSession.js:557) owns `loadChannelTree` and the attach-scoped space observation; [`useChannelRoster.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/hooks/useChannelRoster.js:170) owns channel actor observation.  The test observes their public HTTP request boundary, not a private timer or diagnostic export. |
| Old action | Reset `multi-channel` seed `1601`; listen for matching `/obs/space/channels*` and `/obs/channel/*/actors` requests; navigate to `/`; enter the public login form; wait for `OPEN` and visible `c0.project`; discard the initial one-second setup window; observe another 2.2 seconds. |
| Old observable | The settled observation request list is exactly empty.  A periodic tree/roster poll is a user-visible network/latency regression even if the rendered list looks unchanged. |
| Current successor | [`f7-no-http-polling-0277.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-no-http-polling-0277.spec.js:25) repeats the same reset, real login, `OPEN`/`c0.project` gate, one-second settling window, 2.2-second request window, and exact empty assertion.  It captures the initial and settled request paths as an attachment without changing the product or requiring a private oracle. |

## Verification

Command (detached worktree, `c4906ca`):

```text
ATOLL_TEST_WEB_PORT=17077 ATOLL_TEST_MOCK_PORT=26077 \
npx playwright test tests/browser/f7-no-http-polling-0277.spec.js \
  --repeat-each=3 --workers=1 --reporter=list \
  --output=/tmp/tc0277-current-c4906ca-r3
```

Result: **3 passed (21.0s)**.  All three repeats reached the public `OPEN`
and `c0.project` gates and the settled request array remained exactly empty.
No source, vendor, package, lockfile, skip, or compatibility path was added.
