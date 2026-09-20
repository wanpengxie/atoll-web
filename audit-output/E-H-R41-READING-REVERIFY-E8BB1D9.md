# E–H R41 reading re-verification on `e8bb1d9`

Date: 2026-09-20

Product candidate: clean detached `e8bb1d9`. No product file was edited. This
round only strengthens public evidence in the existing browser successors:

- [`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js)
- [`f7-history-access-baseline-0227-0230.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-access-baseline-0227-0230.spec.js)

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

## Result matrix

| Case | Old capability and strict observable | Current public owner | Clean `e8bb1d9` result |
|---|---|---|---|
| 0218 | Claude filter silently scans nonmatching physical pages; anticipatory demand, ≥2 physical completions, no foreground UI, target row visible | `channel-feed-runtime.loadHistory` owns page completion; `useHistoryConsumer` starts demand | **RED**, target/start present but `history.batch_complete` is `0` (required ≥2) |
| 0219 | Empty Claude filter shows exact partial text, then exact EOF; quiet UI and unchanged list geometry | `ConversationSurface` owns partial/settled presentation; the existing list geometry is also a strict user observable | **REJECT / not closed**: partial, EOF, quietness, and 12 stable final samples pass, but geometry changes from `1016×487` to `1016×48.609375` |
| 0220 | Committed under-filled viewport admits demand only after rows/boundaries/current attachment/older supply/bottom readiness | `useBrowsingReadingController` owns `viewport-coverage` admission | **RED**, no `history.viewport_underfilled` event |
| 0227 | Revoke emits no freshness frame; grant emits exactly one `channel_meta` and one successor socket | `channel-feed-runtime.refreshChannel` plus existing access/grant lifecycle | **PASS**, exact grant frame count remained one through a 750ms settling window; repeat-3 passed |

0219's restored copy is real progress, but the old geometry invariant is not
optional. The test therefore does not promote it to PASS or hide the failing
sub-observable. No current replacement wording, screenshot, or successful EOF
is used to substitute for stable list geometry.

## Commands and results

The four cases were run together from the clean detached candidate:

```text
ATOLL_TEST_WEB_PORT=16744 ATOLL_TEST_MOCK_PORT=20144 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  tests/browser/f7-history-access-baseline-0227-0230.spec.js \
  --grep='TC0218|TC0219|TC0220|TC0227' --reporter=line --workers=1
```

Result: `3 failed, 1 passed (44.9s)` — 0218/0219/0220 failed at their
unchanged strict first boundary; 0227 passed.

0227 was independently repeated:

```text
ATOLL_TEST_WEB_PORT=16743 ATOLL_TEST_MOCK_PORT=20143 npx playwright test \
  tests/browser/f7-history-access-baseline-0227-0230.spec.js \
  --grep='TC0227' --repeat-each=3 --reporter=line --workers=1
```

Result: `3 passed (25.8s)`.

0219 was independently repeated:

```text
ATOLL_TEST_WEB_PORT=16745 ATOLL_TEST_MOCK_PORT=20145 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  --grep='TC0219' --repeat-each=3 --reporter=line --workers=1
```

Result: `3 failed`; every repetition failed only the unchanged geometry
comparison after the partial and definitive text states had been observed.

## Case proof

### 0218 — still RED at the feed completion owner

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1063`.

User capability: a visible Claude member filter can read through nonmatching
physical history pages until semantic Claude supply appears without making the
background scan foreground work. The strict invariants remain independent:
`history.intent_started` has `reason=projection-underfill`,
`urgency=anticipatory`, zero installed visible rows, and one actor filter;
there are at least two `history.batch_complete` events; no foreground or
confirmation UI appears; and `target claude question 2` is visible.

The public page-completion owner is
[`channel-feed-runtime.js:950`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:950)
`loadHistory`, which increments its authoritative page counter at
[`channel-feed-runtime.js:1048`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1048).
[`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435)
is only the demand initiator. The clean run still had target/start evidence,
but `history.batch_complete.length === 0`; a cold snapshot's
`completedPages: 4` is not accepted as the missing public event.

### 0219 — partial/EOF fixed, geometry remains a strict RED

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1103`.

User capability: after clicking the public Claude filter on a warm delayed
history, the user must see the exact old partial notice while scanning, then
the exact EOF notice once the channel start is reached. The invariant also
requires no foreground/confirmation status and no list geometry jump across
that transition.

The presentation owner is
[`ConversationSurface.jsx:242`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:242),
with exact partial rendering at
[`ConversationSurface.jsx:325`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:325)
and settled rendering at line 317. The test keeps the old exact text and EOF
assertions. It now also attaches `beforeRect` beside the 12 public final
samples so the geometry failure is directly auditable.

Evidence on clean `e8bb1d9`, repeated three times:

- exact partial text visible;
- exact definitive EOF visible;
- all 12 final samples: `partial=false`, `definitive=true`, `foreground=false`,
  `confirming=false`;
- before filter: `{ width: 1016, height: 487 }`;
- after EOF: `{ width: 1016, height: 48.609375 }`.

The first four facts do not cover the fifth. The unchanged strict geometry
assertion therefore remains RED, and 0219 is not closed. This is a single
presentation/layout regression packet; no test weakening or product edit was
made.

### 0220 — still RED at viewport-coverage admission

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1149`.

User capability: a real committed, under-filled viewport starts history demand
only after rows, both boundaries, current attachment, older supply, positive
geometry, and bottom readiness are true. The first public evidence must be
`history.viewport_underfilled`, followed by one intent.

The sole admission owner is
[`useBrowsingReadingController.js:121`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121),
which publishes the event at
[`useBrowsingReadingController.js:133`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:133).
The clean run received no such event within the unchanged 10-second wait.
Initial edge callbacks, nonzero dimensions, and cold snapshots remain invalid
substitutes.

### 0227 — exactly one grant frame, not mere existence

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1489`.

User capability: revocation must produce no unauthorized freshness request; a
later grant must produce one successor socket and exactly one grant-side
`channel_meta` frame. The test observes public WebSocket frames and socket
counts only.

The feed refresh owner is
[`channel-feed-runtime.js:1180`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1180),
whose admission checks grant, generation, attachment, and current wire before
calling `channelMeta`. The existing access owner invokes that refresh after
grant through
[`useWireSession.js:799`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/hooks/useWireSession.js:799).

The browser contract first waits for count `1`, then keeps the grant phase
quiet for 750ms and requires the final public count to still be exactly `1`.
The lifecycle evidence attachment is captured after that settling check. All
three independent repetitions had zero revoked frames, one successor socket,
and exactly one grant frame. This is ACCEPT / direct.

## Disposition

0218 and 0220 remain strict RED packets. 0227 is ACCEPT / direct with a
stability-window exactly-one proof. 0219's old text/EOF behavior is restored,
but its unchanged geometry invariant is a repeatable RED and must remain open;
closing it would weaken the old observable. Only tests and this audit were
changed.
