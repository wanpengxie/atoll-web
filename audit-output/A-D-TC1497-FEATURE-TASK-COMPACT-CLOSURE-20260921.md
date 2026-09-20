# A-D TC-1497 feature task compact-closure contract

Date: 2026-09-21
Base: `34990fce2d454ffbfaf7133aeb681cd4aedf5f24`
Case: `fae8b70:tests/work-items.test.js:38`, “task.create compact closure 稳定标成详情不可用，不猜成已完成普通回合”

## Case contract

| Field | Contract |
|---|---|
| User capability | 历史任务的终态正文已被裁剪时，任务中心仍保留该工作事实，并明确提示用户刷新或重新进入频道取得详情。 |
| Invariant | compact terminal closure 只证明生命周期已结束，不证明 task result 正文仍可读；不得从 request/title 或 closure status 猜成正式 `task`、`completed` 或可操作结果。 |
| Current unique owner | `selectFeatureTaskFacts` in `src/model/feature-tasks.js`, backed by `terminalResultState`/`terminalResultPayload`; `WorkspaceApp`/`TasksFeature` consumes this public projection. |
| Old setup/action/result | `task.create` terminal response arrives before its older request page; Replica trims the full terminal body while retaining lifecycle closure, then releases the request. The result must contain no `task:c1:task-7`; it must contain one uncertain `agent_run:c1:task-request` with the stable unavailable message and `resultUnavailable: true`. |
| Allowed boundary | 仅新增当前公开 owner 单测与本报告；不改产品 source、Workspace、Feed、Reading、API、store、vendor、package 或 lockfile。 |
| Bounded failure | 若当前 projection 将 compact closure 猜成 task/completed，保留精确红合同并回交 `feature-tasks`/Replica owner；不得放宽断言、判废能力或跨 owner 修复。 |

## Evidence

`tests/feature-task-compact-closure.test.js` uses the public
`createChannelReplicaStore` ingress/trim path to produce a real compact
terminal closure, then calls only the public `selectFeatureTaskFacts` owner.
It does not set private task state, import the deleted `work-items` index, add
a compatibility export, or create a second store.

## Verification

```text
npm test -- --run tests/feature-task-compact-closure.test.js --reporter=dot
1 test file passed, 1 test passed

npm test -- --run \
  tests/feature-task-compact-closure.test.js \
  tests/feature-task-facts.test.js \
  tests/feature-task-providers.test.js \
  tests/feature-tasks-filter.test.js \
  tests/feature-waiting-controls.test.jsx \
  tests/task-controls-restore.test.jsx --reporter=dot
6 test files passed, 20 tests passed
```

The existing production-entry Tasks/Automation regression also passes:

```text
ATOLL_TEST_MOCK_PORT=18442 ATOLL_TEST_WEB_PORT=18443 \
npm run test:browser -- tests/browser/f4-tasks-restore.spec.js \
  --reporter=line --workers=1 --timeout=60000
3 passed
```

The production build passes:

```text
npm run build
vite build: success (4306 modules transformed)
```

The focused successor is **PASS / MIGRATE**. No product source change is
required; the current public projection already separates lifecycle closure
from unavailable terminal detail without fabricating a task result.
