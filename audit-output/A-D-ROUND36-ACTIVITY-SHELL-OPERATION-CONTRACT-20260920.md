# A–D Round 36 — Activity Shell navigation and Operation projection

Date: 2026-09-20
Scope: A–D audit evidence only. No product file, Workspace owner, or test
fixture was changed in this packet.

## Case records

| Baseline case | User capability | Invariant | Current public owner | Baseline action/result | Current result and disposition |
|---|---|---|---|---|---|
| `TC-0193 F5-004 Activity 去重并返回 WorkItem 来源` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:70`) | From the global Activity center, a visible WorkItem can return to its channel and open the focused WorkItem detail. | A single Shell navigation owner must select the channel, view, and typed focus; Activity must not manufacture a second router. | `WorkspaceApp` navigation port → `useChannelNavigation` (`select`, `setActiveView`, `setFocus`). Activity rendering is `WorkspaceFeatures.ActivityFeature`. | Open Activity, click `Approve mock actionc0`, observe WorkItem detail and `#/channels/c0/tasks?focus=work_item/...`. | The route string is currently produced by `WorkspaceFeatures.activityRoute` and assigned through `globalThis.location.hash`; this can make the browser assertion pass while bypassing the Shell owner. Keep the architectural audit open; do not weaken the browser assertion or add a compatibility route. |
| `TC-0194 F5-004 创建操作进入 Operation Center 并可回到原频道回合` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:81`) | After a delayed channel creation, the user sees the creation operation in Operation Center and returns to the original `system.channel.create` turn. | An operation row is a durable, typed projection of request/ledger/OBS/membership/serving facts; a live-agent snapshot or transport receipt is not completion. The return target is a typed `turn` focus owned by Shell. | Projection boundary is `WorkspaceApp.activityPort`; navigation owner is `useChannelNavigation`. The current source is only `feed.agentActivity.byChannel[*].active`. | Reset `channel-governance-delay`, create `operation-room`, wait for ledger confirmation, close the modal, open Activity → Operations, click `创建频道 operation-room`, and observe the original turn and `c0` channel. | The current Activity port emits only `agentActivity.active` rows (`WorkspaceApp.jsx:1366-1389`). It has no `system.channel.create` request/terminal/OBS/membership/serving projection, so the operation row is not provable from the current public owner. Keep this case `BLOCKED` as a product-gap handoff; no expected-fail result is counted as completion. |

## First public divergence

The second route branch introduced by `45a8da5` is the `operation` branch at
`src/ui/features/WorkspaceFeatures.jsx:120-124`. It builds
`#/channels/<channel>/conversation?focus=turn:<requestId>`, and
`ActivityFeature.open` writes it directly at line 137. The WorkItem branch at
lines 115-119 uses the same second router. This bypasses the existing canonical
Shell owner in `src/app/hooks/useWireSession.js`: `select` (493-502),
`setActiveView` (503-508), and `setFocus` (509-515), which update state and write
the route through `history.pushState`.

This is not a request to change `WorkspaceFeatures` in this round. The current
owner contract is recorded below for the Activity/notification owner to
implement in its own product slice.

## Proposed typed Shell navigation port

Activity should receive one public command, not a hash string:

```js
activity.navigation.open({
  channelId: string,
  view: 'tasks' | 'conversation',
  focus: { type: 'work_item' | 'turn', key: string },
  source: 'activity-center',
}) -> boolean | Promise<boolean>
```

The Shell command must validate the canonical visible channel and focus before
accepting the request, then delegate to the existing navigation owner (select,
setActiveView, setFocus). It must return `false` or a typed error when the
channel/read access/focus is unavailable. Activity closes only after acceptance.
For a WorkItem the request is `{view: 'tasks', focus: {type: 'work_item', key}}`;
for an operation it is `{view: 'conversation', focus: {type: 'turn', key: requestId}}`.
No caller may pass an arbitrary hash, and Activity must retain its existing
`commands.open(source)` fallback only for rows with no canonical typed target.

## Proposed typed Operation projection port

The Activity port needs a durable projection distinct from
`feed.agentActivity.active`:

```js
{
  key: string,
  kind: 'operation',
  operationId: string,
  requestId: string,
  channelId: string,
  channelName?: string,
  title: string,
  state:
    | 'accepted'
    | 'ledger_pending'
    | 'ledger_completed'
    | 'observable_pending'
    | 'membership_pending'
    | 'serving_pending'
    | 'ready'
    | 'failed',
  detail?: string,
  updatedAt: number,
  source: {
    channelId: string,
    view: 'conversation',
    objectType: 'turn' | 'operation',
    objectId: string,
    requestId: string,
  },
}
```

For `system.channel.create`, the owner must correlate one request through the
transport receipt and terminal result, then independently project the target
OBS channel, membership relationship, and `open=true` serving fact. The mock
backend already returns `{channel_id}` in a completed terminal response and
closes sockets after membership changes (`mock/server.mjs:1055-1064`); the
delayed scenario uses `obs_ms: 700` (`mock/scenarios.mjs:88-90`). The product
contract therefore requires retaining partial facts through
`accepted → ledger_completed → observable → membership_visible → serving →
ready`, matching `docs/PHASE-D.md:35,41-49`, rather than treating the live
activity snapshot as the operation ledger.

`operationsUnavailable` must be true whenever the typed projection owner has no
current authoritative projection. No cached or fabricated Operation row may be
shown. The existing `operationsUnavailable:
feed.agentActivity?.connected !== true` is insufficient for TC-0194 because it
describes live agent activity connectivity, not governance convergence.

## Evidence and disposition

- Read-only source trace: `45a8da5` (`WorkspaceFeatures.activityRoute` and the
  direct `globalThis.location.hash` assignment).
- Read-only current owner trace: `WorkspaceApp.activityPort` builds Operations
  solely from `feed.agentActivity.byChannel[*].active`.
- Read-only backend trace: `system.channel.create` returns terminal
  `channel_id`; delayed OBS/membership convergence is represented independently.
- No test was deleted, skipped, weakened, or converted to expected-fail.
- `TC-0193` remains behaviorally covered but has an owner-boundary audit.
- `TC-0194` remains `BLOCKED` pending the typed Operation projection and Shell
  navigation owner; it is not declared obsolete and is not promoted to PASS.
