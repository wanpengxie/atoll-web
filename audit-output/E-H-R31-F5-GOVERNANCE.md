# E-H R31 — F5 governance baseline proof (TC-0191–TC-0195)

Date: 2026-09-20
Baseline: `fae8b70` (`fae8b7010afd1b3a950bc455ba6a577b65378cda`)
Runtime commit: `5ae1fca`
Successor: [f5-governance-baseline-0191-0195.spec.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:1)

This is the next five unique E-H baseline declarations after the closed F4
cases. The historical declarations remain separate by action and observable;
TC-0191 retains both member-list and add-participant semantics because that is
one exact historical case and the successor proves both paths. No red case is
closed by the neighboring case or by a suite count.

## Verification

The host watcher required polling (`ENOSPC` without it). Each case was run with
a fresh Chromium/mock pair and one worker:

```text
TC-0191: CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16570 ATOLL_TEST_MOCK_PORT=19970 npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js --grep 'TC-0191' --reporter=line --workers=1 --output=test-results-e-h-r31-tc0191
         1 passed (6.2s)
TC-0192: ... ATOLL_TEST_WEB_PORT=16571 ATOLL_TEST_MOCK_PORT=19971 ... --grep 'TC-0192' ... --output=test-results-e-h-r31-tc0192
         failed at the first modal observable; [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0192/f5-governance-baseline-019-e042e-5-003-新建频道是独立-Modal-并保持四步收敛/error-context.md:1)
TC-0193: ... ATOLL_TEST_WEB_PORT=16572 ATOLL_TEST_MOCK_PORT=19972 ... --grep 'TC-0193' ... --output=test-results-e-h-r31-tc0193
         failed after the unique activity row click; [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0193/f5-governance-baseline-019-513a1--Activity-去重并返回-WorkItem-来源/error-context.md:1)
TC-0194: ... ATOLL_TEST_WEB_PORT=16573 ATOLL_TEST_MOCK_PORT=19973 ... --grep 'TC-0194' ... --output=test-results-e-h-r31-tc0194
         failed at the historical modal input; [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0194/f5-governance-baseline-019-e21a6--Operation-Center-并可回到原频道回合/error-context.md:1)
TC-0195: ... ATOLL_TEST_WEB_PORT=16574 ATOLL_TEST_MOCK_PORT=19974 ... --grep 'TC-0195' ... --output=test-results-e-h-r31-tc0195
         failed after search navigated to c0.project; [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0195/f5-governance-baseline-019-53ff5-搜索恢复频道、视图和-focus，权限撤销后不泄漏缓存/error-context.md:1)
```

The exact full commands are represented by the output directories and are
repeatable with the common polling prefix. `node --check` and `git diff --check`
are part of the commit gate.

## Case records

### TC-0191 — PASS

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:19`,
  “F5-001/002 Channel Context 成员优先且添加参与者不改变按钮布局”; strict
  successor [f5-governance-baseline-0191-0195.spec.js:35](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:35).
- **Old behavior / user capability:** the user can open channel governance,
  see the member view first, see only real human/agent candidates (not system,
  registrar, or `svcactor`), add Alice, and keep the add button at the same
  y-coordinate while the candidate menu is open.
- **Invariant:** governance commands use visible participant facts and the
  public channel authority; adding a participant does not shift the action
  geometry. The successor proves the member tab, hidden protected actors,
  candidate kinds, fixed button y, submit action, and resulting `alice-home`.
- **Current public owner:** the header `成员` entry is the read-only roster;
  the management route is `WorkspaceLayout`'s public `频道操作 → 频道详情`
  menu at [WorkspaceLayout.jsx:323](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:323),
  rendered by [GovernanceFeature.jsx:127](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:127).
  Its member data/commands are composed by [WorkspaceApp.jsx:1053](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1053)
  and [WorkspaceApp.jsx:1043](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1043).
- **Exact setup/action/result:** reset `actor-governance/1501`, log in, open
  the public governance menu, retain the historical member/candidate/add
  sequence, and observe `1 passed (6.2s)` in
  `test-results-e-h-r31-tc0191`. This proves both semantics in this merged
  historical declaration, not merely the member-tab count.
- **Disposition:** `PASS`. The route changed from the deleted Channel Context
  implementation to the existing public governance owner, while capability,
  actor filtering, command, and geometry assertions stayed strict.

### TC-0192 — REGRESSION / CURRENT ROUTE NOT EQUIVALENT

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:40`,
  “F5-003 新建频道是独立 Modal 并保持四步收敛”; strict successor
  [f5-governance-baseline-0191-0195.spec.js:55](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:55).
- **Old behavior / user capability:** from the public `新建频道` action, the
  user gets an independent modal, names a channel, creates it, sees the four
  convergence stages (`账本确认`, `频道可观察`, `成员关系`, `服务就绪`) all
  confirmed, and can enter the new channel.
- **Invariant:** channel creation has one modal/focus boundary and every
  visible convergence stage reports confirmed before entering the child. A
  context side panel or a generic submitted message is not the same failure
  and progress contract.
- **Current public owner:** the rail action is
  [WorkspaceLayout.jsx:93](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:93),
  composed through [WorkspaceApp.jsx:1357](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1357)
  into the public `ContextHost`/`ChannelAdministrationPanel` route at
  [WorkspaceFeatures.jsx:184](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:184).
  The current form is `ChannelOverview`'s “创建子频道” card at
  [GovernanceFeature.jsx:78](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:78);
  its command maps to the existing `system.channel.create` owner at
  [WorkspaceApp.jsx:1032](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1032).
- **Exact setup/action/result:** reset `channel-governance/1502`, log in, click
  the unchanged public `新建频道` button, then require the historical
  `role=dialog name=新建频道` before typing. Chromium showed the current
  channel page plus a `频道治理` context panel and never exposed that dialog;
  the first strict assertion timed out. Evidence is
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0192/f5-governance-baseline-019-e042e-5-003-新建频道是独立-Modal-并保持四步收敛/error-context.md:1).
- **Disposition:** `REGRESSION / CURRENT ROUTE NOT EQUIVALENT`. Preserve the
  modal/focus and four-stage observables until the governance owner supplies an
  explicit product decision; do not rewrite this case to the current side-panel
  child form or declare the old contract obsolete.

### TC-0193 — REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:55`,
  “F5-004 Activity 去重并返回 WorkItem 来源”; strict successor
  [f5-governance-baseline-0191-0195.spec.js:70](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:70).
- **Old behavior / user capability:** the user can open global Activity, see
  exactly one row for `Approve mock actionc0`, click that row, and return to the
  source channel's WorkItem detail with the exact task focus URL.
- **Invariant:** activity rows are deduplicated canonical facts and their
  source navigation preserves WorkItem identity, task view, detail panel, and
  focus. “The row exists” is not proof of source return.
- **Current public owner:** the global panel and row click are the public
  [WorkspaceFeatures.jsx:55](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:55)
  and [WorkspaceFeatures.jsx:41](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:41)
  owners. Activity data is composed in [WorkspaceApp.jsx:1197](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1197),
  while source navigation is [WorkspaceApp.jsx:1184](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1184).
  The task-detail owner is the existing `openTaskItem` path at
  [WorkspaceApp.jsx:717](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:717),
  but this Activity callback does not invoke it.
- **Exact setup/action/result:** reset `approval-schema/1503`, log in, open
  Activity, assert one canonical row, click it, then require the old WorkItem
  detail and focus URL. The row count passed; after the click no
  `工作项详情` panel appeared. Evidence is
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0193/f5-governance-baseline-019-513a1--Activity-去重并返回-WorkItem-来源/error-context.md:1).
- **Disposition:** `REGRESSION`. The product owner must preserve Activity
  deduplication and route the canonical source to the existing task-detail
  owner; the test does not accept a channel-only return.

### TC-0194 — REGRESSION / CURRENT ROUTE NOT EQUIVALENT

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:66`,
  “F5-004 创建操作进入 Operation Center 并可回到原频道回合”; strict successor
  [f5-governance-baseline-0191-0195.spec.js:81](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:81).
- **Old behavior / user capability:** the user creates `operation-room` through
  the independent channel-create flow, observes ledger confirmation, closes
  it, opens Activity → 操作, opens exactly one operation row, and returns to
  the original channel with the `创建子频道` turn and 回合详情.
- **Invariant:** creation and operation activity are durable, canonical facts;
  the operation source retains request/channel identity and returns to the
  originating turn. A currently available child-channel form or live activity
  snapshot cannot stand in for the four-stage create receipt and return path.
- **Current public owner:** channel creation is currently the public
  `ChannelOverview` form and `submitGovernance` mapping described in TC-0192;
  operation rows are projected by [WorkspaceApp.jsx:1218](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1218)
  and rendered by [WorkspaceFeatures.jsx:58](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:58).
  Their public source callback is [WorkspaceApp.jsx:1184](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1184),
  which only navigates to channel/view and clears focus.
- **Exact setup/action/result:** reset `channel-governance-delay/1504`, log in,
  click the unchanged `新建频道`, and require the old modal's labelled name
  input before creating. Chromium timed out waiting for that input; the
  historical creation step therefore has no proven replacement and no later
  operation assertion was fabricated. Evidence is
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0194/f5-governance-baseline-019-e21a6--Operation-Center-并可回到原频道回合/error-context.md:1).
- **Disposition:** `REGRESSION / CURRENT ROUTE NOT EQUIVALENT`. Keep the full
  create → receipt → operation → source-turn contract open for the governance
  owner; do not skip the blocked front half or convert live activity into a
  durable operation fact.

### TC-0195 — REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:86`,
  “F5-005 全局搜索恢复频道、视图和 focus，权限撤销后不泄漏缓存”; strict
  successor [f5-governance-baseline-0191-0195.spec.js:101](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:101).
- **Old behavior / user capability:** the user searches a visible work item,
  returns to `c0.project` in Tasks with WorkItem detail and exact focus URL,
  then after membership revocation sees the revocation notice, no cached detail,
  an inaccessible Tasks surface, and no result on a repeated search.
- **Invariant:** search exposes only current public access, preserves canonical
  WorkItem identity through navigation, and revocation removes both detail and
  searchable cached content. A channel heading alone is not successful task
  restoration.
- **Current public owner:** search UI and public result click are
  [SearchFeature.jsx:10](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/search/SearchFeature.jsx:10)
  and [SearchFeature.jsx:22](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/search/SearchFeature.jsx:22).
  Work-item source identity is built by [feature-search.js:312](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/feature-search.js:312),
  and the composition root's public `source.kind === 'task'` route is
  [WorkspaceApp.jsx:1145](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1145).
  Existing task detail/focus remains `openTaskItem` at
  [WorkspaceApp.jsx:717](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:717).
- **Exact setup/action/result:** reset `multi-channel/1505`, log in, search
  `c0.project history 1`, assert one result, click it, and retain the old
  detail/focus checks. The result and channel restoration passed (`main h1` was
  `c0.project`), but the first failed observable was absence of
  `工作项详情`; see [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r31-tc0195/f5-governance-baseline-019-53ff5-搜索恢复频道、视图和-focus，权限撤销后不泄漏缓存/error-context.md:1).
  Because the test stops at that first failure, the later revoke/no-cache
  assertions remain explicitly unproven rather than inferred.
- **Disposition:** `REGRESSION`. The owner must preserve WorkItem identity and
  detail/focus before the revocation half can be accepted; no cached-access
  assertion was weakened.

## R31 disposition

| Case | Result | First observable |
| --- | --- | --- |
| TC-0191 | PASS | Member governance, candidate filtering, fixed button geometry, and add result all pass |
| TC-0192 | REGRESSION / CURRENT ROUTE NOT EQUIVALENT | Old independent `新建频道` dialog is absent; current route is `ContextHost` governance |
| TC-0193 | REGRESSION | Unique Activity row clicks without opening WorkItem detail/focus |
| TC-0194 | REGRESSION / CURRENT ROUTE NOT EQUIVALENT | Old create modal/input is absent, so operation return is unproven |
| TC-0195 | REGRESSION | Search reaches `c0.project`, but WorkItem detail is absent before revoke checks |

No product, vendor, package/lockfile, private export, skip, deletion, or
compatibility owner was added. The four red F5 rows retain their first-owner
packets for governance/product-owner review.
