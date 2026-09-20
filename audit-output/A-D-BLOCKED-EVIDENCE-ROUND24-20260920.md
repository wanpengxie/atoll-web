# A–D Round 24 ordinary public-owner evidence (2026-09-20)

This packet covers twenty remaining A–D blocked rows in an independent test
file, [`blocked-round24-public-owner.test.jsx`](../tests/blocked-round24-public-owner.test.jsx).
The selection is de-duplicated from the ordinary Round 22 and Round 23
packets. AD-167 is intentionally re-verified because its Feed owner fix landed
after its earlier red reproduction; the other nineteen rows remain ordinary
red evidence. No `it.fails`, skip, deletion, private export, or product edit
is used here.

## Focused verification

```text
npx vitest run tests/blocked-round24-public-owner.test.jsx --reporter=dot

Test Files  1 failed (1)
Tests       19 failed | 1 passed (20)

npx vitest run tests/blocked-round24-public-owner.test.jsx -t '\[AD-167\]' --reporter=verbose

Test Files  1 passed (1)
Tests       1 passed | 19 skipped (20)
```

The one green result is promoted from BLOCKED to PASS. The nineteen ordinary
red assertions stay BLOCKED and are not completion signals.

## Case ledger and evidence

| ID | User capability | Invariant / first public owner | Setup, action, and current result |
|---|---|---|---|
| AD-167 | Revoked channel does not issue a freshness probe; a later grant resumes exactly one probe. | Grant generation and attached epoch fence `ChannelFeedRuntime.refreshChannel` before `channelMeta`. | Public runtime revokes c0, calls `refreshChannel`, regrants generation 2, then races a pending probe with a second revoke. **PASS**: no call while detached, one call after regrant, and the revoked pending call resolves `false` ([test:230](../tests/blocked-round24-public-owner.test.jsx:230)). This verifies the existing owner fix `5c46b7c`; no product source changed in this packet. |
| AD-027 | Editing a processing Agent turn preserves the committed Reading position while opening Composer edit state. | Waiting/edit cannot replace the committed Reading owner; `useWaitingEditingController` + `WaitingLayer`. | Start editing a processing turn, then render the public Waiting layer. **RED**: `onComposerEditChange` remains `null` instead of the target session, so no equivalent Reading/Composer handoff is observable ([test:266](../tests/blocked-round24-public-owner.test.jsx:266)). `FIXTURE_MISSING/BLOCKED`. |
| AD-037 | Reconnect editing saves to the original hold owner and latest committed target. | Hold/release/context callbacks remain owned by the committed Waiting controller, not a candidate callback. | Start a queued edit, complete its hold, rerender with new callbacks/state, and inspect context ownership. **RED**: only the initial `agent.hold` is sent; no original-owner `agent.context` handoff is observed ([test:294](../tests/blocked-round24-public-owner.test.jsx:294)). `FIXTURE_MISSING/BLOCKED`. |
| AD-156 | An inactive rail remains unknown until cached unread context and its parent are complete. | Notification is proven only by the current Replica/cache authority; `ChannelFeedRuntime.unreadFor`. | Attach c0/c1, read c1 before cache rows, then enqueue a cached request and terminal. **RED**: initial public result is `{ related: 0, total: 0 }`, not `{ unknown: true }` ([test:330](../tests/blocked-round24-public-owner.test.jsx:330)). `FIXTURE_MISSING/BLOCKED`. |
| AD-159 | Physical reading progress without a notification parent does not fabricate a known rail count. | Physical cursor and notification-context completeness are independent; `ChannelFeedRuntime.markRead/unreadFor`. | Mark c1 physically read through its public authority while no parent exists. **RED**: `unreadFor` returns known zero rather than unknown ([test:351](../tests/blocked-round24-public-owner.test.jsx:351)). `FIXTURE_MISSING/BLOCKED`. |
| AD-160 | An inactive granted channel with unsettled local Meta remains unknown. | Empty Replica cannot imply Meta readiness; `ChannelFeedRuntime.historyFor/unreadFor`. | Grant inactive c1 with rows advertised but no local body/Meta settlement. **RED**: public unread projection is known zero, not unknown ([test:368](../tests/blocked-round24-public-owner.test.jsx:368)). `FIXTURE_MISSING/BLOCKED`. |
| AD-161 | A related tail fact materialized by reconnect history enters the mounted viewport arrival journal. | History and live ingress share one Replica arrival owner; `loadHistory/enqueue/pageEnd/arrivalReceipts`. | Request public history, enqueue a related history row, close the page, and inspect the public timeline receipt. **RED**: `arrivalReceipts.timeline().events` is empty ([test:382](../tests/blocked-round24-public-owner.test.jsx:382)). `FIXTURE_MISSING/BLOCKED`. |
| AD-165 | Attach alone does not probe twice; explicit channel entry owns one freshness probe. | History demand requires an explicit interest obligation; `requestBackgroundInterest`. | Attach an empty channel, assert no automatic probe, then request `channel-entry`. **RED**: the current public lease is rejected (`accepted: false`) ([test:420](../tests/blocked-round24-public-owner.test.jsx:420)). `OWNER_MISSING/BLOCKED`. |
| AD-166 | Empty-channel reconnect and foreground return each resume one cancellable freshness obligation. | Each lifecycle obligation has one public probe owner; `requestBackgroundInterest`. | Request `channel-entry`, `reconnect`, and `foreground-return` through the public runtime. **RED**: all requested leases are rejected, so no obligation/probe contract exists ([test:437](../tests/blocked-round24-public-owner.test.jsx:437)). `OWNER_MISSING/BLOCKED`. |
| AD-178 | Meta readiness establishes a live queue without waiting for the selected cache body. | Meta/readiness and body hydration are independent owners; `prepareLocalReplica/resumeLocalReplica` + Replica cache. | Seed a public cached row, destroy, recreate the same principal, and resume the Replica. **RED**: `resumeLocalReplica()` returns `{}` instead of the prior `{ c0: 100 }` while the body is absent ([test:453](../tests/blocked-round24-public-owner.test.jsx:453)). `FIXTURE_MISSING/BLOCKED`. |
| AD-197 | Missing compact result is a stable unavailable terminal state, not a successful ready state. | Missing business detail cannot be inferred from a command receipt; `ChannelAdministrationPanel/GovernanceFeature`. | Render a completed operation carrying only “已完成”. **RED**: status is “已完成”; the unavailable terminal message is absent ([test:473](../tests/blocked-round24-public-owner.test.jsx:473)). `FIXTURE_MISSING/BLOCKED`. |
| AD-202 | A node update exposes one confirmation-gated action only when a newer version is available. | `VersionIncompatible` cannot impersonate a node-update owner; `WorkspaceLayout.navigation.update`. | Supply public `navigation.update` with v0.06→v0.07 availability and inspect the shell. **RED**: no accessible “升级到 v0.07” button exists ([test:481](../tests/blocked-round24-public-owner.test.jsx:481)). `CAPABILITY_GAP/BLOCKED`. |
| AD-203 | The same update action reports progress/disabled state and then shows the current version. | Progress and success facts must come from one node-update owner; `WorkspaceLayout.navigation.update`. | Supply public update state `succeeded` at v0.07 and inspect the title projection. **RED**: no “Atoll v0.07” title exists ([test:493](../tests/blocked-round24-public-owner.test.jsx:493)). `CAPABILITY_GAP/BLOCKED`. |
| AD-256 | Refresh restores only the same principal’s control state and converts `sending` to `uncertain`. | Control recovery is principal-scoped and durable; `useComposerSubmissionRuntime`. | Mount, cancel, unmount, and remount the public submission runtime with one principal/store. **RED**: remount has no `c0:request-1:cancel` uncertain state ([test:505](../tests/blocked-round24-public-owner.test.jsx:505)). `OWNER_MISSING/BLOCKED`. |
| AD-257 | Explainable active control state and serializable errors survive refresh; unrelated states do not. | Persistence accepts bounded active facts and serialized errors only; `useComposerSubmissionRuntime`. | Reject a public cancel with an Error carrying `code: closed`, then inspect the recorded state. **RED**: state retains the raw `Error` object rather than `{ code, detail }` ([test:521](../tests/blocked-round24-public-owner.test.jsx:521)). `OWNER_MISSING/BLOCKED`. |
| AD-316 | A terminal `create_device` command refreshes the authoritative device projection. | Command completion cannot masquerade as a device projection; `SpaceAdministrationPanel → SpaceDevices` commands port. | Submit `create_device` through the public Devices tab with a mock terminal receipt and `refresh`. **RED**: `submit` receives the expected command but `refresh` is called zero times ([test:538](../tests/blocked-round24-public-owner.test.jsx:538)). `FIXTURE_MISSING/BLOCKED`. |
| AD-331 | PC copies reply text; mobile short press replies, long press copies, without cross-triggering. | Reply/copy gestures remain mutually exclusive over one message fact; `useTimelineRowRenderer` message actions. | Copy the public Agent answer, then send touch pointer down/up for short reply and long copy. **RED**: desktop copy works, but touch short press does not call `onReply` ([test:558](../tests/blocked-round24-public-owner.test.jsx:558)). `FIXTURE_MISSING/BLOCKED`. |
| AD-334 | Turn detail exposes audit identifiers without dumping payload JSON. | Process detail is owned by the public row/process boundary and must redact payloads; `useTimelineRowRenderer/onOpenTurn`. | Render a process observation with `audit_id` and sensitive payload, open public “查看过程”. **RED**: callback receives the turn, but rendered detail contains no `audit-202` identifier ([test:582](../tests/blocked-round24-public-owner.test.jsx:582)). `FIXTURE_MISSING/BLOCKED`. |
| AD-363 | Declared JSON Schema fields form typed, validated control payloads. | Capability-declared fields must reach the public command owner, not disappear into a fixed word list; `buildComposerModel/createComposerCommandRequest`. | Advertise `agent.custom-control` with integer/boolean fields and submit the typed public command request. **RED**: current command port throws “命令 /custom-control 当前不可用” ([test:599](../tests/blocked-round24-public-owner.test.jsx:599)). `OWNER_MISSING/BLOCKED`. |
| AD-364 | Standard control payloads for Agent words advertised by `describe` remain sendable. | Control payload field closure comes from `describe`, not only the built-in slash-command table; `buildComposerModel/createComposerCommandRequest`. | Advertise `agent.replace.expected_hold_id` and submit through the public Composer command port. **RED**: current port throws “命令 /replace 当前不可用” ([test:620](../tests/blocked-round24-public-owner.test.jsx:620)). `OWNER_MISSING/BLOCKED`. |

## Ledger and quantification delta

AD-167 is the only promoted row. The A–D ledger moves from **314 PASS / 0
REGRESSION / 51 BLOCKED** to **315 PASS / 0 REGRESSION / 50 BLOCKED**. The
nineteen red rows remain BLOCKED; none is judged obsolete, deleted, skipped,
or completed through expected-fail semantics.

The blocked-category counts therefore become:

| Category | Before Round 24 | After Round 24 | Change |
|---|---:|---:|---:|
| `OWNER_MISSING` | 12 | 12 | 0 |
| `FIXTURE_MISSING` | 24 | 24 | 0 |
| `CAPABILITY_GAP` | 15 | 14 | −1 (`AD-167`) |
| **Total BLOCKED** | **51** | **50** | **−1** |

The AD-167 change is attributable to the pre-existing Feed owner commit
`5c46b7c`, not to this test-only packet. All other cases are returned to their
existing owner/fixture boundaries with their minimal reproduction intact.

## Boundary proof

This packet adds only
[`tests/blocked-round24-public-owner.test.jsx`](../tests/blocked-round24-public-owner.test.jsx)
and this A–D audit report. It does not modify Feed, Waiting, Workspace,
Governance, Composer, Devices, vendor, package manifests, lockfiles, private
exports, or any product source. Shared worktree changes from other owners are
left untouched. No baseline declaration is removed or skipped.
