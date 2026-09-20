# A–D blocked evidence packet — Round 29 (2026-09-20)

Round 29 selects ten still-`BLOCKED` rows that now have a named public owner
and a reproducible capability gap. This packet deliberately does **not** add a
second ordinary-red declaration: each row below points to the existing
independent public-owner assertion in the Round 24 or Round 25 test file. The
current ledger therefore stays **322 PASS / 0 REGRESSION / 43 BLOCKED**.

The focused command was:

```text
npx vitest run tests/blocked-round24-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx \
  -t '\[AD-(170|182|202|203|256|257|284|291|292|316)\]' --reporter=verbose
```

Current result: **2 files failed; 10 selected tests failed; 30 tests skipped**.
The ten failures are ordinary red evidence, not expected-fail completion. No
fixture-only recovery was found in this selection, no capability was declared
obsolete, and no product file was changed.

## Case-level packets

| Case | User capability | Invariant | Current public owner | Baseline action / expected result | Current result and evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-170 | After a current-channel permission probe is forbidden, the user must not continue seeing a stale cached row. | Access revocation and Replica projection cleanup share the same channel/generation boundary. | `ChannelFeedRuntime.refreshChannel` → `ChannelReplica` | Admit one cached row, settle a forbidden `channelMeta` probe, then expect the channel to be detached and its row set empty. | **Red:** `stateFor('c0').rows.size` is `1`, not `0`; `tests/blocked-round25-public-owner.test.jsx:340`. | `CAPABILITY_GAP/BLOCKED`; product owner packet. |
| AD-182 | A terminal-first history result remains closed after bounded suffix pressure and an older refill; it must not regress to Waiting. | Replica trimming preserves compact terminal closure across paging/epoch pressure. | `ChannelFeedRuntime.loadHistory/pageEnd` → `ChannelReplica` | Admit terminal seq 460, pressure the bounded suffix with seq 429–459 and live tail rows, then refill older seq 100/101; expect row 460 to be compacted and the turn to retain `terminalClosureOnly`. | **Red:** row 460 remains in the materialized rows (`expected false, received true`); `tests/blocked-round25-public-owner.test.jsx:358`. | `CAPABILITY_GAP/BLOCKED`; product owner packet. |
| AD-202 | When a node has an available update, the user sees one bottom-left confirmation-gated update action. | Node update availability and confirmation must come from one explicit update owner; `VersionIncompatible` is not an update UI. | `WorkspaceLayout.navigation.update` (current public boundary; no mounted node-update product owner) | Render `WorkspaceLayout` with `current_version=v0.06`, `latest_version=v0.07`, `available=true`, `status=idle`; expect `升级到 v0.07`. | **Red:** no accessible update button is rendered; `tests/blocked-round24-public-owner.test.jsx:481`. | `CAPABILITY_GAP/BLOCKED`; missing product capability at the named boundary. |
| AD-203 | During update execution the same action is disabled/progress-aware, and after success the current node version is visible. | Progress, success, and version facts must be emitted by the same public node-update owner. | `WorkspaceLayout.navigation.update` (current public boundary; no mounted node-update product owner) | Render a succeeded update with `current_version=v0.07`, `available=false`; expect the `Atoll v0.07` version title. | **Red:** no version title/progress surface is rendered; `tests/blocked-round24-public-owner.test.jsx:493`. | `CAPABILITY_GAP/BLOCKED`; missing product capability at the named boundary. |
| AD-256 | After refresh/remount, control state is restored only for the same principal and an in-flight send becomes explainably uncertain. | Durable control recovery is principal-scoped; `sending` cannot be presented as confirmed after remount. | `useComposerSubmissionRuntime` and its public submission/control port | Cancel `c0/request-1`, unmount, remount the same harness, and expect the restored control state to be `{state: 'uncertain'}`. | **Red:** the restored state is `undefined`; `tests/blocked-round24-public-owner.test.jsx:505`. | `CAPABILITY_GAP/BLOCKED`; reclassified from owner-missing because the public hook is the first owner boundary. |
| AD-257 | A failed control operation remains explainable after refresh; raw `Error` objects must become serializable control errors. | The durable control boundary stores only active state and serializable error data. | `useComposerSubmissionRuntime` and its public submission/control port | Reject cancel with `{code:'closed', message:'连接关闭'}` and expect `{code:'closed', detail:'连接关闭'}` in the control state. | **Red:** the state retains the raw `Error` object (`Error: 连接关闭`), not the serializable record; `tests/blocked-round24-public-owner.test.jsx:521`. | `CAPABILITY_GAP/BLOCKED`; reclassified from owner-missing because the public hook is the first owner boundary. |
| AD-284 | Acknowledging only visible notification identities leaves an unvisited sibling unread. | Sparse identity acknowledgements cannot collapse into a boundary/high-water acknowledgement. | `ChannelFeedRuntime.acknowledgeNotifications` → `unreadFor` | Enqueue visible seq 1/3 and unvisited seq 2, acknowledge the visible identity set through seq 3, and expect one related unread sibling. | **Red:** `unreadFor('c0', SELF).related` is `0`, not `1`; `tests/blocked-round25-public-owner.test.jsx:425`. | `CAPABILITY_GAP/BLOCKED`; product owner packet. |
| AD-291 | The user sees a narrow “related to me” unread count alongside a weak all-message channel count. | Related and total unread projections remain distinct and scoped; one root set cannot stand in for both. | `ChannelFeedRuntime.unreadFor` | Enqueue an unread row addressed to another audience; expect `related=0` but `total>0`. | **Red:** both counts are `0`; `tests/blocked-round25-public-owner.test.jsx:438`. | `CAPABILITY_GAP/BLOCKED`; product owner packet. |
| AD-292 | A readable terminal response from an agent self-audience task wakes the user, while queued/processing progress does not. | Notification policy excludes progress states but retains terminal user content in the Replica projection. | `ChannelFeedRuntime.unreadFor` + `ChannelReplica` notification policy | Enqueue request, queued, and processing rows for an agent’s self-audience task, then a terminal row with `finished work`; expect `{related:0,total:1}` only after terminal content. | **Red:** terminal content leaves `{related:0,total:0}`; `tests/blocked-round25-public-owner.test.jsx:448`. | `CAPABILITY_GAP/BLOCKED`; product owner packet. |
| AD-316 | After `create_device` reaches terminal, the visible device list is refreshed from the authoritative projection. | A command receipt is not the device projection; the terminal boundary must trigger one refresh. | `SpaceAdministrationPanel` → `SpaceDevices` `space.commands` port | Submit `create_device` for `laptop`, then expect the injected public `refresh` command exactly once. | **Red:** submit is observed but `refresh` is called `0` times; `tests/blocked-round24-public-owner.test.jsx:538`. | `CAPABILITY_GAP/BLOCKED`; reclassified from fixture-missing because the public device owner and terminal action are directly exercised. |

## Classification and handoff

- AD-170, AD-182, AD-202, AD-203, AD-284, AD-291, and AD-292 were already
  direct capability-gap rows with public owners. This packet makes their
  user-visible capability, invariant, boundary, action, and current result
  independently inspectable without manufacturing another red test source.
- AD-256 and AD-257 use the existing public `useComposerSubmissionRuntime`
  hook. The hook is a current owner boundary even though durable
  principal-scoped recovery and serializable errors are not implemented; they
  are therefore `CAPABILITY_GAP`, not `OWNER_MISSING`.
- AD-316 uses the existing public `SpaceDevices` command port. Its missing
  post-terminal refresh is a direct non-equivalent behavior, not merely an
  absent fixture; it is therefore `CAPABILITY_GAP`, not `FIXTURE_MISSING`.
- No case is promoted. The exact product handoff for each row is the minimal
  reproduction above, the baseline expectation, and the first public owner
  boundary where the behavior diverges. Product work remains with the owner
  of that boundary; this test worker did not edit product code.

## Boundary proof

Round 29 changes this report and the corresponding A–D audit/ledger reports
only. It does not add a duplicate ordinary-red test, change `src`, vendor,
package or lock files, export a private helper, add a compatibility API, delete
or skip a baseline case, or weaken an assertion. The existing ordinary-red
assertions remain the executable regression sources; this packet is the
case-level handoff for the ten selected rows.
