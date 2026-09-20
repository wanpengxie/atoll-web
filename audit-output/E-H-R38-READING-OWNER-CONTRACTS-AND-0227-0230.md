# E–H R38 reading owner contracts and next F7 access baselines

Date: 2026-09-20

Product candidate: clean detached `3847f8f`. The shared worktree advanced after
the R36 `19745da` verification, so the results below are from a fresh clean
candidate, not from a dirty product tree. No product file was edited for this
round.

Contract: [`docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/TEST-MIGRATION-EXECUTION-CONTRACT.md)

The three existing 0218–0220 browser cases remain separate strict contracts.
Each has one observable owner boundary; a neighboring owner is not accepted as
a substitute. The next unique old F7 access cases are independently restored
as 0227–0230 in
[`f7-history-access-baseline-0227-0230.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-access-baseline-0227-0230.spec.js).

## Current clean result matrix

| Case | Old action and observable | Current public owner contract | Clean `3847f8f` result |
|---|---|---|---|
| 0218 | Claude filter scans nonmatching physical pages; at least two `history.batch_complete`, no foreground history UI, then Claude rows | `channel-feed-runtime.loadHistory` is the sole physical batch-completion publisher; `useHistoryConsumer` only initiates `projection-underfill` | **RED**: `history.intent_started` and target rows exist, but `history.batch_complete` count is 0 |
| 0219 | Empty Claude filter first shows the old partial text, then definitive EOF; warm history remains quiet and geometry stable | `ConversationSurface` is the sole partial/settled empty-state presenter | **RED**: exact old partial text is absent; current product text is not substituted |
| 0220 | Committed under-filled viewport publishes coverage evidence and starts demand after real rows/boundaries are present | `useBrowsingReadingController` is the sole viewport-coverage admission owner | **RED**: no `history.viewport_underfilled` event; initial edge callback is not substituted |
| 0227 | Revoke active channel: no freshness `channel_meta`; grant later: exactly one fresh `channel_meta` and one successor socket | Access lifecycle is owned by `useWireSession` membership projection plus the feed runtime grant admission; the test observes only the public WebSocket contract | **RED**: grant-side `channel_meta` count is 0 |
| 0228 | Delayed initial pages, seed 1722, retain latest access activation and settle current tail | Same access/history activation owner, public DOM and diagnostics only | **PASS** |
| 0229 | Delayed initial pages, seed 1723, retain latest access activation and settle current tail | Same owner, independently executed | **PASS** |
| 0230 | Delayed initial pages, seed 1724, retain latest access activation and settle current tail | Same owner, independently executed | **PASS** |

## Strict owner contracts for 0218–0220

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1063,1103,1149`.
The current successor is
[`f7-history-water-baseline-0217-0221.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-history-water-baseline-0217-0221.spec.js).

### 0218 — `history.batch_complete` / feed batch owner

Capability: a user-visible Claude member filter silently reads through physical
history pages until semantic Claude supply is available. Invariants: the
request is anticipatory (`projection-underfill`), installed visible rows are
zero at start, no foreground history status or confirmation appears, at least
two physical pages complete, and the target Claude row becomes visible.

The sole completion owner is
[`channel-feed-runtime.js:914`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:914)
`loadHistory`: it executes the physical page and increments the authoritative
`completedPages` at line 1012. The public consumer entry at
[`useHistoryConsumer.js:678`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:678)
starts the demand but is not allowed to impersonate page completion. The test
keeps the old strict `history.batch_complete` observable at line 95 and also
checks the start detail, quiet UI, and target row. It does not count
`wire.page_end`, `cold_entry.snapshot`, or `history.intent_satisfied` as a
batch-complete substitute.

Clean evidence: the start event and target rows were present, but
`completed.length` was `0` (expected `>= 2`). The current runtime has no
`history.batch_complete` diagnostic publisher. This is a single feed-runtime
publication regression packet; no presentation or viewport change is proposed
here.

### 0219 — partial empty-state owner

Capability: an empty Claude filter communicates that the scan is still partial,
then communicates definitive EOF after the current member scope is exhausted.
Invariants: the old partial text is exact, definitive EOF is distinct, the
timeline remains the same surface, and neither foreground history UI nor
geometry movement is manufactured while warm history is quiet.

The sole presentation owner is
[`ConversationSurface.jsx:242`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:242),
which derives `emptyFeedbackKind` and renders partial/settled states at lines
321–328. The strict browser contract clicks the public Claude filter and keeps
the exact old partial assertion at line 109, the definitive assertion at line
110, and the rAF quiet/geometry checks through line 131. It does not accept
history demand status, a spinner, or the current replacement text as proof of
the old partial state.

Clean evidence: the first strict assertion could not find
`当前已加载的动态里没有符合筛选的往来`. This is a single
ConversationSurface presentation regression packet; feed completion and
viewport admission are not mixed into its closure.

### 0220 — viewport-coverage admission owner

Capability: after the real list is committed, a 5,000px under-filled viewport
causes one history demand without trusting an initial edge callback. Invariants:
the public list has rows, both physical boundaries, current attached history,
older supply, a positive client height, and bottom readiness before demand is
published.

The sole admission owner is
[`useBrowsingReadingController.js:121`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:121).
Its `viewport-coverage` branch is the only place that may publish
`history.viewport_underfilled`; it gates on rows, both boundaries, attached /
current status, `hasOlder`, and `bottomReady`, then consumes one underfill
demand. The strict browser contract keeps the exact event and detail checks at
lines 140–147 and separately requires a history intent. An initial edge
callback, cold snapshot, or list height alone is not accepted.

Clean evidence: no `history.viewport_underfilled` event arrived within the
strict wait. The cold snapshot showed the presentation handoff still empty, so
this is a single viewport-coverage admission regression packet, not a request
to alter the feed or empty-state owner.

## Next unique baseline: 0227–0230

Old source: `fae8b70:tests/browser/f7-history-water.spec.js:1489–1595`.
The successor uses the same public channel click, membership controls,
WebSocket frame observation, DOM rows, and diagnostic evidence. It does not
seed localStorage, inject actor filters, or call private exports.

- **0227 — RED / access lifecycle owner.** Capability: revoking the active
  channel sends no freshness `channel_meta`; a later membership grant opens one
  successor socket and sends exactly one fresh `channel_meta`. The strict test
  retains the old no-frame, socket-count, one-frame, and successor-socket
  observables. On clean `3847f8f`, revocation stayed quiet, but the grant-side
  frame count remained zero. First owner is the public access/grant lifecycle
  (`useWireSession` membership projection → feed runtime grant admission), not
  the timeline renderer.
- **0228 — PASS / direct.** Seed 1722 retains the latest access activation
  through delayed initial pages, exposes `c0.project history 119`, and settles
  at the current tail (`gap ≤ 24`). The old rAF row/ledger/mode/restore trace
  and the four diagnostic classes are attached independently.
- **0229 — PASS / direct.** Seed 1723 repeats the same old action and exact
  observable independently; no result is borrowed from 0228.
- **0230 — PASS / direct.** Seed 1724 repeats the same old action and exact
  observable independently; no result is borrowed from 0228/0229.

## Disposition

0218, 0219, and 0220 remain three explicit product regression packets with
single-owner boundaries. No cross-owner repair, renamed event substitution,
partial-state weakening, skip, deleted assertion, private export, or product
edit was used. The next unique access baseline packet is 3/4 PASS with 0227
returned to its access-lifecycle owner.
