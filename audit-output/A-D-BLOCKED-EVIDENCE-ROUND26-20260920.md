# A–D Round 26 public-owner evidence (2026-09-20)

This packet selects the next twenty current A–D `BLOCKED` rows after
explicitly de-duplicating the closed AD-157/158/167/288/289 rows and the
Round 25 packet. It uses one ordinary public-owner assertion per case in
[`tests/blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx).
No `it.fails`, skip, private export, compatibility owner, or product edit is
used. These results are evidence of the current owner boundary; a red result
does not promote or retire a case.

## Focused verification

```text
npx vitest run tests/blocked-round26-public-owner.test.jsx --reporter=dot

Test Files  1 failed (1)
Tests       20 failed (20)
```

All twenty assertions are ordinary red results. The selected cases are
AD-027, AD-037, AD-150/151/152/153/155, AD-156, AD-159/160/161, AD-165/166,
AD-178, and AD-192/193/194/195/196/197. The closed AD-157/158/167/288/289
rows are intentionally absent from this packet.

## Case evidence

| ID | User capability | Invariant and current public owner | Baseline setup/action/observable result | Current result and disposition |
|---|---|---|---|---|
| AD-027 | Editing a processing Agent turn keeps the committed Reading position while Composer edit state is available. | Waiting/edit cannot replace the committed Reading owner; `useWaitingEditingController` + `WaitingLayer`. | Start editing a processing turn, wait for the public edit session, render `WaitingLayer`, and inspect the following-tail Reading container. | **RED**: no committed edit session reaches `onComposerEditChange`; keep `FIXTURE_MISSING/BLOCKED`, first divergence is the Waiting/Reading handoff. ([test:140](../tests/blocked-round26-public-owner.test.jsx:140)) |
| AD-037 | Reconnect editing saves to the original hold owner and latest committed target. | Hold/context callbacks remain owned by the committed Waiting controller, not a candidate callback; `useWaitingEditingController`. | Start a queued edit, rerender after the hold terminal with new callbacks/state, then inspect which public callback receives `agent.context`. | **RED**: only the initial `agent.hold` is observed; no original-owner context handoff occurs. Keep `FIXTURE_MISSING/BLOCKED`. ([test:170](../tests/blocked-round26-public-owner.test.jsx:170)) |
| AD-150 | Creating a channel can include a selected current-channel Agent as an initial Actor seat. | Seats must come from the public roster and be selectable by the governance owner; `ChannelAdministrationPanel` / `GovernanceFeature`. | Render the public governance panel with a current-channel Agent roster and query the initial-seat checkbox. | **RED**: no accessible `Worker` checkbox is exposed. Keep `OWNER_MISSING/BLOCKED`; no current seat-selection owner is present. ([test:208](../tests/blocked-round26-public-owner.test.jsx:208)) |
| AD-151 | A public recipe creation reads the template body before submitting create. | Create cannot send only a template ID; `GovernanceFeature` must own the template-read then create sequence. | Render a template option, choose it, submit a named child channel, and inspect the first public command. | **RED**: the public template combobox/submit sequence is unavailable, so no `get_template` command is observed. Keep `OWNER_MISSING/BLOCKED`. ([test:218](../tests/blocked-round26-public-owner.test.jsx:218)) |
| AD-152 | A compact template closure without body shows stable unavailable detail rather than business failure. | Missing template detail cannot fabricate a recipe or failure; `GovernanceFeature` status/alert is the public owner. | Render the public governance panel with a template command port and inspect the unavailable-detail alert. | **RED**: the unavailable-detail alert is absent. Keep `OWNER_MISSING/BLOCKED`. ([test:230](../tests/blocked-round26-public-owner.test.jsx:230)) |
| AD-153 | Channel creation exposes ledger/OBS/membership/serving convergence and enters only after ready. | A command receipt cannot declare serving ready; `GovernanceFeature` owns the four-step progress projection. | Submit a named child-channel creation through the public panel and inspect the convergence region. | **RED**: no `频道创建进度` region is exposed. Keep `OWNER_MISSING/BLOCKED`. ([test:238](../tests/blocked-round26-public-owner.test.jsx:238)) |
| AD-155 | The create dialog supports Escape/backdrop/focus trap and focus return. | One public dialog owner must own the complete lifecycle; `GovernanceFeature` / `SidePanel`. | Render the public governance surface with a submit port and query the independent dialog and backdrop. | **RED**: no independent `新建频道` dialog/backdrop is exposed. Keep `OWNER_MISSING/BLOCKED`. ([test:247](../tests/blocked-round26-public-owner.test.jsx:247)) |
| AD-156 | An inactive rail remains unknown until cached unread context and its parent are complete. | Notification is proven only by the current Replica/cache authority; `ChannelFeedRuntime.unreadFor` + `ChannelReplica`. | Attach c0/c1, inspect c1 before cache rows, then enqueue a cached request and terminal and inspect the public unread projection. | **RED**: the initial inactive projection is known zero instead of `{ unknown: true }`. Keep `FIXTURE_MISSING/BLOCKED`. ([test:255](../tests/blocked-round26-public-owner.test.jsx:255)) |
| AD-159 | Physical reading progress without a notification parent does not fabricate a known rail count. | Physical cursor and notification-context completeness are independent; `ChannelFeedRuntime.markRead` / `unreadFor`. | Mark c1 physically read through its public authority while no parent row exists, then inspect unread. | **RED**: `unreadFor` returns known zero rather than unknown. Keep `FIXTURE_MISSING/BLOCKED`. ([test:274](../tests/blocked-round26-public-owner.test.jsx:274)) |
| AD-160 | An inactive granted channel with unsettled local Meta remains unknown. | Empty Replica cannot imply Meta readiness; `ChannelFeedRuntime.historyFor` / `unreadFor`. | Grant inactive c1 with rows advertised but no local body/Meta settlement, then inspect history and unread. | **RED**: the public projection returns known zero instead of unknown. Keep `FIXTURE_MISSING/BLOCKED`. ([test:289](../tests/blocked-round26-public-owner.test.jsx:289)) |
| AD-161 | A reconnect-materialized related tail fact enters the mounted viewport arrival journal. | History and live ingress share one Replica arrival owner; `loadHistory` / `enqueue` / `pageEnd`. | Request public history, enqueue a related history row, close the page, and inspect the public timeline receipt. | **RED**: the arrival journal remains empty. Keep `FIXTURE_MISSING/BLOCKED`. ([test:301](../tests/blocked-round26-public-owner.test.jsx:301)) |
| AD-165 | Initial freshness is requested once on explicit channel entry, not probed twice from attach. | History demand requires an explicit interest obligation; `ChannelFeedRuntime.requestBackgroundInterest`. | Attach an empty channel, assert attach makes no probe, request `channel-entry`, and inspect the public wire call. | **RED**: the current public interest lease is rejected, so no entry probe is admitted. Keep `OWNER_MISSING/BLOCKED`. ([test:338](../tests/blocked-round26-public-owner.test.jsx:338)) |
| AD-166 | Empty-channel reconnect and foreground return each resume one cancellable freshness obligation. | Each lifecycle obligation has one public probe owner; `requestBackgroundInterest`. | Request `channel-entry`, `reconnect`, and `foreground-return` through the public runtime and count probes. | **RED**: the public leases are rejected and no three-probe lifecycle is available. Keep `OWNER_MISSING/BLOCKED`. ([test:353](../tests/blocked-round26-public-owner.test.jsx:353)) |
| AD-178 | Attach returns after Meta creates live queues without waiting for selected cache body hydration. | Meta/readiness and body hydration are independent owners; `prepareLocalReplica` / `resumeLocalReplica` + Replica cache. | Seed a public cached row, destroy/recreate the same principal, resume the Replica, and inspect cursor/row readiness. | **RED**: `resumeLocalReplica()` has no retained c0 cursor while the body is absent. Keep `FIXTURE_MISSING/BLOCKED`. ([test:368](../tests/blocked-round26-public-owner.test.jsx:368)) |
| AD-192 | The user selector accepts only registered, present human principals. | Agent/retired principals cannot become human targets; `GovernanceFeature` participant selector. | Render the public member tab with present human, present Agent, and retired human principals, then inspect options. | **RED**: the selector does not expose the required human-only option set. Keep `FIXTURE_MISSING/BLOCKED`. ([test:387](../tests/blocked-round26-public-owner.test.jsx:387)) |
| AD-193 | Successful creation separately converges ledger, OBS, membership, and serving. | Receipt cannot replace serving/membership convergence; `GovernanceFeature` progress/status owner. | Submit a named child-channel creation through the public panel and inspect the serving-ready projection. | **RED**: no `服务就绪` convergence fact is exposed. Keep `FIXTURE_MISSING/BLOCKED`. ([test:403](../tests/blocked-round26-public-owner.test.jsx:403)) |
| AD-194 | Member operations distinguish ledger terminal from roster convergence. | A terminal receipt cannot fabricate roster readiness; `GovernanceFeature` member refresh owner. | Render a member roster, invoke the public refresh control, and inspect the member-ready projection. | **RED**: no `成员已就绪` fact is exposed. Keep `FIXTURE_MISSING/BLOCKED`. ([test:412](../tests/blocked-round26-public-owner.test.jsx:412)) |
| AD-195 | Compact closure preserves its ledger lifecycle without declaring missing business result ready. | Unavailable result cannot masquerade as completion; `GovernanceFeature` operation status owner. | Render a submitted operation carrying only ledger completion text and inspect its public status. | **RED**: the status remains `账本已完成，结果待确认` instead of the unavailable terminal. Keep `FIXTURE_MISSING/BLOCKED`. ([test:425](../tests/blocked-round26-public-owner.test.jsx:425)) |
| AD-196 | Failed compact closure is observable without guessing its failure reason. | Failed and unavailable-result facts remain separate; `GovernanceFeature` create/status owner. | Submit a named child-channel creation through a rejecting public command port and inspect the failure terminal. | **RED**: the current governance surface has no public create action in this setup, so no failed-closure status is observable. Keep `FIXTURE_MISSING/BLOCKED`. ([test:432](../tests/blocked-round26-public-owner.test.jsx:432)) |
| AD-197 | Missing compact result detail is a stable unavailable terminal, not a successful ready state. | Missing business detail cannot be inferred from a command receipt; `GovernanceFeature` operation status owner. | Render a completed operation carrying only `已完成` and inspect the public status. | **RED**: the status remains `已完成`; the unavailable terminal is absent. Keep `FIXTURE_MISSING/BLOCKED`. ([test:442](../tests/blocked-round26-public-owner.test.jsx:442)) |

## Ledger outcome and quantification

All twenty rows remain `BLOCKED`; no ordinary red result is promoted, deleted,
skipped, or converted to expected-fail semantics. The ledger remains
**319 PASS / 0 REGRESSION / 46 BLOCKED**. Category counts remain
`OWNER_MISSING` 12, `FIXTURE_MISSING` 24, and `CAPABILITY_GAP` 10. Round 26
does not change those counts because every selected reproduction is still red.

The de-duplication boundary is explicit: AD-157/158/167/288/289 were already
closed in the Round 25 ledger and were not counted as Round 26 work. Ordinary
red evidence for the selected rows is retained for the responsible owner;
there is no claim that any product gap is obsolete.

## Boundary audit

This packet changes only
[`tests/blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx),
this report, the A–D ledger, and the A–D verification/quantification reports.
It does not modify Feed, Waiting, Workspace, Reading, Outbox, Governance
product source, vendor, package manifests, lockfiles, private exports, or
compatibility APIs. No baseline declaration was deleted or skipped. The
twenty ordinary red assertions remain explicit BLOCKED owner/fixture evidence
until the responsible public owner supplies the missing behavior or fixture.
