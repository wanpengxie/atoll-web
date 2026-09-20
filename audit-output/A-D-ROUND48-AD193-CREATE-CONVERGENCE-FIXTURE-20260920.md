# A–D Round 48 — AD-193 channel-creation convergence fixture recovery (2026-09-20)

Round 48 selects AD-193 because its current public Governance owner is
independent of Reading, Feed, and visibility. The old red fixture mounted the
members-first `ChannelAdministrationPanel` and looked for create-child labels
that are owned by the current `WorkspaceRightPanel` create route. The recovery
corrects only that public fixture boundary.

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/channel-governance.test.js:41` — create success must separately converge ledger, OBS, membership, and serving. |
| User capability | A user can create a child channel and observe its convergence without being offered entry before the channel is authoritative and serving. |
| Invariant | A command receipt is only a request locator. “进入新频道” remains unavailable until accepted, ledger, observable, membership, and serving facts all converge with a resolved channel. |
| Current public owner | `WorkspaceRightPanel` dispatches the overview panel to `GovernanceFeature.ChannelCreateModal`; the feature consumes the typed `port.creation` projection. The owner implementation is `src/ui/features/governance/GovernanceFeature.jsx:277-330, 347-377, 414-430`. |
| Old action | The prior fixture called the members-first `ChannelAdministrationPanel` and searched for `名称`/`创建子频道`, which are not the public create route's controls. |
| Current action | Mount `WorkspaceRightPanel` with `{ kind: 'channel-administration', initialTab: 'overview' }`, enter `新频道名称`, click `创建频道`, and observe the public progress boundary. |
| Current result | **PASS**. The public command receives `{ scope: 'channel', action: 'create_child', payload: { name: 'research', purpose: '', parentId: 'c0' } }`; the receipt starts convergence tracking, “服务就绪” is visible, and “进入新频道” is absent until authoritative facts arrive. |
| Test evidence | `tests/blocked-round26-public-owner.test.jsx:429-442`. |
| Disposition | `MIGRATE`; fixture-only recovery. No product source, private export, old store, compatibility API, skip, or expected-fail was added or removed. |

## Verification

```text
npx vitest run tests/blocked-round26-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-193\\]'

Test Files  1 passed (1)
Tests       1 passed | 19 skipped (20)
```

AD-193 moves from BLOCKED to PASS. The A–D ledger moves from **331 PASS / 0
REGRESSION / 34 BLOCKED** to **332 PASS / 0 REGRESSION / 33 BLOCKED**. The
remaining blocked cases are not reclassified by this fixture recovery.
