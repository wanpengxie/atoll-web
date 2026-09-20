# A-D TC-1495 feature task facts contract

Date: 2026-09-21
Base: `e5f35b35933dbcb61b4db7ae0bfa8b81da8dcab2`
Case: `fae8b70:tests/work-items.test.js:12`, “统一审批、回合、正式任务、恢复和本设备自动动作，且按原生编号去重”

## Case contract

| Field | Contract |
|---|---|
| User capability | 任务中心把待审批请求、Agent 回合、provider 返回的正式任务、待确认提交和本设备自动动作汇总到同一用户可见列表。 |
| Invariant | 账本事实与本地 durable facts 保留各自原生 identity/provenance；正式任务使用 provider 返回的 `task_id` 稳定标识，recovery/automation 不伪装成账本回合。 |
| Current unique owner | `selectFeatureTaskFacts` in `src/model/feature-tasks.js`; `WorkspaceApp`/`TasksFeature` 消费该公开 projection。 |
| Old setup/action/result | canonical ChannelReplica 中放入 `human.approve`、未终态 `agent.ask`、`task.create` 请求+completed response；另传同频道 uncertain pending row 和 scheduled automation row；结果包含 `approval`、`agent_run`、`task`、`recovery`、`automation` 五种事实，task key 为 `task:c1:task-7`，本地事实分别保留 `recovery:c1:retry-1` / `automation:c1:timer-1`。 |
| Allowed boundary | 仅新增当前公开 owner 单测与本报告；不改产品 source、Workspace、Feed、Reading、API、store、vendor、package 或 lockfile。 |
| Bounded failure | 若当前公开 projection 不满足上述能力或 identity/provenance 不变量，保留精确红合同并回交 `feature-tasks` owner；不得放宽断言、判废能力或跨 owner 修复。 |

## Evidence

`tests/feature-task-facts.test.js` uses only a real `ChannelReplica` snapshot,
the public `selectFeatureTaskFacts` export, and the same baseline pending and
automation inputs. It does not import a deleted `work-items` implementation,
private helper, compatibility path, or test-only product branch.

## Verification

```text
npm test -- --run \
  tests/feature-task-facts.test.js \
  tests/feature-task-providers.test.js \
  tests/feature-tasks-filter.test.js \
  tests/feature-waiting-controls.test.jsx \
  tests/task-controls-restore.test.jsx --reporter=dot
5 test files passed, 19 tests passed
```

The existing production-entry Tasks/Automation regression also passes:

```text
ATOLL_TEST_MOCK_PORT=18142 ATOLL_TEST_WEB_PORT=18143 \
npm run test:browser -- tests/browser/f4-tasks-restore.spec.js \
  --reporter=line --workers=1
3 passed
```

The production build passes:

```text
npm run build
vite build: success (4306 modules transformed)
```

The focused successor is **PASS / MIGRATE**. No product source change is
required; the current public task-facts projection preserves the baseline
user-visible aggregation and stable identity/provenance boundaries.
