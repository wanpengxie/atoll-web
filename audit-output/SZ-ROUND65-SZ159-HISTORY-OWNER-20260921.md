# SZ-159 history owner contract

Date: 2026-09-21. Base: `95314ea76f3e9556632e83e31c305b6739a30de6`.

## Decision

**GREEN / current public-owner proof.** The user capability is that a history
request which was started by the committed Reading view cannot borrow status or
EOF facts from a render candidate that React suspends and discards. A later
committed frame may replace the request port, but the late result remains
bounded by the current committed history obligation; it cannot route work to
the suspended candidate's request port.

## Owner and first breakpoint

The single owner is the public Reading projection chain:

`useConversationProjection` → `useHistoryConsumer` → `viewport.onNearTop()` /
`viewport.status`.

The adjacent `history-presentation-admission` object is only the presentation
admission boundary; it is not a second history cursor or status owner.

The former evidence gap was the absence of a public composition case covering a
late promise after a suspended candidate render. Existing local owner-token
tests did not prove that the candidate's `hasOlder`/EOF status could not be
selected by the committed request promise.

## Public scenario and assertions

`tests/sz159-history-owner-suspense.test.jsx` runs the real
`useConversationProjection` and `useHistoryConsumer` chain. It starts one
anticipatory `onNearTop()` request from committed owner A, then schedules a
candidate B with `hasOlder: false` in a React transition. B reaches the hook
render and suspends before commit; the committed owner remains A. A replacement
frame with `hasOlder: true` then commits through the same public port. Resolving
the original request as `exhausted` must not use B's status: the replacement
port is terminal-deduplicated, and neither the replacement request port nor B's
candidate request port is called. The test observes only public viewport
status/action behavior and the rendered candidate attempt; it does not inspect
refs, private stores, or helper exports.

Focused verification:

```text
npx vitest run tests/sz159-history-owner-suspense.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       1 passed
```

No product source, backend/protocol, vendor/package/lockfile, compatibility
path, second cursor/store, or old test was changed.
