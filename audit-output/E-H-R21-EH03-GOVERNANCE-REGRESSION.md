# E–H round 21 — EH03-01/02 full baseline action re-probe

审计快照：当前 HEAD `a3963f6`。本轮只处理仍为 OWNER-MAPPED 的 EH03-01/02，恢复
旧 case 的完整 action 与 observable；没有修改 `src/`、vendor、package 或 lockfile。
Quota 只做当前公开行为的独立复核，不重复 R20 的总账计数。

## 结论

旧的两个 case 不是“过滤子断言已通过”就可以收敛。把基线的入口动作和结果断言
放回 `tests/f5-management.test.jsx` 后，两个 case 都在同一首断点失败：当前公开
`ChannelAdministrationPanel` 初始 `成员` tab 的 `aria-selected` 是 `false`，而基线
要求不做导航就为 `true`。这是可复现的产品差异，不是 fixture 预清洗或缺少测试
owner；当前 owner 明确存在，故交给治理 owner 处理。

### EH03-01 — default Members tab

- **Baseline setup → action → result:** `fae8b7010afd1b3a950bc455ba6a577b65378cda:tests/f5-management.test.jsx:16-38` 渲染旧 `ChannelGovernance`，不点击任何 tab；`getByRole('tab', { name: '成员' }).aria-selected` 必须是 `true`，Root 可见，system/registrar/svcactor 不可见。
- **User capability:** 打开 Channel Context 后立即看到成员治理入口和业务成员，系统/注册/服务 actor 不污染业务 roster。
- **Invariant:** governance panel 的 initial tab 必须是 Members；roster filtering 仍由公开 actor-visibility owner 执行，而非 fixture 删除行。
- **Current public owner:** `src/ui/features/governance/GovernanceFeature.jsx:96-103` 的 `ChannelAdministrationPanel`，成员内容在 `ChannelMembers`；过滤 predicate 是 `src/model/actor-visibility.js:isVisibleActor`。
- **Minimal reproduction:** 当前 `tests/f5-management.test.jsx:19-41` 保留 raw roster 四行，在任何 tab action 前断言 `成员[aria-selected] === 'true'`，再沿用原始 roster observable。
- **Observed failure:**

  ```text
  npx vitest run tests/f5-management.test.jsx -t 'Channel Context 默认成员优先并隐藏标准 Actor' --reporter=verbose
  FAIL tests/f5-management.test.jsx > ... > Channel Context 默认成员优先并隐藏标准 Actor
  AssertionError: expected 'false' to be 'true'
  Expected: "true"
  Received: "false"
  tests/f5-management.test.jsx:35:83
  ```

- **First divergence:** `ChannelAdministrationPanel` line 97 has `useState('overview')`; line 98 publishes `概览` before `成员`. Clicking `成员` afterward does show Root and hides the three standard identities, but that is a later navigation path and cannot prove the baseline no-action observable.
- **Disposition:** **REGRESSION — governance owner, pending root product decision**. Do not mark obsolete without an explicit decision; do not count post-click filtering as EH03-01 closure.

### EH03-02 — participant selection and type-specific configuration

- **Baseline setup → action → result:** `fae8b7010afd1b3a950bc455ba6a577b65378cda:tests/f5-management.test.jsx:40-63` renders old governance with principal `alice`, declarations `demo:agent`/`svcactor`; opens `选择参与者`; asserts `svcactor` absent; selects `Analyst · Agent`; then requires visible `demo:agent` and `归属 principal 由声明本身决定`.
- **User capability:** select a legitimate participant/declaration, understand the selected object type, and submit the correct admission semantics without exposing a genesis service declaration.
- **Invariant:** genesis/internal declarations are not candidates; a normal declaration remains selectable; admission command uses the declaration identity (`decl_id`) rather than inventing a principal argument.
- **Current public owner:** `ChannelAdministrationPanel` → `ChannelMembers` (`GovernanceFeature.jsx:66-83`) → `isManageableDeclaration`; command routing is `WorkspaceApp.jsx:923-927` (`TYPES.member.create` with `{ decl_id: payload.candidateId }`). There is no missing owner.
- **Minimal reproduction:** current `tests/f5-management.test.jsx:43-67` restores the no-navigation default-tab assertion, the old selector name, genesis exclusion, ordinary option selection, `demo:agent` result and principal explanation. The test fails at the shared initial-tab assertion before it can reach later differences.
- **Observed first failure:**

  ```text
  npx vitest run tests/f5-management.test.jsx -t '添加流程的候选人不包含 genesis 铸出的系统声明' --reporter=verbose
  FAIL tests/f5-management.test.jsx > ... > 添加流程的候选人不包含 genesis 铸出的系统声明
  AssertionError: expected 'false' to be 'true'
  Expected: "true"
  Received: "false"
  tests/f5-management.test.jsx:60:83
  ```

- **Next deterministic divergence after manually entering Members:** current `GovernanceFeature.jsx:72` labels a declaration `Analyst · 声明`, line 78 exposes combobox `待引入成员`, and the rendered member panel contains no `demo:agent` selection detail or `归属 principal 由声明本身决定` explanation. The current command payload is correctly routed by `WorkspaceApp` to `{ decl_id: 'demo:agent' }`, but command correctness does not replace the missing old user-visible action/result.
- **Disposition:** **REGRESSION — governance owner, pending root product decision**. The genesis-filter subassertion remains useful evidence, but cannot close the participant-selection/configuration case. If the old labels/explanation are intentionally retired, root must explicitly record that product decision before changing the case disposition.

## Owner handoff packet

| case | first public owner boundary | baseline | current | capability/invariant at risk | smallest owner action |
|---|---|---|---|---|---|
| EH03-01 | `ChannelAdministrationPanel` initial `tab` state (`GovernanceFeature.jsx:97-98`) | no click → Members selected | no click → Overview selected (`false`) | immediate member governance entry and roster filtering | decide/restore Members as initial tab, or root-record an explicit UX contract change; preserve `isVisibleActor` filtering |
| EH03-02 | `ChannelMembers` candidate surface (`GovernanceFeature.jsx:66-78`) after initial tab boundary | `选择参与者` → `Analyst · Agent` → `demo:agent` + principal explanation | `待引入成员` → `Analyst · 声明`; no selected id/explanation projection; command route itself is `{decl_id}` | legitimate participant admission remains understandable and preserves declaration identity | restore equivalent public selected-candidate/config observable in this owner, or root-record explicit UX decision; do not weaken the baseline test to genesis filtering only |

No second owner, compatibility API, private export, or product-side fallback is proposed. The regression packet is reproducible against the current public components and raw directory-shaped fixture; it does not depend on a mocked success response. The focused run is intentionally red because the restored baseline assertions expose the product boundary.

## Independent latest quota check (not a new ledger count)

At the same HEAD `a3963f6`, the current quota owner remained `createChannelReplicaCache` with the single
`atoll-channel-replica-v1` `rows`/`meta` stores. Independent verification, not a recount of R20:

```text
npx vitest run tests/channel-replica-cache-redaction.test.js --reporter=dot
Test Files 1 passed (1)
Tests 10 passed (10)

ATOLL_TEST_WEB_PORT=16379 ATOLL_TEST_MOCK_PORT=19838 npx playwright test tests/browser/f7-history-cache.spec.js --reporter=list --workers=1
1 passed (4.1s)
```

The latest run still covers raw redaction/reload/migration, atomic quota tail and coverage,
second-quota `cache_unavailable` rollback, startup physical-row reconcile, serialized append,
clear rollback, and real browser IndexedDB bounded tail. These results are recorded as an
independent freshness check only; no quota case or count is added to R21.
