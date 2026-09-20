# E–H R40 reading re-verification and TC0230 bounded-history baseline

Date: 2026-09-20

Product candidate: clean detached `41cecab`. The shared worktree contained
unrelated in-progress changes, so all browser results below came from a fresh
detached worktree at this commit. No product file was edited. The only new
successor is
[`f7-history-huge-water-baseline.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-huge-water-baseline.spec.js).

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

## Current result matrix

| Case | Old public action and observable | Current public owner boundary | Clean `41cecab` result |
|---|---|---|---|
| 0218 | Click the visible Claude filter after delayed nonmatching pages; scan silently through physical pages until Claude rows appear | `channel-feed-runtime.loadHistory` owns physical page completion; `useHistoryConsumer` owns the demand start, not page-completion evidence | **RED** — target Claude row and anticipatory start were present, but strict `history.batch_complete` count was `0` (required `>=2`) |
| 0219 | Click an empty Claude filter while warm history scans; show the exact old partial text, then exact EOF, with quiet/stable list | `ConversationSurface` owns partial/settled empty-state presentation | **RED** — exact old partial text `当前已加载的动态里没有符合筛选的往来` was absent; no replacement text was accepted |
| 0220 | Enter a committed `1280×5000` under-filled viewport; publish coverage admission, then one history intent | `useBrowsingReadingController` owns the committed `viewport-coverage` admission branch | **RED** — no `history.viewport_underfilled` event arrived within the unchanged strict wait |
| 0227 | Revoke active `c0.project`, then grant membership; send no revoked freshness frame and exactly one grant `channel_meta` | Feed runtime grant admission owns the refresh frame; WebSocket observation is the public contract | **RED** — revoked frame count stayed `0`, but grant-side `channel_meta` stayed `0` (required `1`) |
| 0230 (FAE-1618) | Reset huge history, observe latest row, perform exactly one upward wheel, reveal older history while DOM stays bounded | Reading demand/receipt is owned by `useHistoryConsumer`; physical bounded window is rendered by `VendorListExecutor`/Virtuoso; feed `loadHistory` supplies rows | **PASS** — strict old action and all observables passed three independent repeats |

Cases 0218, 0219, 0220, and 0227 remain separate regression packets. TC0230
is not merged with them: it uses a different fixture, gesture, receipt, and
bounded-rendering invariant. The neighboring old mobile-realtime case
(`fae8b70:tests/browser/f7-history-water.spec.js:1597`, ledger TC-0229) is
also not counted as TC0230.

## Verification commands and evidence

The four existing strict cases were run together with one worker:

```text
ATOLL_TEST_WEB_PORT=16730 ATOLL_TEST_MOCK_PORT=20130 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  tests/browser/f7-history-access-baseline-0227-0230.spec.js \
  --grep='TC0218|TC0219|TC0220|TC0227' --reporter=line --workers=1
```

Result: `4 failed`.

The next unique old baseline was restored as FAE-1618 (static ledger TC-0230)
and run on its own:

```text
ATOLL_TEST_WEB_PORT=16731 ATOLL_TEST_MOCK_PORT=20131 npx playwright test \
  tests/browser/f7-history-huge-water-baseline.spec.js \
  --reporter=line --workers=1
```

Result: `1 passed (6.5s)`. A repeat run used `--repeat-each=3`, resetting the
same public `huge-history/1709` fixture before each repetition, and returned
`3 passed (16.2s)`. The test uses only public login, the
mock scenario reset, the public timeline region, a native wheel, DOM row
counts, and the existing diagnostics receipt; it does not use private exports,
storage injection, a synthetic viewport command, or a second gesture.

## Case-level proof

### 0218 — physical page completion remains one feed owner

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1063`.

User capability: selecting Claude must continue reading nonmatching physical
history pages without turning the background scan into foreground UI, until a
semantic Claude row is available. Invariants are independent: the
`projection-underfill` intent is anticipatory with zero installed visible rows;
at least two physical pages complete; no foreground history/confirmation UI is
shown; and `target claude question 2` becomes visible.

Current public owner: [`channel-feed-runtime.js:950`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:950)
`loadHistory` executes the physical page and increments authoritative
`completedPages` at
[`channel-feed-runtime.js:1048`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1048).
[`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435)
only publishes the public demand start, and its settling event cannot stand in
for physical page completion. The unchanged browser contract therefore does
not count `wire.page_end`, `completedPages` in a cold snapshot, or
`history.intent_satisfied` as `history.batch_complete`.

Clean evidence: the target row and anticipatory start were present, but the
strict completion count was `0`. This is one feed-runtime evidence/public-owner
regression packet; no presentation or viewport repair is proposed here.

### 0219 — partial and settled empty state remain one presentation owner

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1103`.

User capability: an empty Claude filter tells the user that the currently
loaded range has no match while the scan is still in progress, then changes to
the exact definitive EOF state only after the scan reaches the channel start.
The invariant includes exact old partial and settled text, unchanged list
geometry, and no foreground history/confirmation UI during the warm scan.

Current public owner: [`ConversationSurface.jsx:242`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:242)
derives the empty state; its partial/settled render branches are at
[`ConversationSurface.jsx:317`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:317)
through line 328. A demand status or the current replacement wording is not a
partial-state substitute.

Clean evidence: the unchanged strict locator for
`当前已加载的动态里没有符合筛选的往来` timed out; the test preserved the
original assertion and attached owner evidence in its `finally` block. This is
one presentation packet, not a request to change feed completion.

### 0220 — committed viewport coverage has one admission owner

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1149`.

User capability: once a real list is committed into a very tall viewport, the
surface can recognize under-filled coverage and begin history demand. The
invariant is admission-only: rows, both boundaries, current attachment,
`hasOlder`, positive geometry, and bottom readiness must all be true before the
event; an initial edge callback or a cold snapshot is not enough.

Current public owner: [`useBrowsingReadingController.js:121`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121)
gates the committed `viewport-coverage` branch and publishes the event at
[`useBrowsingReadingController.js:133`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:133).
The test captures public precondition evidence immediately after login, then
keeps the exact event detail and one-intent assertions.

Clean evidence: no `history.viewport_underfilled` event arrived. This returns
the regression to the one admission owner; no feed or empty-state behavior is
used as a substitute.

### 0227 — grant refresh has one access/feed owner boundary

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1489`.

User capability: revocation must not send a freshness request for an
unauthorized channel; a later grant must open one successor transport and send
one fresh `channel_meta` for the granted channel. Invariants are exact frame
counts plus socket successor count, not merely a visible timeline.

Current public owner: [`channel-feed-runtime.js:1180`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1180)
`refreshChannel` admits the frame only when grant, generation, attachment, and
wire are current; [`useWireSession`'s existing public projection](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/hooks/useWireSession.js:1)
is not treated as a second frame publisher. The browser test observes only
public WebSocket frames and the visible access state.

Clean evidence: revocation emitted no `channel_meta` as required, but the
strict grant-side frame count remained `0` instead of `1`. This is one grant
admission/refresh packet; no timeline or compatibility repair is proposed.

### TC0230 — 100k history remains bounded through one public demand

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1618`.

User capability: a user opening the 100k-style ledger sees the latest visible
row quickly; one upward wheel requests older history; the older-history demand
settles without requiring a second gesture; and the production DOM remains a
bounded virtual window.

Invariants retained independently: exact latest row
`c0 history 14286: ask steward for PONG` is visible before the gesture;
`.timeline-virtual-item` count is `<100` before and after; exactly one physical
wheel is sent; public `history.intent_started` is observed; and public
`history.intent_satisfied` is observed within 5 seconds. The current test does
not infer success from row count alone.

Current public owner path: the timeline surface is rendered by
[`VendorListExecutor.jsx:1234`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:1234)
with the public Virtuoso data/row window and native scroller. Its existing
reading demand delegates to
[`useHistoryConsumer.js:435`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:435)
for the start receipt and settles at
[`useHistoryConsumer.js:495`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:495).
The feed's [`loadHistory`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:950)
is only the row supplier. These are the existing public owner boundaries in
one test; no hidden API or merged sibling case is used.

The FAE-1618/TC-0230 baseline passed once and passed again in all three
`--repeat-each=3` runs. This is an **ACCEPT / direct** baseline proof. It does not close the
separate TC0229 mobile-realtime case or the warm-cache/lagged-cache cases
TC0231–TC0233.

## Disposition

0218, 0219, 0220, and 0227 remain explicit RED product regression packets,
each with its original action and strict observable intact. TC0230 is now a
strict PASS with repeat-3 evidence. No skip, deleted assertion, weakened
fixture, private export, legacy API, storage injection, cross-owner repair, or
product edit was used.
