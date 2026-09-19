# AD-348 targeted restart contract (2026-09-20)

This packet maps the baseline `dynamic-f3.test.jsx:449` contract to the
current public owner. It changes no product code and does not restore the old
AppShell forwarding path, an Agent self-restart path, or a second command
store.

## Baseline and selected owner

| Contract | Baseline expectation | Current public owner | Evidence |
|---|---|---|---|
| AD-348 | `/restart` remains a public command, is sent to the channel system actor, and names the selected Agent | Composer command model/port mounted by `WorkspaceApp` | `tests/composer-command-port.test.js` |

The one canonical request is:

```text
/restart
  -> msgType: system.member.restart
  -> audience: [system]
  -> payload: { member: <selected Agent id> }
  -> submission.control
  -> wire submission
```

`system.member.restart` is the targeted backend operation. The current mock
governance test also proves the exact payload contract and backend guards: a
legacy `actor_id` field is rejected and protected `system` is rejected.

## Contract coverage

The focused command-port tests cover:

- public `/restart` mapping and exact selected-member identity;
- handoff to the canonical `createControlCommand`/`submission.control` shape;
- member/transport unavailability as disabled `offline`, rather than a fake
  success;
- missing target as disabled `no-target` with
  `composer_command_no-target`;
- `rejected` and `uncertain` outcomes remaining visible as retryable pending
  facts;
- absence of a fabricated `/restart_all` command.

The runtime submission owner continues to perform the current access
re-check before enqueueing. No `deviceActionsRef`, compatibility mirror, or
second restart owner is involved.

## Explicit unavailable boundary: node update

AD-202 and AD-203 remain `BLOCKED`. The current production tree has no
node-update owner, authenticated current-node endpoint client, six-hour
check, reconnect check, or public update button. `VersionIncompatible` is a
protocol terminal and is not a node-update capability. The `/api/update` path
in `mock/server.mjs` is mock-only evidence and is not promoted into the
Workspace/session contract; no production `/api/update` fetch or legacy
`node-update` module is restored.
