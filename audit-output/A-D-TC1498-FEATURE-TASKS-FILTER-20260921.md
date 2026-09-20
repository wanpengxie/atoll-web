# A-D TC-1498 feature task filter contract

Date: 2026-09-21
Base: `65a33b74ef9f5f618e36b7251c419af717b24f54`
Case: `fae8b70:tests/work-items.test.js:51`, “过滤责任、状态和类型并保持自动动作独立分组”

## Case contract

| Field | Contract |
|---|---|
| User capability | 任务中心默认显示当前用户可处理的 waiting 项；切换到全量/已完成后可看到 completed 项；本设备自动动作继续以独立 automation 组呈现。 |
| Invariant | 筛选只投影当前任务事实；scope/status/kind 过滤不混淆责任边界，automation 不伪装成普通 Agent 回合。 |
| Current unique owner | `filterFeatureTasks` 与 `featureTaskGroup` in `src/model/feature-tasks.js`; `TasksFeature` 仅消费这些公开投影。 |
| Old setup/action/result | 构造 approval `a`、automation `b`、completed agent run `c`；默认“我的活动”得到 `a,b`；全量+已完成得到 `c`；`b` 分组为 `automation`。 |
| Allowed boundary | 仅新增公开 owner 单测与本报告；不改 Workspace、Feed、Reading、产品 source、API、store、vendor、package 或 lockfile。 |
| Bounded failure | 若当前公开投影不满足上述用户观察，保留精确红合同并停止在 `feature-tasks` owner；不得放宽断言、判废能力或跨 owner 修复。 |

## Evidence

The successor test `tests/feature-tasks-filter.test.js` exercises the current
public model exports rather than the deleted `work-items` implementation. It
keeps the baseline fixture values and observable result exactly; no private
helper or test-only branch is used.

## Verification

```text
npm test -- --run tests/feature-tasks-filter.test.js \
  tests/feature-waiting-controls.test.jsx \
  tests/task-controls-restore.test.jsx --reporter=dot
3 test files passed, 17 tests passed
```

The existing production-entry Tasks/Automation regression also passes:

```text
ATOLL_TEST_MOCK_PORT=18122 ATOLL_TEST_WEB_PORT=18123 \
npm run test:browser -- tests/browser/f4-tasks-restore.spec.js \
  --reporter=line --workers=1
3 passed
```

The focused successor is **PASS / MIGRATE**. No product source change is
required; the current public projection already preserves the baseline user
capability and grouping invariant.
