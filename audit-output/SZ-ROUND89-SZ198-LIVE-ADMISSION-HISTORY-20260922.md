# SZ-198 — stale live-admission cannot block current history

Date: 2026-09-22

## Claim and owner

- Baseline: `SZ-198`, the old `timeline-reading-integration` case whose user
  capability is that a live-admission transaction from an old activation or
  generation cannot block a history request for the current Reading surface.
- Current public owner: `useConversationProjection → useHistoryConsumer`;
  `history.request` is the acquisition port and the viewport status is the
  observable current authority. No scheduler/storage implementation is used
  as an oracle.
- Current base: `d73b724a3e22ca496915de9c7db2daa42a3064af`.
- Unique check: current refs contain no SZ-198 successor, test, or audit;
  SZ-197 covers zero-row admission handoff and SZ-199 covers sparse-filter
  exhaustion, so neither proves this stale-owner boundary.

## Contract

For a current generation `7`, a pending admission token is not addressable
when either its activation identity is retired or its epoch is `channel:6`.
The current public owner must still issue exactly one typed
`projection-underfill` request (`urgency: anticipatory`) against the current
history source. The current viewport remains at generation `7` with
`messageCurrent=true` and `hasOlder=true`.

The test exercises both stale tuples:

1. retired activation + current generation epoch;
2. current activation + retired generation epoch.

Assertions use only `viewport.activationID/status`, the public
`presentationAdmission.snapshot()` boundary, and the typed `history.request`
port. No private hook ref, scheduler state, storage field, or diagnostic dump
is asserted.

## Verification

Focused command:

```text
npx vitest run tests/sz198-live-admission-history-public-owner.test.jsx --reporter=dot
```

Result: 1 file, 2 tests passed. Product files are unchanged; this is a
test/audit-only closure for the current public owner.
