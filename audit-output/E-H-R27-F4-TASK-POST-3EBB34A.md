# E-H R27 — F4 Tasks post-owner acceptance

本报告是 [E-H R26 F4 回归包](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/E-H-R26-F4-TASK-PRODUCT-REGRESSIONS.md:1) 的后续验收，不替换其首断点证据。产品 owner 提交
`3ebb34a`（`fix(tasks): restore workspace task routes and timer facts`）后，按三条
原 baseline case 的完整动作再次使用真实 Chromium 验证；本轮没有改 `src/`。

## Verdict

`ACCEPT`：TC-0188、TC-0189、TC-0190 均通过，且没有通过合并数量或弱化断言取得绿。

| Case | 旧首断点（R26） | 3ebb34a 后结果 |
| --- | --- | --- |
| TC-0188 / F4-001..003/005 | 审批详情未写入 `focus=work_item...` URL | PASS：审批、无 provider、详情、精确 focus URL、reload 恢复、返回动态均通过 |
| TC-0189 / F4-004 | task.create 返回后“任务” tab 未选中 | PASS：真实 provider 创建、任务 tab、All、任务行、稳定编号、reload、回源均通过 |
| TC-0190 / F4-006 | timer receipt 未投影为本设备任务行 | PASS：本设备行、详情范围说明、320px 无溢出、取消入口均通过 |

## Case records

### TC-0188 — F4-001..003/005 Tasks 聚合审批且无 provider 时不伪造正式任务

- **Baseline/title:** `fae8b70:tests/browser/f4-tasks.spec.js:18`；successor
  [f4-tasks-restore.spec.js:20](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:20)。
- **Capability:** 无 `task.create` provider 时，Tasks 仍显示账本审批和可用审批控制，但不伪造正式任务；详情可深链、刷新恢复并回到来源动态。
- **Invariant:** WorkItem 来自 causal ledger facts；控制 receipt 仍绑定当前 target/hold owner；provider 缺失不生成 task。
- **Current public owner:** Tasks projection/row 在
  [TasksFeature.jsx:119](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/tasks/TasksFeature.jsx:119)；composition open/navigation 在
  [WorkspaceApp.jsx:694-710](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:694)；route focus 由同一
  `openTaskItem` 写入，不新增兼容 owner。
- **Setup/action/observable:** reset `approval-schema/1401`；登录 root；打开任务 tab；确认“需要你处理”、`Approve mock action`、无“新建任务”及无 provider 文案；打开审批；确认频道账本/批准；确认 URL 含精确 `focus=work_item%3Aapproval%3Ac0%3A`；reload；确认详情；点击“返回来源”；确认动态 tab active。
- **Result:** PASS。原 R26 在 URL 首断点红；本次 `3ebb34a` 后全部动作通过，说明路由 focus 和刷新恢复已由当前 navigation owner 接通。未把“无 provider”改成可创建。

### TC-0189 — F4-004 只有真实 task.create provider 时可从回合创建并恢复正式任务

- **Baseline/title:** `fae8b70:tests/browser/f4-tasks.spec.js:37`；successor
  [f4-tasks-restore.spec.js:42](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:42)。
- **Capability:** 只有 roster 公开真实 `task.create` 的 provider 才能从动态回合创建正式任务；任务有稳定编号，可 reload 恢复并回到原动态来源。
- **Invariant:** task state 来自 canonical ledger/terminal result，不能由浏览器本地伪造；provider gate 必须保持。
- **Current public owner:** 表单为
  [TasksFeature.jsx:72-101](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/tasks/TasksFeature.jsx:72)，提交 composition 为
  [WorkspaceApp.jsx:945-955](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:945)，成功后用同一 navigation owner 切换 tasks。
- **Setup/action/observable:** reset `task-capability/1402`；登录；hover `c0 history 1`；创建任务；确认 `动态 #1`；输入“复核研究结论”提交；确认任务 tab selected；点 All；确认任务行；打开详情确认稳定任务编号；reload 仍见详情；点返回来源；确认原动态文本。
- **Result:** PASS。R26 的 tab `aria-selected=false` 首断点消失；provider gate、任务行、稳定编号、reload 与回源均通过，没有以“任务 tab 可见”代替正式 task 事实。

### TC-0190 — F4-006 timer 只作为本设备 Automation 并在 320px 保持可达

- **Baseline/title:** `fae8b70:tests/browser/f4-tasks.spec.js:61`；successor
  [f4-tasks-restore.spec.js:67](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:67)。
- **Capability:** 用户安排本设备自动动作后，当前浏览器会话能看到对应行、打开详情、取消；详情明确不代表频道/跨设备完整事实，320px 仍可达。
- **Invariant:** timer 只从 canonical `timer.after` receipt 生成本设备 durable/local record；行、详情、cancel 必须绑定同一个 timer identity，不能冒充共享 task。
- **Current public owner:** receipt 记录与 task projection 在
  [WorkspaceApp.jsx:611-693](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:611)；automation port 由
  [WorkspaceApp.jsx:1066-1072](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1066) 提供；面板只呈现该 port 的记录并保留本设备边界，见
  [GovernanceFeature.jsx:155-219](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:155)。
- **Setup/action/observable:** reset `scheduled-action/1403`；登录；任务 tab；安排自动动作；填写 `60000`、`{"text":"本设备周报提醒"}`；创建并关闭 panel；确认任务行；打开详情确认“不代表频道共享或跨设备的完整事实”；设 320x720，检查 `scrollWidth <= innerWidth`；确认“取消本设备自动动作”。
- **Result:** PASS。R26 的 timer receipt 不入 Tasks projection 首断点消失；同一回执产生的 local record 经过 `selectFeatureTaskFacts` 展示，窄屏和取消合同均通过。没有引入服务端 timer list 假设或共享 task fallback。

## Verification

Browser command:

```sh
ATOLL_TEST_WEB_PORT=16541 ATOLL_TEST_MOCK_PORT=19941 \
  npx playwright test tests/browser/f4-tasks-restore.spec.js \
  --reporter=line --workers=1 \
  --output=test-results-e-h-r27-f4-tasks-post-3ebb34a
```

Result: `3 passed (14.7s)`。

Targeted unit command:

```sh
npx vitest run tests/tasks-feature-restore.test.jsx tests/work-items-restore.test.js --reporter=dot
```

Result: `2 passed`, `8 passed`（共 8 tests，1.39s）。该 unit coverage separately proves
no-provider empty state, provider-only creation, task grouping/identity, local automation
scope/cancel, and ledger projection; browser coverage above proves the full user actions and
reload/navigation observables.

## Acceptance boundary

TC-0188/89/90 从 R26 `PRODUCT REGRESSION` 收敛为 `PASS` only on frozen commit
`3ebb34a` plus the unchanged successor test. The historical R26 red evidence remains useful
as the first-owner proof and is not deleted. This report changed only `audit-output/`; no
source, vendor, package/lockfile, private export, skip, deletion, or compatibility owner was
added in this acceptance round.
