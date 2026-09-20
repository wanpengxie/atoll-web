# A–D blocked evidence packet — Round 30 (2026-09-20)

Round 30 selects ten rows that were still classified as `FIXTURE_MISSING`,
without repeating an ordinary-red declaration. Two cursor rows now have
faithful current public fixtures; the other eight rows are rechecked through
their existing public-owner red assertions and are classified as real
capability gaps. No row is declared obsolete, deleted, skipped, or completed
from a red result. The ledger changes from **322 PASS / 0 REGRESSION / 43
BLOCKED** to **324 PASS / 0 REGRESSION / 41 BLOCKED**.

The new green fixture is:

```text
npx vitest run tests/blocked-round30-fixture-recovery.test.jsx --reporter=verbose
```

Current result: **1 file passed; 2 tests passed; 0 failed**. AD-306 and
AD-307 are the only rows promoted in this packet.

The eight existing public-owner assertions were re-run without adding a
second red source:

```text
npx vitest run tests/blocked-round24-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx \
  -t '\[AD-(093|097|099|105|106|108|331|334)\]' --reporter=dot
```

Current result: **2 files failed; 8 selected tests failed; 32 tests skipped**.
These are ordinary-red product evidence, not expected-fail completion. The
eight rows remain `BLOCKED` and move from `FIXTURE_MISSING` to
`CAPABILITY_GAP`.

## Case-level packets

| Case | User capability | Invariant | Current public owner | Baseline action / expected result | Current result and evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-093 | The user can open the recent-reading drawer from the terminal/channel edge and return focus to the reading surface. | Reading entry and focus restoration have one public owner; terminal layout must expose the entry rather than silently omit it. | `WorkspaceLayout` terminal/navigation composition at the current public boundary | Render the committed channel with the terminal edge and expect the `打开最近阅读` entry. | **Red:** no `打开最近阅读` button is rendered; `tests/blocked-round25-public-owner.test.jsx:514` (case declaration/evidence anchor `:511`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-097 | A fast reselect of the committed channel cancels an uncommitted target and leaves the latest user choice authoritative. | Selection handoff is latest-wins and emits one committed navigation sequence. | `WorkspaceLayout` terminal/navigation composition | Click `c1`, then immediately reselect `c0`; expect `nav.select` calls `['c1', 'c0']`. | **Red:** only `['c1']` is emitted; `tests/blocked-round25-public-owner.test.jsx:523` (case declaration/evidence anchor `:517`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-099 | If a selected target becomes invalid, the user returns to the original channel and the stale pending handoff ends. | Invalid-target rollback restores the last committed channel identity and clears pending navigation. | `WorkspaceLayout` terminal/navigation composition | Select an invalid target after `c0`; expect the committed `c0` heading after rollback. | **Red:** no `c0` heading is exposed after the invalid target; `tests/blocked-round25-public-owner.test.jsx:539` (case declaration/evidence anchor `:526`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-105 | A rapid A→B→A sequence hands focus/navigation only to the latest user target. | Stale pending focus cannot overwrite the latest committed selection. | `WorkspaceLayout` terminal/navigation composition | Select `c1`, then `c0`; expect `nav.select` calls `['c1', 'c0']`. | **Red:** only `['c1']` is emitted; `tests/blocked-round25-public-owner.test.jsx:548` (case declaration/evidence anchor `:542`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-106 | Leaving and returning to a channel preserves that channel's terminal split. | Terminal visibility is retained per channel across leave/return, not only for the currently mounted route. | `WorkspaceLayout` terminal/navigation composition | Open the terminal split, leave the channel, return, and expect the terminal panel to remain visible. | **Red:** terminal panel state is not retained across the return; `tests/blocked-round25-public-owner.test.jsx:565` (case declaration/evidence anchor `:551`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-108 | Closing one channel's split does not close another channel's split. | Terminal visibility is channel-scoped and cannot be replaced by one global toggle. | `WorkspaceLayout` terminal/navigation composition | Open splits for separate channels, close one, and expect the other channel's terminal panel to remain visible. | **Red:** the panel visibility is not preserved for the other channel; `tests/blocked-round25-public-owner.test.jsx:583` (case declaration/evidence anchor `:568`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-306 | Duplicate terminal frames for one request produce one unread root. | The public unread projection deduplicates by stable root identity and does not rebuild a second notification for each terminal frame. | `ChannelFeedRuntime.unreadFor` → `ChannelReplica` canonical rows | Enqueue one request and two terminal frames for the same root, then expect `{related: 1, total: 1}`. | **Green:** `tests/blocked-round30-fixture-recovery.test.jsx:111-123`; the public projection returns exactly one unread root. | `PASS`; faithful public fixture recovery from `fae8b70:cursors.test.js:720`. |
| AD-307 | After reading through seq 100, a late older history page does not re-notify old rows while live seq 101/102 remain unread. | Acknowledgement boundary is independent of physical arrival order; only roots after the boundary remain in the unread projection. | `ChannelFeedRuntime.acknowledgeNotifications` → `unreadFor` | Enqueue live 100/101, install history 1–99, enqueue live 102, acknowledge boundary 100, and expect two unread roots. | **Green:** `tests/blocked-round30-fixture-recovery.test.jsx:125-147`; the public projection returns `{related: 2, total: 2}`. | `PASS`; faithful public fixture recovery from `fae8b70:cursors.test.js:734`. |
| AD-331 | Desktop users can copy a reply; on touch, a short press replies and a long press copies without cross-triggering. | Reply and copy gestures are mutually exclusive while each remains available through the public presentation owner. | `ConversationPresentation` + Composer public interaction ports | Exercise desktop copy, touch short press, and touch long press; expect one reply callback for the short press and one copy action for the long press. | **Red:** touch short press calls `onReply` zero times; `tests/blocked-round24-public-owner.test.jsx:574` (case declaration/evidence anchor `:558`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |
| AD-334 | Turn detail exposes audit identifiers without serializing private payload JSON. | Audit identifiers are user-visible metadata while body/payload data remains redacted. | `ConversationPresentation` + Composer public turn-detail owner | Open turn detail and expect `audit-202`, while excluding `must-not-render` payload content. | **Red:** detail text does not contain `audit-202`; `tests/blocked-round24-public-owner.test.jsx:595` (case declaration/evidence anchor `:582`). | `CAPABILITY_GAP/BLOCKED`; existing public-owner product-gap packet. |

## Classification and handoff

- AD-306 and AD-307 recover the two cursor fixture rows using only the public
  `ChannelFeedRuntime` snapshot. The old fold/index implementation oracle is
  not imported or re-exposed; the successor verifies the user-visible unread
  behavior at the current `ChannelReplica` owner.
- AD-093/097/099/105/106/108 have a named `WorkspaceLayout` public owner, but
  its current composition is non-equivalent for drawer entry, latest-wins
  rollback, and channel-scoped terminal persistence. They are therefore
  capability gaps rather than missing fixtures.
- AD-331 and AD-334 have named `ConversationPresentation`/Composer public
  owners, but touch reply and audit-identifier rendering are non-equivalent.
  They remain product handoffs, not duplicate red tests.
- No capability is judged obsolete. Each red result is preserved as the
  minimal reproduction for the first public owner boundary; product work stays
  with that owner and was not performed in this test packet.

## Boundary proof

Round 30 changes only `tests/blocked-round30-fixture-recovery.test.jsx` and
the corresponding A–D audit/ledger reports. It does not modify Feed,
Workspace, Reading, Composer, or any other product source; vendor, package,
lock files, private exports, compatibility APIs, and baseline declarations are
unchanged. No test is deleted, skipped, weakened, or converted to
expected-fail semantics. Existing Round 24/25 red assertions remain the
executable regression sources for the eight capability gaps.
