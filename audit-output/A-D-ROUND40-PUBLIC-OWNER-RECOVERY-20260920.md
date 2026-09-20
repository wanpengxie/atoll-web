# A–D Round 40 — public-owner recovery batch (2026-09-20)

Round 40 selects the next ten still-BLOCKED contracts with executable public
owners: AD-170, AD-182, AD-284, AD-291, AD-292, AD-316, AD-331, AD-334,
AD-363, and AD-364. It reuses the existing ordinary assertions as the unique
case evidence; no duplicate red declaration or expected-fail result is added.

## Focused verification

```text
npx vitest run tests/blocked-round24-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx --reporter=dot \
  -t '\\[AD-(170|182|284|291|292|316|331|334|363|364)\\]'

Test Files  2 failed (2)
Tests       9 failed | 1 passed | 30 skipped (40)

npx vitest run tests/blocked-round24-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-316\\]'

Test Files  1 passed (1)
Tests       1 passed | 19 skipped (20)
```

The skipped rows are the file's unrelated declarations caused by the focused
selector; none of the ten selected rows is skipped. The canvas `getContext`
message is existing jsdom noise and did not affect these assertions.

## Case-level contract records

| Case | User capability | Invariant | Current public owner | Baseline action / expected result | Current result / evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-170 | After a forbidden current-channel probe, stale cached rows disappear from the visible channel. | Access revoke and Replica cleanup share one channel/generation boundary. | `ChannelFeedRuntime.refreshChannel` → `ChannelReplica` | Admit one cached row, settle `channelMeta` as forbidden, refresh, expect detached state with zero rows. | **Red:** detached state still has one cached row (`rows.size === 1`); `tests/blocked-round25-public-owner.test.jsx:340-354`. | `CAPABILITY_GAP/BLOCKED`; current Feed/Replica owner remains non-equivalent. |
| AD-182 | A terminal-first turn stays closed after bounded suffix pressure and older refill. | Replica trimming preserves compact terminal closure across paging/epoch pressure. | `ChannelFeedRuntime.loadHistory/pageEnd` → `ChannelReplica` | Admit terminal seq 460, pressure the suffix, refill older rows, expect `rows.has(460) === false`. | **Red:** row 460 remains materialized; `tests/blocked-round25-public-owner.test.jsx:358-402`. | `CAPABILITY_GAP/BLOCKED`; no product change. |
| AD-284 | Acknowledging visible notification identities leaves an unvisited sibling unread. | Sparse identity acknowledgement cannot collapse into a boundary/high-water acknowledgement. | `ChannelFeedRuntime.acknowledgeNotifications` → `unreadFor` | Enqueue visible seq 1/3 and unvisited seq 2, acknowledge visible identities, expect `related === 1`. | **Red:** `related === 0`; `tests/blocked-round25-public-owner.test.jsx:425-434`. | `CAPABILITY_GAP/BLOCKED`; current notification owner collapses the sibling. |
| AD-291 | The user sees weak all-message unread separately from the narrower `@me` count. | Related and total unread projections remain distinct and scoped. | `ChannelFeedRuntime.unreadFor` | Enqueue an unrelated public request, expect `related === 0` and `total > 0`. | **Red:** both counts are `0`; `tests/blocked-round25-public-owner.test.jsx:438-445`. | `CAPABILITY_GAP/BLOCKED`; no capability is declared obsolete. |
| AD-292 | Readable terminal content from an Agent self-audience task wakes the user. | Progress states do not notify, but terminal user content survives Replica notification folding. | `ChannelFeedRuntime.unreadFor` + `ChannelReplica` notification policy | Enqueue request/queued/processing then readable terminal content, expect `{ related: 0, total: 1 }`. | **Red:** result is `{ related: 0, total: 0 }`; `tests/blocked-round25-public-owner.test.jsx:448-466`. | `CAPABILITY_GAP/BLOCKED`; current notification policy is non-equivalent. |
| AD-316 | After `create_device` reaches terminal, the visible device list refreshes from the authoritative projection. | A command receipt cannot stand in for the device projection; terminal closure owns one refresh. | `SpaceAdministrationPanel` → `SpaceDevices` `space.commands` port | Submit `create_device` for `laptop`, expect the injected public `refresh` command once. | **Green:** `submit` receives the public command and `refresh` is called once; `tests/blocked-round24-public-owner.test.jsx:538-555`, focused **1/1 passed**. | **PASS:** current owner already supplies `refresh: 'devices'`; promote from BLOCKED. |
| AD-331 | Desktop copy works; touch short press replies and long press copies without cross-triggering. | Reply and copy gestures stay mutually exclusive over one message fact. | `ConversationPresentation` + Composer message-action port | Copy desktop text, short-press reply, long-press copy, expect one reply and two copies. | **Red:** touch short press calls `onReply` zero times; `tests/blocked-round24-public-owner.test.jsx:558-577`. | `CAPABILITY_GAP/BLOCKED`; current interaction owner lacks short-press reply. |
| AD-334 | Turn detail exposes audit identifiers without serializing private payload JSON. | Audit metadata is visible while payload content remains redacted. | `useTimelineRowRenderer` / `onOpenTurn` process-detail owner | Open process detail with `audit_id='audit-202'` and secret payload, expect audit id and no secret. | **Red:** callback receives the turn but rendered detail lacks `audit-202`; `tests/blocked-round24-public-owner.test.jsx:582-597`. | `CAPABILITY_GAP/BLOCKED`; no selector or private export was added. |
| AD-363 | Agent-declared JSON-Schema fields form a typed, validated command payload. | Capability-declared fields reach the public command owner rather than a fixed word list. | `buildComposerModel` / `createComposerCommandRequest` | Advertise `agent.custom-control` integer/boolean fields and submit `{ count: 3, enabled: true }`. | **Red:** public port throws `命令 /custom-control 当前不可用`; `tests/blocked-round24-public-owner.test.jsx:599-618`. | `CAPABILITY_GAP/BLOCKED`; Composer owner remains the handoff boundary. |
| AD-364 | Describe-advertised standard Agent control payloads remain sendable. | Payload closure comes from `describe`, not only the built-in slash-command table. | `buildComposerModel` / `createComposerCommandRequest` | Advertise `agent.replace.expected_hold_id`, submit the typed payload, expect no error. | **Red:** public port throws `命令 /replace 当前不可用`; `tests/blocked-round24-public-owner.test.jsx:620-638`. | `CAPABILITY_GAP/BLOCKED`; no compatibility path was introduced. |

## Ledger update and boundary proof

AD-316 is the only promoted row in this batch. The current A–D ledger is now
**327 PASS / 0 REGRESSION / 38 BLOCKED**; the nine ordinary-red rows remain
explicit product-gap evidence. No capability is obsolete, no expected-fail is
counted, and no baseline declaration is deleted or skipped.

Round 40 changes only this audit packet and the AD-316 row in
`RESTORE-CASES-A-D-20260919.md`; it does not modify product source, vendor,
package or lock files, private exports, compatibility APIs, or test semantics.
The existing public AD-316 assertion is the only executable recovery source.
