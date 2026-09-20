# E-H R26 — F4 Tasks baseline proof and product-regression handoff

观察基线：`7d64116`（共享工作树；验证时 HEAD 可能继续前移）。本轮只处理 F4 的
TC-0188/0189/0190，避开已经闭合的 F6/F7/F8 与 governance。旧入口
`tests/browser/f4-tasks.spec.js` 已不存在，因此把原始动作迁到当前公开入口
[f4-tasks-restore.spec.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:1)，没有删除旧行为或把产品红改成绿。

## 结论

三条 baseline 都能从真实 Chromium 入口完成前置 UI 动作，但都在产品公开 owner
边界暴露红色回归：

| ledger case | 当前 disposition | 首个可观察差异 |
| --- | --- | --- |
| TC-0188 / F4-001..003/005 | product regression | 打开审批详情后 URL 没有旧合同要求的 `focus=work_item%3Aapproval%3Ac0%3A...`，仍是 `#/channels/c0/tasks` |
| TC-0189 / F4-004 | product regression | `task.create` 提交返回后主视图没有切到“任务”（`aria-selected="false"`） |
| TC-0190 / F4-006 | product regression | 有效 `timer.after` 回执并关闭面板后，任务列表没有本设备自动动作行 |

没有把这些红判成 stale fixture、obsolete implementation oracle 或 blocked case；
后续旧断言仍在测试文件中，等待相应产品 owner 修复后继续跑到完整 PASS。

## Case records

### TC-0188 — F4-001..003/005

- **Baseline file/title:** `tests/browser/f4-tasks.spec.js:18`, title
  `F4-001..003/005 Tasks 聚合审批且无 provider 时不伪造正式任务`；当前 successor
  [f4-tasks-restore.spec.js:20](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:20)。
- **User capability:** 在没有 `task.create` provider 时，用户仍能在 Tasks 看到账本审批、
  看见当前事实声明的审批控制，但不会被伪造一个正式共享任务；打开详情后可深链、刷新恢复，
  还能回到来源动态。
- **Invariant:** WorkItem 必须来自 causal ledger facts；控制 receipt 的 target/hold
  owner 必须是当前事实；没有 provider 时不得生成正式 task。
- **Current public owner:** Tasks projection/list and row action are
  [TasksFeature.jsx:119](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/tasks/TasksFeature.jsx:119)。
  `commands.open` 的 composition owner 是
  [WorkspaceApp.jsx:858](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:858)，详情由
  [WorkspaceFeatures.jsx:179](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:179)
  交给 TaskDetailPanel；panel 状态本身在
  [WorkspaceApp.jsx:166](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:166)。
- **Merged-case coverage:** 当前一个原始 case 保留了全部可观察语义：
  `需要你处理`（审批聚合）、`Approve mock action`（审批行）、没有“新建任务”
  （无 provider）、provider 缺失文案、打开详情后“频道账本”与“批准”按钮、精确
  `focus=work_item%3Aapproval%3Ac0%3A...` deep-link、reload 后详情仍为
  `Approve mock action`、点击“返回来源”后“动态” tab active。没有用 suite 数量代替
  这些子语义。
- **Setup/action/observable:** reset `approval-schema`, seed `1401`; 登录
  `root@atoll.local/root`; 点“任务”；确认上述审批/无 provider observables；点击
  `Approve mock action` 审批行；确认详情、批准按钮、URL；reload；确认详情；点击“返回来源”；
  确认“动态” tab。
- **Current result/evidence:** 前置审批、无 provider、详情、按钮均通过；在 URL 断言
  首次分叉：期望 `/focus=work_item%3Aapproval%3Ac0%3A/`，实际为
  `http://127.0.0.1:16536/#/channels/c0/tasks`。这说明 Tasks projection 与详情渲染
  已接通，缺口在打开详情后的深链/路由同步，而不是 fixture 没有审批事实。
- **First owner handoff:** `tasksPort.commands.open` 只执行
  `setPanel({ kind: 'task', key: ... })`；右栏可以显示 panel，但 composition 没有把
  task focus 写入公开 URL，也就没有 reload 可恢复的 route owner。修复应交给
  Workspace navigation/panel owner，保持 Tasks/ledger owner 不变。
- **Disposition:** `PRODUCT REGRESSION`，不是删弱或 obsolete。测试在首个 URL 红后
  会停止，但 reload/回源动作已完整保留，修复后会继续验证它们。

### TC-0189 — F4-004

- **Baseline file/title:** `tests/browser/f4-tasks.spec.js:37`, title
  `F4-004 只有真实 task.create provider 时可从回合创建并恢复正式任务`；当前 successor
  [f4-tasks-restore.spec.js:42](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:42)。
- **User capability:** 只有 roster 中真实公布 `task.create` 的 provider 才能从动态回合
  创建正式任务；创建后可在 Tasks 找到稳定任务编号，打开详情，reload 后仍能恢复，
  并可回到 `c0 history 1: ask steward for PONG` 来源。
- **Invariant:** task state 只能由 canonical ledger/terminal result 投影；正式 task 必须
  携带 provider 返回的稳定 task id，不能由浏览器本地伪造。
- **Current public owner:** 回合入口在 ConversationSurface，任务表单是
  [TasksFeature.jsx:72](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/tasks/TasksFeature.jsx:72)。表单提交调用
  `port.commands.createTask`（同文件
  [line 89](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/tasks/TasksFeature.jsx:89)），composition command 在
  [WorkspaceApp.jsx:859](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:859)
  通过 submission owner 发送 provider 请求；任务 tab 的公开选中态由
  [WorkspaceLayout.jsx:338](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:338)
  读取 navigation.activeView。
- **Setup/action/observable:** reset `task-capability`, seed `1402`; 登录；hover
  `c0 history 1` 回合；点“创建任务”；确认“动态 #1”；填“复核研究结论”；提交；
  确认“任务” tab selected；切到“全部”；确认正式任务行；打开详情并确认稳定任务编号；
  reload 并确认详情；点击“返回来源”；确认原始动态。
- **Current result/evidence:** 回合创建按钮、Modal、`动态 #1` 来源预览、输入和创建
  点击均完成；首个差异在
  [f4-tasks-restore.spec.js:52](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:52)：
  期望任务 tab `aria-selected="true"`，实际为 `false`。点击没有表单错误，说明不是
  provider fixture 缺失；产品在创建返回后的导航 observable 先失败，后续任务行/id/reload/
  回源断言按原合同保留。
- **First owner handoff:** `TaskCreationDialog` 成功后只调用 `onClose`（清掉
  `taskCreateSource`）；[WorkspaceApp.jsx:859-867](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:859)
  的 `createTask` 只发送 submission，没有调用 `navigation.setActiveView('tasks')`。
  因而首个公开边界是 Workspace navigation/composition owner，而不是 provider 能力
  探测或测试 fixture。修复必须保留 provider gate 与 ledger task projection。
- **Disposition:** `PRODUCT REGRESSION`，不放宽 tab、稳定 id、reload、回源断言。

### TC-0190 — F4-006

- **Baseline file/title:** `tests/browser/f4-tasks.spec.js:61`, title
  `F4-006 timer 只作为本设备 Automation 并在 320px 保持可达`；当前 successor
  [f4-tasks-restore.spec.js:67](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:67)。
- **User capability:** 用户可安排一个明确的本设备自动动作；该动作在 Tasks 中作为
  local automation 出现，可打开并取消；详情明确它不是频道共享事实；窄屏 320px 下
  入口仍可达且无横向溢出。
- **Invariant:** Automation 只以本设备 durable fact 展示，不冒充共享 task；列表行、
  detail、cancel control 必须来自同一个 timer identity，且布局可用。
- **Current public owner:** Tasks 的“安排自动动作”按钮和 task aggregation 在
  [TasksFeature.jsx:152](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/tasks/TasksFeature.jsx:152)。
  它打开 Workspace 的 automation panel（[WorkspaceApp.jsx:869](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:869)），
  panel 实现是 [GovernanceFeature.jsx:155](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:155)。
  这里的 owner 是 local automation/task composition，不是本轮已闭合的 F5 governance
  合同。
- **Setup/action/observable:** reset `scheduled-action`, seed `1403`; 登录；点“任务”→
  “安排自动动作”；填 `60000` 与 `{"text":"本设备周报提醒"}`；点击“创建定时动作”；
  关闭面板；确认任务行并打开；确认“不代表频道共享或跨设备的完整事实”；设 viewport
  `320x720`；断言 `scrollWidth <= innerWidth`；确认“取消本设备自动动作”可见。
- **Current result/evidence:** automation panel、字段、有效 create 点击、回执后的关闭
  动作均完成；首个差异在
  [f4-tasks-restore.spec.js:80](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:80)：
  任务列表中找不到“本设备周报提醒”。当前 `ChannelAutomationPanel` 只从
  `port.records` 读行（[GovernanceFeature.jsx:163](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:163)），
  create 仅保存 panel-local operation/cancel id；Workspace 的 automation port
  [WorkspaceApp.jsx:978-997](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:978)
  没有 records/list 投影，而 task projection
  [WorkspaceApp.jsx:639-645](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:639)
  没有传 `automationRecords`。
- **First owner handoff:** 不是 UI selector 或 stale fixture；首个缺口在
  Workspace automation/task composition 没有把已获 `timer.after` canonical receipt
  变成唯一的 local durable record，并传给
  [feature-tasks.js:347-384](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/feature-tasks.js:347)，
  虽然 model 已明确支持 `automationRecords`。产品 owner 应补现有 automation record
  投影并接入现有 task owner，不能伪造共享 task、增设兼容 owner 或让测试自造记录。
- **Disposition:** `PRODUCT REGRESSION`，保留 detail/local-scope/cancel/320px 全部
  原始 observables；修复前不可宣称 F4-006 PASS。

## Focused verification

Command:

```sh
ATOLL_TEST_WEB_PORT=16536 ATOLL_TEST_MOCK_PORT=19936 \
  npx playwright test tests/browser/f4-tasks-restore.spec.js \
  --reporter=line --workers=1 \
  --output=test-results-e-h-r26-f4-tasks-complete
```

Result: `3 failed` (all three assigned cases). First failures were exactly:

1. TC-0188 line 35: expected `focus=work_item%3Aapproval%3Ac0%3A`, received
   `#/channels/c0/tasks`.
2. TC-0189 line 52: task tab `aria-selected` expected `true`, received `false`.
3. TC-0190 line 80: expected the local automation task row, element not found.

The reset endpoint returned OK and every assertion before each listed boundary passed.
No `src/`, vendor, package, lockfile, private export, skip, deletion, or compatibility API
was changed for this round; the source paths above are evidence-only owner references.
