# A-D TC-1496 feature task provider contract

Date: 2026-09-21
Base: `60af843745c208b267038e9f68ea8e884e78926a`
Case: `fae8b70:tests/work-items.test.js:30`, “只接受 describe 明确声明 task.create 的 provider”

## Case contract

| Field | Contract |
|---|---|
| User capability | 任务中心只把明确声明 `task.create` 的 Agent 呈现为任务 provider；只声明其他 command 的 Agent 不可被误选为任务执行者。 |
| Invariant | provider 必须同时满足当前 roster 身份与公开 Describe 能力事实；不能从 roster、旧缓存或其他 command 猜测 `task.create`。 |
| Current unique owner | `selectFeatureTaskProviders` in `src/model/feature-tasks.js`; TasksFeature consumes this public projection. |
| Old setup/action/result | capability map contains Agent `agent` declaring `task.create` and Agent `viewer` declaring only `agent.ask`; current roster contains both; result contains only `agent` / `执行者`. |
| Allowed boundary | 仅新增公开 owner 单测与本报告；不改产品 source、Workspace、Feed、Reading、API、store、vendor、package 或 lockfile。 |
| Bounded failure | 若当前公开 projection 不满足上述能力，保留精确红合同并回交 `feature-tasks` owner；不得放宽断言、判废能力或跨 owner 修复。 |

## Evidence

`tests/feature-task-providers.test.js` calls only the current public
`selectFeatureTaskProviders` export and retains the baseline roster/capability
facts and expected provider result. No private helper, compatibility path, or
second source of truth is used.

## Verification

```text
npm test -- --run \
  tests/feature-task-providers.test.js \
  tests/feature-tasks-filter.test.js \
  tests/feature-waiting-controls.test.jsx \
  tests/task-controls-restore.test.jsx --reporter=dot
4 test files passed, 18 tests passed
```

The existing production-entry Tasks/Automation regression also passes:

```text
ATOLL_TEST_MOCK_PORT=18132 ATOLL_TEST_WEB_PORT=18133 \
npm run test:browser -- tests/browser/f4-tasks-restore.spec.js \
  --reporter=line --workers=1
3 passed
```

The focused successor is **PASS / MIGRATE**. No product source change is
required; the current public provider projection preserves the baseline user
capability and identity/ability invariant.
