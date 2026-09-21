# TC-0292 / A-BR-04/05/06/07 — public multi-channel contract

## Claim and baseline

- **Claim:** the next unique Browser N-S baseline after TC-0291 is the old
  `A-BR-04/05/06/07 多频道隔离、消息终态、审批与系统 Actor 隐藏` contract.
- **Old source:** `fae8b70:tests/browser/phase-a.spec.js:35-68`.
- **Exact product base:** `cd4b027c03b159a241d94dbc0b85e64cc0a8be5b`.
- **Worktree:** `atoll-web-tc0292-current-cd4b027` (detached, clean base).
- **Allowed scope:** the dedicated browser spec and this audit only. No product,
  mock scenario, fixture, vendor, package, lockfile, skip, or private
  diagnostic oracle was changed.

## De-duplication

Before implementation, the old phase-A title and `A-BR-04/05/06/07` were
searched across the current browser specs, audit output, and reachable refs.
The existing successors are adjacent but not equivalent:

- `tc1499-workspace-bootstrap.spec.js` covers root/bootstrap/reload/logout,
  not project history isolation, approval resolution, or pulse isolation.
- `tc0310-channel-list.spec.js` covers a structured `system.channel.list`
  result, not the multi-channel message/approval/roster journey.
- `ui-visual.spec.js`, `f7-channel-notifications.spec.js`, and
  `member-filter-timeline.spec.js` each cover individual governance, rail, or
  filter behavior, not this combined public contract.

No existing current test asserted the same project-only history, hidden system
actors, terminal approval receipt, and alternating live-pulse channel
isolation as one user journey. TC-0292 is therefore claimed as unique.

## Public oracle

The migrated spec uses only real Chromium actions and public UI observations:

1. Reset `multi-channel/2920`, log in as `root`, and select the visible
   `c0.project` channel.
2. Require the project history row and require the root `c0 history 1` row to
   be absent from `main`.
3. Open `频道操作 → 频道详情 → 成员`; require `project-agent`, and require
   `system`, `registrar`, and `svcactor` to be absent from the public roster.
4. Send a visible message and require its visible `PONG` terminal response.
5. Approve the visible approval card and require `已回执` plus `COMPLETED`.
6. Issue two public mock pulse actions; require `project 动态 #2` in the active
   project presentation and require `c0 动态 #1` absent from `main`.

No private store, React fiber, diagnostics, sequence counter, or geometric
oracle participates in the verdict.

## Evidence on exact `cd4b027`

Test: `tests/browser/f7-phase-a-0292.spec.js`.

- Focused real Chromium: **1/1 passed** (`7.0s`).
- `--repeat-each=3` real Chromium: **3/3 passed** (`17.3s`).
- The same test path had no page-visible error and no selector fallback.

## Result

**ACCEPT — test-only migration.** The current public owner satisfies the
TC-0292 user contract on exact `cd4b027`; there is no product regression to
hand off. The resulting test/audit commit is the only requested change.
