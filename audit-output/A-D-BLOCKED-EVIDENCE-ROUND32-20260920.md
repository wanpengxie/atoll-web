# A–D blocked evidence packet — Round 32 (2026-09-20)

Round 32 selects ten non-Governance `CAPABILITY_GAP` rows with existing public
owners: AD-093/097/099/105/106/108, AD-170/182, and AD-256/257. Governance
rows remain deferred while the new owner candidate is pending. This packet
adds no test declaration; it reuses the existing ordinary-red public-owner
assertions as the unique executable source:

```text
npx vitest run tests/blocked-round24-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx \
  -t '\[AD-(093|097|099|105|106|108|170|182|256|257)\]' --reporter=dot
```

Current result: **2 files failed; 10 selected tests failed; 30 tests skipped**.
All ten are ordinary-red evidence, not expected-fail completion. No selected
case recovers to PASS; the ledger remains **324 PASS / 0 REGRESSION / 41
BLOCKED**. No capability is judged obsolete and no product source is changed.

## Case-level packets

| Case | Previous user capability | Invariant | Current public owner | Baseline action / expected result | Current result and evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-093 | The user can open the recent-reading drawer from the terminal/channel edge. | Reading entry and focus restoration have one public owner; terminal layout must expose the entry. | `WorkspaceLayout` terminal/navigation composition | Render the committed channel and expect `打开最近阅读`. | **Red:** no `打开最近阅读` button is rendered; `tests/blocked-round25-public-owner.test.jsx:514`. | `CAPABILITY_GAP/BLOCKED`; existing WorkspaceLayout owner gap. |
| AD-097 | A fast reselect of the committed channel cancels an uncommitted target. | Navigation handoff is latest-wins and emits the latest committed selection. | `WorkspaceLayout` terminal/navigation composition | Click `c1`, immediately reselect `c0`; expect `nav.select` calls `['c1', 'c0']`. | **Red:** only `['c1']` is emitted; `tests/blocked-round25-public-owner.test.jsx:523`. | `CAPABILITY_GAP/BLOCKED`; existing WorkspaceLayout owner gap. |
| AD-099 | An invalid selected target rolls back to the original channel and ends stale pending handoff. | Invalid-target rollback restores the last committed identity. | `WorkspaceLayout` terminal/navigation composition | Select an invalid target after `c0`; expect the committed `c0` heading. | **Red:** no `c0` heading is exposed after the invalid target; `tests/blocked-round25-public-owner.test.jsx:539`. | `CAPABILITY_GAP/BLOCKED`; existing WorkspaceLayout owner gap. |
| AD-105 | Rapid A→B→A navigation hands focus only to the latest target. | Stale pending focus cannot overwrite the latest committed selection. | `WorkspaceLayout` terminal/navigation composition | Select `c1`, then `c0`; expect `nav.select` calls `['c1', 'c0']`. | **Red:** only `['c1']` is emitted; `tests/blocked-round25-public-owner.test.jsx:548`. | `CAPABILITY_GAP/BLOCKED`; existing WorkspaceLayout owner gap. |
| AD-106 | Leaving and returning to a channel preserves that channel's terminal split. | Terminal visibility is retained per channel across leave/return. | `WorkspaceLayout` terminal/navigation composition | Open a terminal split, leave, return, and expect the terminal panel visible. | **Red:** returned terminal panel state is not retained; `tests/blocked-round25-public-owner.test.jsx:565`. | `CAPABILITY_GAP/BLOCKED`; existing WorkspaceLayout owner gap. |
| AD-108 | Closing one channel's split does not close another channel's split. | Terminal visibility is channel-scoped, not one global toggle. | `WorkspaceLayout` terminal/navigation composition | Open splits for separate channels, close one, and expect the other visible. | **Red:** other-channel panel visibility is not preserved; `tests/blocked-round25-public-owner.test.jsx:583`. | `CAPABILITY_GAP/BLOCKED`; existing WorkspaceLayout owner gap. |
| AD-170 | A forbidden current-channel probe removes stale cached rows from the user-visible projection. | Access revoke and Replica cleanup share one channel/generation boundary. | `ChannelFeedRuntime.refreshChannel` → `ChannelReplica` | Admit a cached row, settle a forbidden `channelMeta` probe, and expect detached state with zero rows. | **Red:** detached state still has one cached row (`rows.size === 1`); `tests/blocked-round25-public-owner.test.jsx:354`. | `CAPABILITY_GAP/BLOCKED`; existing Feed/Replica owner gap. |
| AD-182 | A terminal-first turn remains closed after bounded suffix pressure and older refill. | Replica trimming preserves compact terminal closure across paging/epoch pressure. | `ChannelFeedRuntime.loadHistory/pageEnd` → `ChannelReplica` | Admit terminal seq 460, pressure the suffix, refill older rows, and expect row 460 compacted. | **Red:** row 460 remains materialized (`rows.has(460) === true`); `tests/blocked-round25-public-owner.test.jsx:402`. | `CAPABILITY_GAP/BLOCKED`; existing Feed/Replica owner gap. |
| AD-256 | Refresh/remount restores control state only for the same principal and converts in-flight sending to uncertain. | Durable control recovery is principal-scoped; remount cannot present sending as confirmed. | `useComposerSubmissionRuntime` public submission/control port | Cancel a request, unmount/remount the same principal, and expect restored `{state: 'uncertain'}`. | **Red:** restored control state is `undefined`; `tests/blocked-round24-public-owner.test.jsx:516`. | `CAPABILITY_GAP/BLOCKED`; existing Composer control owner gap. |
| AD-257 | A failed control operation remains explainable after refresh using serializable error data. | Durable control state stores active facts and serializable error records, not raw `Error` objects. | `useComposerSubmissionRuntime` public submission/control port | Reject cancel with `{code:'closed', message:'连接关闭'}` and expect `{code:'closed', detail:'连接关闭'}`. | **Red:** state retains raw `Error: 连接关闭` with `code`, not the serializable record; `tests/blocked-round24-public-owner.test.jsx:530`. | `CAPABILITY_GAP/BLOCKED`; existing Composer control owner gap. |

## Classification and handoff

- These ten rows have named public owners and remain direct non-equivalent
  behavior at those owners. They stay `CAPABILITY_GAP/BLOCKED`; no row moves to
  `OWNER_MISSING` or `FIXTURE_MISSING`.
- No new red test was added. The Round 24/25 ordinary assertions remain the
  unique evidence sources; no `it.fails`, skip, weakened expectation, private
  export, old store, or compatibility API was introduced.
- No green recovery was found, so PASS remains 324 and BLOCKED remains 41.
  Product owners receive the exact public boundary, expected capability, and
  observed result above.

## Boundary proof

Round 32 changes only this case-level A–D evidence report and the corresponding
A–D audit/ledger references. It does not modify Workspace, Feed, Replica,
Composer, Governance, Reading, vendor, package, lock files, private exports,
or baseline declarations. Governance rows remain deferred pending a new owner
candidate.
