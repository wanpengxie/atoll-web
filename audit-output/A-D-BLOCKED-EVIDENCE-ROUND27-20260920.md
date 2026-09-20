# A–D Round 27 fixture recovery and owner classification (2026-09-20)

Round 27 rechecks the twenty ordinary-red rows recorded by
[`tests/blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx).
It does not add another ordinary-red count. Three rows have a faithful current
public fixture and are promoted to PASS. The other seventeen remain BLOCKED,
split between a reproducible product capability gap at a named owner and the
absence of a current public owner. No `it.fails`, skip, private export,
compatibility owner, or product edit is used.

## Focused verification

```text
npx vitest run tests/blocked-round27-fixture-recovery.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       3 passed (3)
```

The Round 26 ordinary-red evidence remains available for all unresolved rows;
this packet adds only the three green successor fixtures below. The ledger
changes from **319 PASS / 0 REGRESSION / 46 BLOCKED** to **322 PASS / 0
REGRESSION / 43 BLOCKED**. The selected-row classification is:

| Round 27 disposition | Rows | Meaning |
|---|---|---|
| Fixture migration → PASS | AD-027, AD-178, AD-196 | The current public owner can express the same user capability after correcting a stale selector, boot, or tab/focus fixture. |
| Product capability gap → BLOCKED | AD-037, AD-156, AD-159, AD-160, AD-161, AD-192, AD-193, AD-194, AD-195, AD-197 | A current public owner is identifiable and the ordinary-red reproduction reaches it, but the required behavior is absent or non-equivalent. |
| No current public owner → BLOCKED | AD-150, AD-151, AD-152, AD-153, AD-155, AD-165, AD-166 | The adjacent surface exists, but no public entry owns the baseline seat/template/convergence/dialog or lifecycle obligation. |

## Case records

Each row records the user capability, invariant, old action, current public
owner, current action/result, and disposition. “Old action” is the baseline
action, not a request to restore the removed implementation.

| ID | User capability | Invariant | Current public owner | Old action | Current action/result | Round 27 disposition |
|---|---|---|---|---|---|---|
| AD-027 | Processing-turn editing keeps the committed Reading position while Composer receives the edit. | Waiting must not replace the committed Reading adapter; edit admission follows the target’s authoritative lifecycle. | `ReadingContainerHandoff` + `useWaitingEditingController` / Composer handoff. | Click edit on a processing turn, capture the existing following-tail container, then assert the same container remains while the editor opens. | The old `following-tail` selector is not a current public DOM contract. The successor drives processing → `agent.hold` → matching `queued,resumed,held_by` and asserts no Composer session for processing/stale resume, then a session after the matching fact; the public Reading stack remains connected. | **PASS — fixture migration.** Evidence: [`blocked-round27-fixture-recovery.test.jsx`](../tests/blocked-round27-fixture-recovery.test.jsx:94). |
| AD-037 | Reconnect editing saves against the original hold owner and latest committed target. | Hold/release ownership stays with the committed owner; candidate callbacks cannot receive a stale control. | `useWaitingEditingController` (public Composer `onSave`/`onAbandon` callbacks). | Start a queued edit, rerender with a new callback/state as if reconnecting, then expect the original owner to receive `agent.context` for the latest turn. | The public hook has no automatic `agent.context` operation on reconnect; the ordinary-red reproduction sees only the initial hold. The adjacent explicit save/release ownership contract is already AD-038, not this baseline’s reconnect-context action. | **BLOCKED — product capability gap at Waiting owner.** No product edit here; evidence: Round 26 [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:170), source owner has no `agent.context` path. |
| AD-150 | Create a channel with a selected current-channel Agent as an initial Actor seat. | Initial seats must come from a public current roster and be submitted with creation. | `ChannelAdministrationPanel` / `GovernanceFeature` create form. | Open the create dialog, select the current Agent seat, submit, and observe the seat in the command. | The current embedded create form exposes no seat checkbox or public seat-selection port; the Round 26 roster fixture therefore cannot perform the baseline action. | **BLOCKED — no current public owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:208). |
| AD-151 | Read a channel-template body before sending a public recipe. | Create cannot send only a template ID; template-body authority must precede create. | `GovernanceFeature` has the adjacent child-create form, but no public template-read/create sequence owner. | Select a template in the create dialog, wait for `get_template`, then submit the body-backed recipe. | The current form can select a template ID and sends `create_child`; no `get_template` command is emitted. | **BLOCKED — no current public owner for the required sequence.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:218). |
| AD-152 | A compact template closure with no body reports unavailable detail, not a business failure. | Missing recipe detail cannot be fabricated or collapsed into a generic failure. | `GovernanceFeature` operation/status boundary; no unavailable-detail projection is mounted. | Render a compact template closure lacking body and inspect the stable unavailable-detail alert. | The public governance surface has no unavailable-detail terminal/alert. | **BLOCKED — no current public owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:230). |
| AD-153 | Creation exposes ledger, OBS, membership, and serving convergence and enters only after ready. | A command receipt cannot declare serving ready; all four facts must converge. | `GovernanceFeature` child-create status; no convergence projection is mounted. | Submit creation and inspect the four-step progress region before entry. | The current form exposes a one-shot operation status and no convergence region. | **BLOCKED — no current public owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:238). |
| AD-155 | The create dialog supports Escape/backdrop close, focus trap, and focus return. | One public dialog owner must own the complete lifecycle. | `GovernanceFeature` / `SidePanel`; no independent create-dialog owner exists. | Open the create dialog, exercise Escape/backdrop/focus loop, then inspect returned focus. | The current surface is an embedded form inside the governance side panel; no independent create dialog/backdrop/focus owner is exposed. | **BLOCKED — no current public owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:247). |
| AD-156 | An inactive rail remains unknown until cached unread context and its parent are complete. | Readiness and notification-context completeness are separate; empty rows cannot imply a known zero. | `ChannelFeedRuntime.unreadFor` + `ChannelReplica` notification authority. | Prepare a local replica with an unresolved notification-context promise, inspect pending/unknown, resolve parent rows, then inspect the count. | The current runtime has no async notification-context owner; after local preparation `unreadFor` returns known `{ related: 0, total: 0 }` before parent context. | **BLOCKED — product capability gap at Feed owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:255). |
| AD-159 | Physical reading progress without a notification parent does not fabricate a known rail count. | Physical read cursor and notification-context completeness are independent. | `ChannelFeedRuntime.markRead` + `unreadFor`. | Advance physical read to the advertised head without the parent row, then inspect unknown unread state. | The public runtime returns known zero after `markRead`, not unknown. | **BLOCKED — product capability gap at Feed owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:274). |
| AD-160 | An inactive granted channel with unsettled local Meta remains unknown. | Meta readiness cannot be inferred from an empty Replica. | `ChannelFeedRuntime.prepareLocalReplica` / `historyFor` / `unreadFor`. | Keep inactive Meta unsettled while the selected channel prepares, then inspect the rail. | `prepareLocalReplica` resolves `localReplicaReady` and `unreadFor` reports known zero; no unsettled-Meta unknown state is available. | **BLOCKED — product capability gap at Feed owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:289). |
| AD-161 | A history-materialized related tail enters the mounted viewport arrival journal after reconnect. | History and live ingress must share the Replica arrival owner. | `ChannelFeedRuntime.loadHistory` / `enqueue` / `pageEnd` + `ChannelReplica.arrivalReceipts`. | Mount a timeline consumer, request history, enqueue a related history row, close the page, and inspect the receipt. | The public runtime records timeline arrival receipts only for `source: live`; the history row leaves the journal empty. | **BLOCKED — product capability gap at Feed/Replica owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:301). |
| AD-165 | Explicit channel entry requests one freshness probe without attach probing twice. | Freshness demand needs an explicit, cancellable interest obligation. | `ChannelFeedRuntime.requestBackgroundInterest`; only the search-context intent is admitted. | Attach an empty channel, request `channel-entry`, and inspect one public wire probe. | The public interest lease rejects `channel-entry`; no entry probe is admitted. | **BLOCKED — no current public owner for channel-entry interest.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:338). |
| AD-166 | Reconnect and foreground return each resume one cancellable freshness obligation. | Each lifecycle obligation has one probe owner and release path. | `ChannelFeedRuntime.requestBackgroundInterest`; reconnect/foreground intents are not admitted. | Request entry, reconnect, and foreground-return interests and count the three probes. | The public interest port rejects the lifecycle intents, so no such probe set exists. | **BLOCKED — no current public owner for these lifecycle interests.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:353). |
| AD-178 | Reattach returns live queue/Meta readiness before selected body hydration. | Meta/readiness and body hydration are independent owners; boot is the cache-world fence. | `ChannelFeedRuntime.prepareLocalReplica` / `resumeLocalReplica` + Replica cache. | Seed a cached row, destroy/recreate the same principal, then inspect the retained cursor with no body requirement. | The Round 26 fixture used different implicit boots, so the cache world was intentionally cleared. The successor names the same boot on both attaches and keeps focus/body hydration out of the Meta assertion; `{ c0: 100 }` is restored while body rows remain absent. | **PASS — fixture migration.** Evidence: [`blocked-round27-fixture-recovery.test.jsx`](../tests/blocked-round27-fixture-recovery.test.jsx:188). |
| AD-192 | The user selector accepts only registered, present human principals. | Agent and retired principals cannot become human targets. | `ChannelMembers` selector in `GovernanceFeature`. | Render present human, present Agent, and retired human principals and inspect selector options. | The current public selector maps every `port.principals` row to `· 用户`; direct public evidence includes the Agent and retired human, so filtering is absent at the owner boundary. | **BLOCKED — product capability gap at Governance owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:387). |
| AD-193 | Successful creation separately converges ledger, OBS, membership, and serving. | Receipt cannot replace membership/serving convergence. | `ChannelOverview` / `GovernanceFeature` status and child projection. | Submit child creation and inspect a serving-ready fact only after all four sources converge. | The current owner exposes operation status and child list only; no serving-ready fact is projected. | **BLOCKED — product capability gap at Governance owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:403). |
| AD-194 | Member operations distinguish ledger terminal from roster convergence. | A terminal receipt cannot fabricate roster readiness. | `ChannelMembers` refresh/roster projection. | Refresh after a member operation and inspect a separate member-ready fact. | The public owner has roster rows and a refresh command but no member-ready convergence fact. | **BLOCKED — product capability gap at Governance owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:412). |
| AD-195 | A compact closure preserves ledger lifecycle without declaring missing business result ready. | Unavailable business detail cannot be treated as success. | `ChannelAdministrationPanel` / `OperationState`. | Render a submitted/completed ledger closure without business result and inspect unavailable status. | The current status remains the supplied ledger message; no unavailable-result terminal is synthesized. | **BLOCKED — product capability gap at Governance owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:425). |
| AD-196 | A rejected compact closure remains observable as a failed operation without guessing its reason. | Failed and unavailable-result facts remain distinct. | `ChannelOverview` → `useCommand` operation/error status. | Submit creation through a rejecting public command port and inspect the failed terminal. | The Round 26 fixture started on the default Members tab, so it never reached the create action. The successor selects the public 概览 tab first, submits the same child-create action, and observes `wire closed` in both status and alert. | **PASS — fixture migration.** Evidence: [`blocked-round27-fixture-recovery.test.jsx`](../tests/blocked-round27-fixture-recovery.test.jsx:216). |
| AD-197 | Missing compact result detail is a stable unavailable terminal, not a ready state. | A command receipt cannot infer missing business detail. | `ChannelAdministrationPanel` / `OperationState`. | Render a completed operation with no result body and inspect unavailable terminal. | The current status displays the supplied `已完成`/ledger message and has no unavailable terminal. | **BLOCKED — product capability gap at Governance owner.** Evidence: [`blocked-round26-public-owner.test.jsx`](../tests/blocked-round26-public-owner.test.jsx:442). |

## Ledger/category delta

The three migrated rows are removed from `BLOCKED`; no other row is deleted or
skipped. For the current owner quantification, the ten unresolved rows with a
direct public owner and a reproduced non-equivalent result move from the
fixture-evidence bucket to `CAPABILITY_GAP`: AD-037, AD-156, AD-159, AD-160,
AD-161, AD-192–AD-195, and AD-197. The seven no-owner rows remain
`OWNER_MISSING`. The resulting global ledger counts are:

| Category | Before Round 27 | Round 27 delta | After Round 27 |
|---|---:|---:|---:|
| `OWNER_MISSING` | 12 | 0 | 12 |
| `FIXTURE_MISSING` | 24 | −3 promotions −10 owner reclassifications | 11 |
| `CAPABILITY_GAP` | 10 | +10 reclassifications | 20 |
| **BLOCKED total** | **46** | **−3** | **43** |

This is evidence triage, not an obsolescence verdict. The ten product gaps are
returned to their named owners with the exact first divergence above; the
seven no-owner rows remain unresolved until a public owner is assigned.

## Boundary audit

Round 27 changes only
[`tests/blocked-round27-fixture-recovery.test.jsx`](../tests/blocked-round27-fixture-recovery.test.jsx),
this report, and the A–D case ledger/verification/quantification reports. It
does not modify Feed, Replica, Waiting, Reading, Workspace, Governance
product source, vendor, package manifests, lockfiles, private exports, or
compatibility APIs. The Round 26 ordinary-red packet remains intact as
reproduction evidence for all unresolved cases. No baseline declaration was
deleted, skipped, merged, or converted to expected-fail semantics.
