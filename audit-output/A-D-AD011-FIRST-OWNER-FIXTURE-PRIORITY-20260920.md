# A–D AD-011 first-owner trace and fixture recovery priority (2026-09-20)

This packet is read-only diagnosis for AD-011 and a recovery ordering for the
100 rows previously classified as `FIXTURE_MISSING` in
[`A-D-AD011-AD143-BLOCKED-QUANTIFICATION-20260920.md`](./A-D-AD011-AD143-BLOCKED-QUANTIFICATION-20260920.md).
It does not change product code or reclassify any baseline case.

This packet was re-audited after notification-owner commit `77760c8`
(`fix(notification): require frozen owner receipts`). That commit adds and
invalidates `followingObservations` for the notification contract; it does not
retain or settle `activityEntries`. The AD-011 first divergent owner and the
same-boot reconnect result are therefore unchanged. The line references below
use the post-`77760c8` source.

## AD-011 first divergent owner

The first owner that destroys the evidence is
`ChannelFeedRuntime.setHistoryGrants()` at
`src/model/channel-feed-runtime.js:805-810`:

```text
for (const [key, entry] of activityEntries) {
  if (entry.state !== 'active' || entry.generation === generation) continue;
  activityEntries.delete(key);
}
```

This runs after the new generation and boot have been accepted, but before the
history terminal is admitted. It removes the only retained active entry that
the terminal could settle. The later owners are observers of the loss, not its
cause:

| Boundary | Current public operation | AD-011 observation |
|---|---|---|
| `ChannelFeedRuntime.applyRows` → `observeAgentActivity` (`:434-511`, `:284-321`) | commits each accepted row, then observes activity | the history terminal is accepted by Replica, but `observeAgentActivity` finds no `current` entry and returns `false` |
| `observeAgentActivity` (`:284-321`) | live processing creates/updates; terminal settles an existing entry | terminal settlement requires an existing `(channelId, requestId)` entry; it does not create activity from history |
| `agentActivitySnapshot` (`:348-371`) | projects active current-generation and settled entries | it would include a retained entry once settled; with the entry deleted, `byChannel` is empty |
| `buildSnapshot` / `useFeedOwner` (`:1054-1083`, `WorkspaceApp.jsx:85-117`) | publishes through `useSyncExternalStore` | publishes the empty `byChannel` map faithfully |
| `WorkspaceApp` / `WorkspaceLayout` / `ConversationSurface` (`WorkspaceApp.jsx:674-704, :1038-1059`; `WorkspaceLayout.jsx:37-70`) | filters and renders activity | no channel row or settled-agent acknowledgement exists to render; these consumers do not invent a row |

### Concrete public trace

The existing public runtime factory was exercised without private imports:

| Stage | `generation` / `boot` | `connected` | Public `agentActivity.byChannel` |
|---|---|---|---|
| grant | `1 / boot-a` | `true` | `{}` |
| live processing | `1 / boot-a` | `true` | `c0.active` with `agent:codex:1` |
| `disconnectHistory()` | `0 / boot-a` | `false` | `{}` (old active is hidden, not yet externally visible) |
| same-boot generation 2 grant | `2 / boot-a` | `true` | `{}` (the active entry has been deleted at `setHistoryGrants`) |
| generation-2 history terminal | `2 / boot-a` | `true` | `{}`; `revision` does not advance |
| boot change | `3 / boot-b` | `true` | `{}` (clearing is correct here) |

The companion control trace confirms the boundary: a history-only processing
row remains ignored, then a live generation-2 processing row creates a fresh
active entry, and a later history terminal settles that fresh entry. Thus the
missing behavior is specifically retained-work settlement across a same-boot
reconnect, not permission to resurrect arbitrary history activity.

## Minimal product interface contract

No private tracker or helper needs to be exported. The smallest compatible
contract is an extension of the existing public runtime lifecycle:

1. `disconnectHistory(generation)` hides current-generation activity and marks
   the connection unavailable, but retains same-boot active entries as
   **settleable retained work** keyed by `(boot, channelId, requestId, agentId)`.
2. `setHistoryGrants(entries, { generation, boot })` must distinguish a
   same-boot generation replacement from a world replacement. For same boot it
   keeps retained entries out of `active` while allowing a matching history
   terminal to transition one entry to `settled`.
3. A history terminal may settle only an entry that was previously admitted as
   live in the same boot. A history-only processing row must not create one.
4. A boot change, principal change, explicit clear, or incompatible session
   must drop all retained entries before accepting successor history. This is
   the anti-resurrection fence.
5. The existing public `agentActivity` snapshot remains the read boundary:
   after settlement it exposes `byChannel[channelId].agents[agentId]` with
   `state: 'settled'`; after acknowledgement it returns to an empty map. No
   new UI-facing private export or second activity store is needed.

The product acceptance matrix is therefore:

| Scenario | Required public result |
|---|---|
| live processing, current generation | one active entry and `state: active` |
| disconnect/reconnect, same boot, history terminal for retained request | one settled entry and `state: settled` |
| disconnect/reconnect, same boot, history-only processing | empty activity projection |
| same request receives live progress in successor generation | one current active entry; no duplicate retained row |
| boot/principal change, then old history terminal | empty projection; old work cannot resurrect |
| settled acknowledgement | settled entry removed and no stale channel bucket remains |

The minimal implementation choice is to change retention semantics inside the
existing runtime owner. Adding a compatibility export for the deleted tracker
would hide the owner boundary and is not part of this packet.

## 100 `FIXTURE_MISSING` rows ordered by recovery priority

Priority is recovery cost, not product importance. All 100 rows already name a
current public owner; these groups describe the safest order for building a
faithful public fixture, without claiming any row is obsolete.

| Priority | Count | Recovery rule | Baseline groups |
|---|---:|---|---|
| P0 — direct owner fixture | 10 | Small public-owner harness or focused projection fixture; no cross-surface lifecycle choreography | `agent-selection` 2; `atoll-session` 3; `capabilities` 4; `devices-panel` 1 |
| P1 — composed interaction fixture | 30 | Public event/DOM sequence across two or more current owners; preserve committed callback/command identity | `agent-control` 2; `agent-information-architecture` 4; `app-agent-probe-lifecycle` 1; `channel-governance` 7; `dynamic-f3` 16 |
| P2 — lifecycle/epoch/viewport fixture | 60 | Requires bounded reconnect, terminal-split handoff, Replica/cache epoch, or cursor/read authority setup; recover only after the public lifecycle fixture is frozen | `app-shell-terminal-split` 15; `channel-feed-startup` 18; `cursors` 27 |
| **Total** | **100** | Every row remains `BLOCKED/FIXTURE_MISSING` | — |

### Exact row membership

- **P0 (10):** `AD-057`, `AD-058`; `AD-125`–`AD-127`; `AD-138`–`AD-141`;
  `AD-316`.
- **P1 (30):** `AD-014`, `AD-017`; `AD-027`, `AD-034`, `AD-037`, `AD-039`;
  `AD-074`; `AD-191`–`AD-197`; `AD-327`–`AD-329`, `AD-331`, `AD-333`–`AD-338`,
  `AD-340`–`AD-343`, `AD-350`–`AD-351`.
- **P2 (60):** `AD-093`–`AD-102`, `AD-104`–`AD-108`; `AD-156`–`AD-161`,
  `AD-163`, `AD-165`–`AD-173`, `AD-178`, `AD-182`; `AD-277`–`AD-278`,
  `AD-282`–`AD-304`, `AD-306`–`AD-307`.

The order deliberately starts with cases whose named owner can be exercised
through a narrow public boundary, then moves to composed UI interactions, and
only then to high-cardinality epoch/cursor fixtures. No product source,
vendor, package, lockfile, private API, declaration deletion, or skip is part
of this packet.
