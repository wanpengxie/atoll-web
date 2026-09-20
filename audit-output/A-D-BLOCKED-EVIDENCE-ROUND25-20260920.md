# A–D Round 25 public-owner evidence (2026-09-20)

This packet continues the case-level ledger in
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md). It
rechecks the three requested Feed lifecycle fixes AD-157/158/167, also
re-verifies the now-fixed cursor rows AD-288/289, and adds fifteen ordinary
red cases without changing product code. The test file is
[`tests/blocked-round25-public-owner.test.jsx`](../tests/blocked-round25-public-owner.test.jsx).

All twenty declarations are independent public-owner cases. No `it.fails`,
skip, private export, compatibility owner, or weakened behavior assertion is
used. The five green rows are promoted only because their current public
contract is green; the fifteen ordinary red rows remain BLOCKED.

## Focused verification

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx --reporter=verbose

Test Files  1 failed (1)
Tests       5 passed | 15 failed (20)
```

Green rows: AD-157, AD-158, AD-167, AD-288, and AD-289. Ordinary red rows:
AD-170, AD-182, AD-284, AD-291, AD-292, AD-002, AD-003, AD-004, AD-093,
AD-097, AD-099, AD-105, AD-106, AD-108, and AD-149. The red rows remain
BLOCKED; they are reproducible owner/capability evidence rather than
completion signals.

## Case evidence

| ID | User capability | Invariant and current public owner | Baseline setup/action/observable result | Current result and disposition |
|---|---|---|---|---|
| AD-157 | A cache completion from an old boot cannot reappear in the replacement world. | Boot/Replica epoch fences cache admission; `ChannelFeedRuntime.enqueue` + `ChannelReplica`. | Prepare c0, replace boot, enqueue a c1 cache row, then inspect c1 rows and attach state. | **PASS**: the row is not materialized and c1 is detached. Promote to PASS; owner fix `fc7f692`. |
| AD-158 | In-flight hydration cannot land after c1 access is revoked. | Current attach grant set is the cross-channel cache boundary; `setHistoryGrants` + `enqueue`. | Attach c0/c1, revoke c1, enqueue a c1 cache row, then inspect c1 rows. | **PASS**: c1 remains detached and empty. Promote to PASS; owner fix `fc7f692`. |
| AD-167 | A revoked active channel is not probed; a later grant resumes exactly one probe. | Current grant generation/attached epoch admits `refreshChannel`; `channelMeta` wire port. | Revoke c0 and call refresh, regrant generation 2 and refresh, then revoke during a pending probe. | **PASS**: no revoked call, one regrant call, pending probe resolves `false`. Reconfirm PASS; owner fix `5c46b7c`. |
| AD-288 | Persisted cursor facts are usable only in the active principal/world. | Cursor restore is authority-scoped; `prepareLocalReplica` + `historyFor`. | Seed notification/read high-water 999 for the active principal/boot, attach a head-40 c0, inspect the public history projection. | **PASS**: notification high-water is 40 after authority selection and clamping. Promote to PASS; owner fix `ef67eaf`. |
| AD-289 | Restored future cursor facts cannot mark messages beyond the current head as read. | Restored high-water is bounded by the current ledger head; `historyFor`. | Seed high-water 999, attach c0 with head 40, inspect the public high-water. | **PASS**: high-water is at most 40. Promote to PASS; owner fix `ef67eaf`. |
| AD-170 | Forbidden convergence removes stale cached access from the user projection. | Access revoke and Replica projection must clear through one Feed owner; `refreshChannel` + `ChannelReplica`. | Enqueue a cached c0 row, make public `channelMeta` reject forbidden, refresh, inspect history and rows. | **RED**: status becomes detached/non-current but one cached row remains. Keep `CAPABILITY_GAP/BLOCKED`; first divergence is refresh/Replica cleanup. |
| AD-182 | Terminal-first history remains closed after suffix pressure and an older refill. | Bounded trim retains a compact terminal closure; `loadHistory`/`pageEnd` + Replica. | Load c0 history, insert seq 429–460 with a terminal at 460, add live tail 461–970, then refill older seq 100/101. | **RED**: terminal row 460 remains after pressure. Keep `CAPABILITY_GAP/BLOCKED`; first divergence is bounded Replica closure. |
| AD-284 | A sparse identity acknowledgement leaves an unvisited sibling unread. | Exact identity acknowledgement cannot collapse to boundary-only high-water; `acknowledgeNotifications`/`unreadFor`. | Enqueue visible roots at 1 and 3 plus an unvisited root at 2, acknowledge boundary 3, inspect related unread. | **RED**: related unread is 0 instead of 1. Keep `CAPABILITY_GAP/BLOCKED`; first divergence is notification acknowledgement. |
| AD-291 | Weak all-message unread remains distinct from narrower @me unread. | `related` and `total` use distinct notification projections; `ChannelFeedRuntime.unreadFor`. | Enqueue an unrelated public request and inspect both counters for SELF. | **RED**: both counters are 0. Keep `CAPABILITY_GAP/BLOCKED`; first divergence is `unreadFor`. |
| AD-292 | Readable terminal content from an agent self-audience task remains user-visible. | Queued/processing are non-notices, but terminal content must survive Feed/Replica folding; `unreadFor` + Replica. | Enqueue self-audience request, queued and processing responses, then a readable terminal and inspect counts. | **RED**: terminal leaves `{ related: 0, total: 0 }` instead of total 1. Keep `CAPABILITY_GAP/BLOCKED`; first divergence is notification policy. |
| AD-002 | Activity Center unifies terminal, WorkItem, and Operation facts with a public source. | Channel/request dedupe and public SourceRef; `selectFeatureSearchIndex`. | Fold a failed approval state, task, and a public operation into the index and inspect operation entries. | **RED**: no Operation row is emitted. Keep `CAPABILITY_GAP/BLOCKED`; no current Operation Center owner. |
| AD-003 | Duplicate Operations retain the latest unsettled state and hide completed work. | Channel/native operation ID is the dedupe boundary; `selectFeatureSearchIndex`. | Supply old/new rows for one operation plus a completed row, then inspect operation projections. | **RED**: the public index emits no Operation projection. Keep `CAPABILITY_GAP/BLOCKED`; no current Operation Center owner. |
| AD-004 | Global search finds visible in-progress Operations and returns their artifacts SourceRef. | Search consumes public Operation projections; `searchFeatureIndex`. | Index a visible waiting operation with an artifacts SourceRef and search its title. | **RED**: no Operation row is searchable. Keep `CAPABILITY_GAP/BLOCKED`; no current Operation Center owner. |
| AD-093 | A recent-reading drawer is available at the workspace edge. | Reading owns the drawer entry and focus return; `WorkspaceLayout` composition. | Render the real public WorkspaceLayout/WorkspaceFeatures composition and query the drawer button. | **RED**: no `打开最近阅读` button is exposed. Keep `FIXTURE_MISSING/BLOCKED`; first boundary is WorkspaceLayout. |
| AD-097 | Fast reselect of the committed channel cancels a pending target. | Latest selection owns the pending handoff; `WorkspaceLayout` navigation port. | Render c0, click c1, immediately click c0, inspect public `navigation.select` calls. | **RED**: only c1 is recorded. Keep `FIXTURE_MISSING/BLOCKED`; pending cancellation is absent at WorkspaceLayout. |
| AD-099 | Invalid target rollback returns to the origin and ends old pending handoff. | Rollback and committed identity share one navigation owner; `WorkspaceLayout`. | Select c1, rerender with an invalid c1 directory result, inspect the public heading. | **RED**: invalid c1 remains committed and no c0 rollback heading is exposed. Keep `FIXTURE_MISSING/BLOCKED`. |
| AD-105 | Rapid A→B→A hands focus only to the latest target. | Stale pending target cannot replay focus; `WorkspaceLayout`. | Render c0, issue c1 then c0 selections, inspect public selection calls. | **RED**: only c1 is recorded. Keep `FIXTURE_MISSING/BLOCKED`; latest-target handoff is absent. |
| AD-106 | Leaving and returning retains that channel's terminal split. | Terminal/session/layout visibility is channel-scoped; `WorkspaceLayout` + `WorkspaceFeatures`. | Render c0 terminal-visible, switch to c1, return to c0, inspect terminal panel visibility. | **RED**: returned c0 terminal panel is hidden. Keep `FIXTURE_MISSING/BLOCKED`; no retained split owner. |
| AD-108 | Closing one channel split cannot close another channel split. | Terminal visibility is isolated per committed channel; `WorkspaceLayout` + `WorkspaceFeatures`. | Render visible c0/c1 splits, close c1, return c0, inspect c0 panel visibility. | **RED**: c0 panel is hidden. Keep `FIXTURE_MISSING/BLOCKED`; no per-channel visibility owner. |
| AD-149 | Create-channel opens an independent dialog and initially focuses its name. | Dialog owner handles focus and submit lifecycle; `GovernanceFeature`/`ChannelAdministrationPanel`. | Render the public governance panel with a submit port and query dialog/focus. | **RED**: no independent `新建频道` dialog or name-focus owner is exposed. Keep `OWNER_MISSING/BLOCKED`. |

## Ledger outcome

AD-157, AD-158, AD-288, and AD-289 move from BLOCKED to PASS; AD-167 remains
PASS after independent re-verification. The fifteen ordinary red rows remain
BLOCKED. The ledger moves from **315 PASS / 0 REGRESSION / 50 BLOCKED** to
**319 PASS / 0 REGRESSION / 46 BLOCKED**. Category counts are now:

| Category | Before | After | Change |
|---|---:|---:|---:|
| `OWNER_MISSING` | 12 | 12 | — |
| `FIXTURE_MISSING` | 24 | 24 | — |
| `CAPABILITY_GAP` | 14 | 10 | −4 (`AD-157`, `AD-158`, `AD-288`, `AD-289`) |
| **Total BLOCKED** | **50** | **46** | **−4** |

No ordinary red result is counted as completion. No case is obsolete, deleted,
skipped, or expected-fail.

## Boundary audit

This round changes only
[`tests/blocked-round25-public-owner.test.jsx`](../tests/blocked-round25-public-owner.test.jsx),
this report, the A–D ledger, and the two A–D verification/quantification
reports. The Feed and cursor owner fixes (`fc7f692`, `5c46b7c`, and `ef67eaf`)
were already present and are only verified here. No Workspace, Reading,
Outbox, vendor, package manifest, lockfile, private export, compatibility API,
or product source was changed. No baseline declaration was deleted or skipped.
