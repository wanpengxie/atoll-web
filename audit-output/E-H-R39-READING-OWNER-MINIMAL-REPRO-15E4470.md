# E–H R39 single-owner minimum reproductions

Date: 2026-09-20

Clean product candidate: `15e4470`. The reproductions below use fresh detached
Chromium worktree runs and only public UI, mock control actions, DOM, and
diagnostic/WebSocket observations. No product file was changed.

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

Tests:

- [`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js)
- [`f7-history-access-baseline-0227-0230.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-access-baseline-0227-0230.spec.js)

## Minimal reproduction matrix

| Case | Public setup/action | Strict owner observable | Result on clean `15e4470` |
|---|---|---|---|
| 0218 | Reset `deep-history-delayed/1738`, publish dense nonmatching pages plus two Claude rows, click the visible Claude filter | `history.intent_started` is anticipatory, then the feed owner publishes at least two `history.batch_complete`; no foreground/confirmation UI and target row is visible | **RED**: target row/start are present, `history.batch_complete` is `0` |
| 0219 | Reset `deep-history-delayed/1737`, login, click the visible Claude filter | `ConversationSurface` first presents exact old partial text, then exact definitive EOF; list geometry and quietness remain stable | **RED**: exact old partial text is not visible; current replacement is not accepted |
| 0220 | Set viewport to `1280×5000`, reset `deep-history/1720`, login | `useBrowsingReadingController` publishes `history.viewport_underfilled` only for a committed rows/boundaries/attached/older/bottom-ready viewport, then one history intent | **RED**: event is absent |
| 0227 | Reset `deep-history/1717`, open `c0.project`, revoke then grant membership | `channel-feed-runtime.refreshChannel` sends no revoked `channel_meta`, then exactly one grant-side `channel_meta` and one successor socket | **RED**: grant-side frame count is `0` |

The 0218–0220 run was:

```text
ATOLL_TEST_WEB_PORT=16722 ATOLL_TEST_MOCK_PORT=20122 npx playwright test \
  tests/browser/f7-history-water-baseline-0217-0221.spec.js \
  --grep='TC0218|TC0219|TC0220' --reporter=line --workers=1
```

The 0227 run was:

```text
ATOLL_TEST_WEB_PORT=16723 ATOLL_TEST_MOCK_PORT=20123 npx playwright test \
  tests/browser/f7-history-access-baseline-0227-0230.spec.js \
  --grep='TC0227' --reporter=line --workers=1
```

## 0218 — one feed batch-completion owner

Old baseline: `fae8b70:tests/browser/f7-history-water.spec.js:1063`.

Capability: a public Claude member filter continues through nonmatching
physical history pages until semantic Claude supply is materialized. The strict
invariants are: `projection-underfill` is anticipatory with zero installed
visible rows; at least two physical pages complete; no foreground history
status/confirmation is shown; and `target claude question 2` is visible.

The single completion owner is
[`channel-feed-runtime.js:914`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:914)
`loadHistory`: it executes the physical batch and increments `completedPages`
at line 1012. [`useHistoryConsumer.js:678`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:678)
is only the public demand initiator. The test retains the exact
`history.batch_complete` requirement at lines 98–100 and deliberately does not
count `wire.page_end`, `history.intent_satisfied`, or a cold snapshot as
completion.

Clean result: `history.intent_started` matched the old anticipatory detail and
the target row appeared, but `completed.length` was `0` (required `>= 2`). This
is a feed-runtime publication regression packet. No presentation or viewport
owner is needed to reproduce it.

## 0219 — one partial/settled presentation owner

Old baseline: `fae8b70:tests/browser/f7-history-water.spec.js:1103`.

Capability: an empty Claude filter must first show the exact old partial state,
then the exact definitive EOF after the scan reaches the channel boundary. The
list must remain the same geometry and must not show foreground history or
confirmation UI while the scan is warm.

The single owner is
[`ConversationSurface.jsx:242`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:242),
which derives the empty kind and renders partial/settled states at lines
321–328. The test now captures `filter-claude-partial-owner.json` in a
`finally` block around the original strict wait, then strictly asserts the old
text at line 117;
it still requires the definitive message and the twelve quiet/geometry samples
when that first assertion passes. No demand spinner, current replacement text,
or feed diagnostic can satisfy the partial contract.

Clean result: `partialVisible` was `false`; the exact old text
`当前已加载的动态里没有符合筛选的往来` was absent. This is a
single ConversationSurface presentation regression packet.

## 0220 — one viewport-coverage admission owner

Old baseline: `fae8b70:tests/browser/f7-history-water.spec.js:1149`.

Capability: a real committed under-filled viewport begins history demand only
after the list has rows, both boundaries, current attached history, older
supply, positive geometry, and bottom readiness. The first public observable is
`history.viewport_underfilled`, followed by a history intent.

The single owner is
[`useBrowsingReadingController.js:121`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121).
The `viewport-coverage` branch gates those preconditions and publishes the
event at lines 133–147. The test captures `viewport-coverage-owner.json`
immediately after login, then keeps the exact event/detail assertion at line
185. An initial edge callback, cold snapshot, nonzero height, or demand status
is not a substitute.

Clean result: no `history.viewport_underfilled` event arrived. The evidence
therefore returns to this one admission owner; no feed or empty-state repair is
proposed.

## 0227 — one grant refresh owner

Old baseline: `fae8b70:tests/browser/f7-history-water.spec.js:1489`.

Capability: revoking the active channel sends no freshness request; a later
membership grant opens exactly one successor socket and sends exactly one
fresh `channel_meta` for `c0.project`.

The frame owner is
[`channel-feed-runtime.js:1162`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1162)
`refreshChannel`, which calls the public wire `channelMeta` port only when the
current grant/generation/attachment predicate is admitted. `useWireSession`
projects membership/access facts, but it is not treated as a second frame
publisher. The strict test observes public WebSocket frames and socket counts;
it does not invoke `refreshChannel` or any private export. The lifecycle
attachment is now captured in a `finally` block before the strict grant count
assertion, so a missing frame cannot hide its evidence behind a timeout.

Clean result: revocation had zero `channel_meta` frames as required, but after
grant the strict frame count stayed `0` instead of `1`. This is a single
`refreshChannel`/grant-admission regression packet.

## Disposition

All four cases remain explicit RED packets with their old actions and
observables intact. The tests add only owner-specific evidence capture and
comments; they do not relax assertions, skip cases, inject storage, restore a
legacy API, or modify product code.
