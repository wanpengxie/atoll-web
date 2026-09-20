# S–Z Round 60 — AD037 reconnect editing owner proof (2026-09-21)

AD037 is now closed at the existing Waiting owner. The user capability is
that an edit session survives a reconnect and re-reads the latest committed
target without handing the hold to a replacement render callback.

| Contract | Public owner | Evidence | Result |
|---|---|---|---|
| Reconnect emits `agent.context` for the latest committed target. | `useWaitingEditingController` through the public `onTaskControl` port. | `tests/blocked-round20-public-owner.test.jsx` and `tests/blocked-round24-public-owner.test.jsx`, both with a distinct latest-target text. | PASS |
| The callback that acquired `agent.hold` remains the context owner. | `sessionOwnersRef` committed owner. | The tests rerender with callbacks B/C and assert `agent.context` only on callback A. | PASS |
| A stale render callback cannot take the hold or context path. | Waiting hook owner boundary. | B/C receive no `agent.context`; AD038 still separately proves latest committed replacement routing. | PASS |
| Context probes are bounded to owner/target changes. | Existing `sessionLatestOwnersRef` lifecycle. | The handoff marker is held in the existing session owner entry; no second store, compatibility path, or private export was added. | PASS |

Verification from the independent worktree based on `297540b`:

```text
npx vitest run tests/blocked-round20-public-owner.test.jsx -t 'AD-037' --reporter=verbose  PASS
npx vitest run tests/blocked-round24-public-owner.test.jsx tests/blocked-round26-public-owner.test.jsx tests/agent-information-architecture.test.jsx -t 'AD-037|AD-038|latest committed' --reporter=verbose  PASS
```

The product change is limited to `WaitingLayer`/`useWaitingEditingController`;
no Workspace, Reading, Outbox, vendor, package, lockfile, old API, or
compatibility implementation was changed.
