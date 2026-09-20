# A–D blocked evidence packet — Round 31 (2026-09-20)

Round 31 selects ten existing `CAPABILITY_GAP` rows whose current public
owners are directly exercisable: AD-037, AD-156, AD-159–AD-161, and
AD-192–AD-195/AD-197. It deliberately adds no ordinary-red declaration and
does not reuse a private API. The existing public-owner assertions were run
as the unique evidence sources:

```text
npx vitest run tests/blocked-round24-public-owner.test.jsx \
  -t '\[AD-(037|156|159|160|161|197)\]' --reporter=dot

Test Files  1 failed (1)
Tests       6 failed | 14 skipped (20)

npx vitest run tests/blocked-round26-public-owner.test.jsx \
  -t '\[AD-(192|193|194|195)\]' --reporter=dot

Test Files  1 failed (1)
Tests       4 failed | 16 skipped (20)
```

Combined, the ten selected public-owner assertions are **10 ordinary red / 30
skipped**. No result is counted as PASS, no capability is judged obsolete, and
no product source is changed. The ledger remains **324 PASS / 0 REGRESSION /
41 BLOCKED**.

## Case-level packets

| Case | Previous user capability | Invariant | Current public owner | Baseline action / expected result | Current result and evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-037 | On reconnect while editing, the original hold owner re-reads the latest committed target through `agent.context`. | A reconnect must preserve the committed Waiting owner and use the latest target, not replay a stale hold or stop at the first lease. | `WaitingLayer` + `useWaitingEditingController` public composition | Reconnect after a queued target is committed; expect the original owner callback to receive `type: agent.context` with the latest turn. | **Red:** the only callback is `agent.hold` for the queued target; no `agent.context` reconnect operation is emitted; `tests/blocked-round24-public-owner.test.jsx:323`. | `CAPABILITY_GAP/BLOCKED`; current Waiting owner has no reconnect context operation. |
| AD-156 | An inactive rail stays unknown until cached unread context and its parent are folded. | Notification certainty requires the parent context/authority; a local zero cannot stand in for unknown remote context. | `ChannelFeedRuntime.unreadFor` → `ChannelReplica` | Prepare an inactive granted channel before notification parent settlement; expect `{unknown: true}`, then settle the parent and fold cached context. | **Red:** initial projection is `{related: 0, total: 0}` without `unknown`; `tests/blocked-round24-public-owner.test.jsx:337`. | `CAPABILITY_GAP/BLOCKED`; public unread owner collapses unsettled context to known zero. |
| AD-159 | Advancing physical reading alone does not make incomplete notification context known. | Read cursor progress and notification-parent authority are separate facts. | `ChannelFeedRuntime.acknowledgeNotifications` + `unreadFor` | Advance physical reading with the notification parent absent; expect the unread projection to remain `{unknown: true}`. | **Red:** projection is `{related: 0, total: 0}` rather than unknown; `tests/blocked-round24-public-owner.test.jsx:363`. | `CAPABILITY_GAP/BLOCKED`; public cursor owner conflates read progress with notification certainty. |
| AD-160 | An inactive granted notification remains unknown while local Meta never settles. | Local replica readiness cannot authorize a notification count without settled Meta/parent authority. | `ChannelFeedRuntime` history/unread projection | Prepare local replica for an inactive grant while Meta remains unsettled; expect `{unknown: true}`. | **Red:** `localReplicaReady` is true but unread projection is `{related: 0, total: 0}`; `tests/blocked-round24-public-owner.test.jsx:377`. | `CAPABILITY_GAP/BLOCKED`; public Feed/Replica owner reports zero before Meta authority. |
| AD-161 | A history-materialized related reconnect tail is journaled for the mounted viewport. | History admission and the mounted timeline arrival journal share the same reconnect/authority boundary. | `ChannelFeedRuntime` history ingress → public timeline arrival journal | Materialize related history seq 101 while the viewport is mounted; expect the `reconnect-related` receipt at seq 101. | **Red:** timeline arrival receipts remain empty; `tests/blocked-round24-public-owner.test.jsx:414`. | `CAPABILITY_GAP/BLOCKED`; history ingress does not call the public arrival-journal owner. |
| AD-192 | The member selector offers only registered human principals, excluding Agents and retired users. | Actor kind and active human membership are distinct; the selector must be human-only and current. | `ChannelAdministrationPanel` / `GovernanceFeature` member selector | Open the public member selector with current human, Agent, and retired principal rows; expect only `root · 用户`. | **Red:** options include the search prompt, `root · 用户`, `steward · 用户`, and `retired · 用户`; `tests/blocked-round26-public-owner.test.jsx:400`. | `CAPABILITY_GAP/BLOCKED`; Governance selector does not enforce the human/current filter. |
| AD-193 | A successful child-channel create exposes separate ledger, OBS, membership, and serving convergence before reporting ready. | Command receipt, ledger terminal, OBS presence, membership, and serving readiness are independent facts. | `GovernanceFeature` public create/convergence projection | Submit a child create and drive the public convergence inputs; expect the create action and a distinct serving-ready result. | **Red:** the public composition has no accessible `创建子频道` action in the selected state; `tests/blocked-round26-public-owner.test.jsx:408`. | `CAPABILITY_GAP/BLOCKED`; no mounted public convergence owner covers the baseline sequence. |
| AD-194 | Member operations expose ledger terminal and roster convergence as separate user-visible facts. | Ledger completion cannot imply member-list readiness; each authority must settle independently. | `ChannelMembers` / `GovernanceFeature` public member projection | Refresh the member view after the ledger terminal; expect the separate `成员已就绪` fact. | **Red:** no `成员已就绪` fact is rendered after refresh; `tests/blocked-round26-public-owner.test.jsx:422`. | `CAPABILITY_GAP/BLOCKED`; public member owner has roster/refresh but no convergence fact. |
| AD-195 | A compact command closure preserves its ledger lifecycle without declaring a missing business result ready. | Missing business detail is an unavailable terminal, not a successful result inferred from the command receipt. | `GovernanceFeature` / `OperationState` public status projection | Supply a submitted compact closure with no business result; expect `终态详情不可用，请刷新或重新进入频道`. | **Red:** status remains `账本已完成，结果待确认`; `tests/blocked-round26-public-owner.test.jsx:429`. | `CAPABILITY_GAP/BLOCKED`; public operation status lacks the unavailable terminal. |
| AD-197 | A compact result with missing detail has a stable unavailable terminal state. | A command `completed` state cannot masquerade as a complete business result when detail is absent. | `GovernanceFeature` / `OperationState` public status projection | Supply a completed operation without result detail; expect the same unavailable terminal prompt. | **Red:** status remains `已完成`; `tests/blocked-round24-public-owner.test.jsx:478`. | `CAPABILITY_GAP/BLOCKED`; public operation status renders completion without result availability. |

## Classification and handoff

- All ten rows have a named public owner, so this packet does not move them to
  `OWNER_MISSING` or `FIXTURE_MISSING`. The current behaviors are directly
  non-equivalent at those owners; they remain `CAPABILITY_GAP/BLOCKED`.
- No test was added for these failures. The Round 24 and Round 26 assertions
  remain the unique executable red sources, and their expected values were not
  weakened or changed. No `it.fails`, skip, private export, old store, or
  compatibility API was introduced.
- No green recovery was found. Consequently PASS remains 324, and the ten
  selected rows remain in the 41-row BLOCKED ledger. Product owners receive the
  exact public boundary, expected fact, and observed result above.

## Boundary proof

Round 31 changes only this case-level A–D evidence report plus the A–D ledger
and verification references. It does not modify Waiting, Feed, Replica,
Governance, Workspace, Reading, vendor, package, lock files, private exports,
or baseline declarations. No product capability is declared obsolete.
