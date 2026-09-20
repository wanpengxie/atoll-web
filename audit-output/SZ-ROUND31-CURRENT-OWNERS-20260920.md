# S-Z round 31 — current-owner check for SZ-020/021/028/033/034

Date: 2026-09-20

Scope: the five rows carried forward from round 30.  This is an owner and
evidence pass only: no source, space port, Workspace/Reading/Vendor owner,
Outbox owner, package, lockfile, old path, or compatibility layer was changed.

## Result

One row has a current user-facing successor when split at the capability
boundary; four remain unresolved and are handed to their actual owner or
product decision point.

| Row | Current formal owner / direct evidence | Disposition |
|---|---|---|
| SZ-020 | `useTimelineRowRenderer` → `TimelineRowRenderer` owns the user-visible result. Its structured-result path parses object JSON in [`TimelineRowRenderer.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:252), while `terminal-result` facts drive the compact-terminal unavailable state. [`structured-result-restore.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/structured-result-restore.test.jsx:91) proves object JSON expansion; the current public owner test [`blocked-round16-public-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/blocked-round16-public-owner.test.jsx:252) proves a compact terminal does not invent detail. | **Recovered current user capability (split)**. The old `parseJSONObject`/`terminalValue` helper shape is obsolete; no private export or old parser was restored. The central ledger is intentionally unchanged. |
| SZ-021 | No integrated space-device command owner exists. Production passes a disabled space port and a user-facing unsupported reason; the direct boundary assertion [`sz-round30-space-unsupported.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round30-space-unsupported.test.jsx:26) proves the device control is disabled and cannot call `space.commands.submit`. | **GAP retained**. This is explicit unsupported product scope, not a missing client validator or a reason to recreate `deviceCommand`. |
| SZ-028 | The current durable submission owner is `useComposerSubmissionRuntime`, but the former Suspense candidate-render transport-authority scenario has no current public successor. A render candidate is not an authority source in the current app contract, and no test here duplicates Composer/Outbox ownership. | **OPEN handoff** to `composer_owner`; regression packet below. |
| SZ-033 | Historical `it.each` case: a queued, unattempted send after membership is revoked. The current Composer owner has adjacent unknown-access and new-retired-send tests, but no direct queued-revocation successor. | **OPEN handoff** to `composer_owner`; no inferred closure. |
| SZ-034 | Historical `it.each` case: a queued, unattempted send after the channel is retired. The current Composer owner has an adjacent new-send/retired-channel guard, but no direct pre-existing queued-record successor. | **OPEN handoff** to `composer_owner`; no inferred closure. |

Round count: 5 cases inspected, 1 current user capability recovered as a
split successor (SZ-020), 1 explicit product GAP retained (SZ-021), and 3
owner handoffs retained OPEN (SZ-028/033/034).  No new real product RED was
introduced or hidden.

## SZ-020 owner split

The historical case bundled two facts that no longer share a model API:

1. Text containing an object JSON result is parsed and presented as a
   collapsible, recursively safe structured result.  This is the current
   `TimelineRowRenderer` owner and is exercised by the direct successor at
   `structured-result-restore.test.jsx:91`.
2. A compact terminal carries an authoritative closure fact without a full
   business payload.  The current `terminal-result` policy and row renderer
   surface `终态详情不可用，请刷新或重新进入频道`, as exercised by
   `blocked-round16-public-owner.test.jsx:252`.

The old return object `{ phase, value, error }` from `terminalValue` is not a
current public contract.  Treating the two current user capabilities as one
new helper would create a second owner and would falsely close an
implementation-shape migration.  The current evidence is sufficient for the
user-visible split only.

## SZ-021 unsupported boundary

`WorkspaceApp` passes the space port as `disabled: true`, with the explanation
`当前 wire/session 没有空间治理结果投影；此版本仅展示 OBS 目录，不会伪造成功。`,
and its `submit` rejects `governance.space`.  The round-30 panel test checks
the exact message, template/configuration/device control disabling, and zero
submit calls.  Therefore this row remains a user-understandable unsupported
boundary.  No device action payload builder, default injection, or local
validation compatibility was added.

## Composer handoff packet (SZ-028/033/034)

This packet is deliberately handed to `composer_owner`; it is not added as a
second Outbox test suite here.

| Case | Required public observation |
|---|---|
| SZ-028 | During a suspended/candidate render, only the last committed Composer runtime may publish transport authority; a candidate must not submit or alter the durable queue. |
| SZ-033 | Start a durable queued record with confirmed membership, revoke membership before transmission, then assert a terminal rejection, preserved draft/record facts, no wire submit, and no automatic resurrection after membership returns. |
| SZ-034 | Start a durable queued record, retire the channel before transmission, then assert the closed-channel rejection, preserved user-visible facts, no wire submit, and no automatic resurrection. |

The packet is a behavior handoff, not a claim that the old hook or
`localStorage` path should return.  Existing adjacent Composer evidence remains
valid but is not counted as these exact cases.

## Verification

Current public result/unsupported owners were run together:

```text
npx vitest run tests/structured-result-restore.test.jsx tests/sz-round30-space-unsupported.test.jsx --reporter=dot
Test Files  2 passed (2)
Tests       10 passed (10)
```

No central ledger row was rewritten.  No old path, skip, private export,
compatibility behavior, space command, Workspace/Reading/Vendor product file,
or Outbox owner was changed.
