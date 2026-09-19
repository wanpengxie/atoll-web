# S–Z server boot migration ledger

Baseline `fae8b70/tests/server-boot.test.js` had three cases importing deleted
`src/model/server-boot.js`.  The current public owner is
`createChannelFeedRuntime().setHistoryGrants()` together with the world-bound
Replica/cache.  No old localStorage guard, private export, or compatibility
module was restored.

Focused evidence: `npx vitest run tests/server-world-runtime.test.js --reporter=verbose --pool=threads --maxWorkers=1` → **2/2 passed**.

| Baseline case | User capability | Architectural invariant / current owner | Current result and disposition |
|---|---|---|---|
| records first boot without invalidating state created by this login | A newly attached session must not throw away data produced in that same world | The current world is selected at feed attach; Replica/cache ownership is keyed by `(principal, server world)`, not by the deleted `atoll.server.boot.v1` key. The old assertion inspected obsolete v1 storage keys and has no current public equivalent. | **Obsolete implementation oracle; not deleted silently.** World selection remains covered by the current attach tests below. |
| invalidates local Atoll state when an established boot changes | Messages/cursors from a prior server world must not appear in the new world | `ChannelFeedRuntime.setHistoryGrants` retires grants, resets the materialized Replica, and selects a different world-bound cache owner. Current test “drops the prior replica…” proves rows/timeline are empty after `boot-a → boot-b`. | **Migrated, green.** |
| reports an epoch change even with no projection keys to remove | A world change is observable even when there is no loaded channel data | The public attach result and `agentActivity.boot` snapshot publish the new world; current test “publishes a new world epoch…” proves both attach calls report change and the new boot is visible. | **Migrated, green.** |

The old v1 cursor/history/pane/terminal-key preservation details are not copied:
they were storage-shape assertions for a removed owner.  Current read cursors
are selected by `(principal, serverBoot)` in `ChannelFeedRuntime`; pane/theme
preferences are independent UI state and are intentionally not invalidated.
