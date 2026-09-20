# S-Z round 30 — gap324 owner packet and five unresolved rows

Date: 2026-09-20

Scope: the historical browsing self-send `gap=324` packet, the explicit
unsupported boundary for `SZ-014`–`SZ-017`, and the next five unresolved
baseline rows `SZ-020`, `SZ-021`, `SZ-028`, `SZ-033`, and `SZ-034`.

No product source, Workspace/Reading/Vendor owner, Outbox owner, package or
lockfile was changed in this round.  The only new executable evidence is the
direct public space-panel boundary test.

## Result

The `gap=324` observation is a historical product regression, not a current
red on the present baseline.  The old run recorded the target row near the
lower edge while the list remained in `mode=browsing`; the focused rerun on
the current baseline passes the same public browser contract.  The packet is
therefore closed as a regression reproduction/owner handoff, without claiming
that this audit round implemented the Reading fix.

The five additional baseline rows are not closed here:

| Row | Current owner check | Disposition |
|---|---|---|
| SZ-020 | The old object-JSON/authoritative-terminal-phase helper has no current user-facing consumer. The integrated space port is explicitly disabled. | **GAP retained**; no parser/terminal compatibility path is restored. |
| SZ-021 | The old device-action builder has no current command owner. The integrated space device controls are explicitly disabled. | **GAP retained**; no device-action compatibility path is restored. |
| SZ-028 | `useComposerSubmissionRuntime` remains the submission owner candidate, but no current direct public case proves that a suspended candidate render cannot publish transport authority. | **OPEN handoff** to `composer_owner`; no duplicate Outbox test. |
| SZ-033 | The central ledger has no surviving title for this old queued-access case and no direct current successor was found. | **OPEN handoff** to `composer_owner`; no invented contract. |
| SZ-034 | The central ledger has no surviving title for this old queued-access case and no direct current successor was found. | **OPEN handoff** to `composer_owner`; no invented contract. |

Thus this round processes five rows: zero newly closed and five remaining
unresolved (two GAP, three OPEN).  `SZ-014`–`SZ-017` remain the four prior
space-governance GAPs; their current boundary is now directly observable.

## Historical `gap=324` packet and formal baseline mapping

The reproduction is the strict browser case
[`e-send-scroll-writers.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/e-send-scroll-writers.spec.js:325),
`browsing send hands off to the following owner with recorded writes`.
The round-29 run recorded:

- a user-displaced list in `mode=browsing`;
- an accepted composer send and a painted target row;
- no following handoff at the final frame, with `gap=324` and the target at
  the lower edge.

That evidence is preserved in the prior audit packet
[`SZ-ROUND29-READING-GEOMETRY-SPACE-20260920.md`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/SZ-ROUND29-READING-GEOMETRY-SPACE-20260920.md:87).
On the current baseline, the same focused command completed `1 passed`:

```text
npx playwright test tests/browser/e-send-scroll-writers.spec.js --grep "browsing send hands off" --reporter=line
1 passed (18.4s)
```

The formal S01 mapping is intentionally limited to the facts this packet
observes:

| Baseline | User-visible contract | Current public owner and evidence |
|---|---|---|
| SZ-001 | An explicit send from browsing creates one current latest/bottom intent before the send write. | `useComposerCommands.performSend` calls `readingIntent.composerSendStarted`; `ConversationSurface` captures the current token and calls `viewport.requestBottom` with its presentation revision and baseline tail. |
| SZ-002 | The accepted destination identity binds to that already-issued intent, rather than an unrelated append. | `useComposerCommands.performSend` passes accepted IDs to `composerAccepted`; `useConversationProjection` delegates to `bindLatestIntentTargets`; the browser owner records the typed timeline write and checks the target at the tail. |
| SZ-007/008 | Passive append and fold geometry must preserve the reader's anchor. | Not part of this self-send packet; already covered by the round-29 Reading geometry owner tests. |
| SZ-009/010 | Waiting-destination correlation and user-takeover invalidation. | Neither fact is exercised by this reproduction; no closure is claimed. |

The owner chain is singular at each boundary: Submission starts the send and
returns accepted IDs; `ConversationSurface`/`useConversationProjection` own the
Reading intent; `ReadingContainerHandoff` mounts the one
[`VendorListExecutor`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:217),
whose typed commands are the only route to
[`reading-dom-command-executor.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/reading-dom-command-executor.js:5).
No private state or retired send-scroll module was re-exported.

## `SZ-014`–`SZ-017`: explicit unsupported space boundary

Production passes the space port as `disabled: true` with the user-facing
reason
`当前 wire/session 没有空间治理结果投影；此版本仅展示 OBS 目录，不会伪造成功。`;
the write command rejects with `governance.space`.  The public panel renders
that reason as a status message and disables Actor-template, channel-template,
channel-configuration, and device-create controls.  This is an explicit,
understandable unsupported result—not a reason to recreate old commands,
default injection, declaration validation, or a compatibility layer.

The direct boundary assertion is
[`sz-round30-space-unsupported.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round30-space-unsupported.test.jsx:26):
it checks the exact message, all four tab classes of write controls, and that
the disabled panel never calls `space.commands.submit`.  It does not pretend
to close the old S03 command-construction cases.

## Focused verification

```text
npx vitest run tests/sz-round30-space-unsupported.test.jsx --reporter=dot
Test Files  1 passed (1)
Tests       1 passed (1)

npx vitest run tests/sz-round28-submission-reading-owner.test.js tests/sz-round29-space-owner.test.jsx tests/sz-round30-space-unsupported.test.jsx --reporter=dot
Test Files  3 passed (3)
Tests       11 passed (11)
```

No central ledger row was rewritten.  No old path, skip, private export,
compatibility behavior, Workspace/Reading/Vendor product file, or Outbox
owner was changed.
