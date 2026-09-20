# E-H R32 — Composer acceptance and F5 owner packets

Date: 2026-09-20
Baseline: `fae8b70` (`fae8b7010afd1b3a950bc455ba6a577b65378cda`)
Runtime product commit: `0054155`

This round independently re-runs the four Composer regressions after the
available Workspace/Governance candidate (`6b51c7d`). No Composer candidate was
present after `a538279`; no product file was changed here. It also re-runs the
four open F5 cases and packages each first red for its existing public owner.
The old actions and observables remain strict; a row is not closed by a related
row or by a route that merely looks similar.

## Composer acceptance: REJECT

Command and result:

```text
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16600 ATOLL_TEST_MOCK_PORT=20000 npx playwright test tests/browser/f3-composer-target.spec.js --reporter=line --workers=1 --output=test-results-e-h-r32-composer-target
1 passed, 3 failed (45.8s): TC-0168 PASS; TC-0169/TC-0170/TC-0171 red

CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16601 ATOLL_TEST_MOCK_PORT=20001 npx playwright test tests/browser/f3-composer-baseline-0172-0175.spec.js --grep 'TC-0173' --reporter=line --workers=1 --output=test-results-e-h-r32-tc0173
TC-0173 failed after 30s waiting for its historical public button
```

### TC-0169 — REJECT / REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f3-composer-target.spec.js:48`,
  “F3-CT-02 过滤条收窄到一个 agent 时，默认收件人跟着它走”; successor
  [f3-composer-target.spec.js:42](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:42).
- **Capability/invariant:** selecting one public member filter must make the
  Composer recipient follow that filter; the visible status must be `@Claude`,
  source title `跟随筛选`, and filter-derived class. Clearing the filter must
  remove that source reason.
- **Current public owner:** filter controls/state are
  [ConversationSurface.jsx:273](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:273)
  and [useTimelinePreferences.js:73](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useTimelinePreferences.js:73);
  the public bridge is [WorkspaceApp.jsx:829](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:829),
  and status rendering is [Composer.jsx:418](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:418).
- **Exact red:** reset `multi-channel`, login, click the second public filter,
  then retain title/text/class/clear assertions. Text changed to `@Claude`,
  but title was `@Claude · @Claude` and class `composer-target is-direct`, not
  `/跟随筛选/`; see
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-composer-target/f3-composer-target-F3-CT-02-过滤条收窄到一个-agent-时，默认收件人跟着它走/error-context.md:1).
- **Owner request:** preserve filter authority/source provenance in the public
  Composer model. Acceptance requires the unchanged full click → title/class →
  clear sequence; text-only `@Claude` is insufficient.

### TC-0170 — REJECT / REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f3-composer-target.spec.js:65`,
  “F3-CT-03 编辑框里的 @ 压过筛选”; successor
  [f3-composer-target.spec.js:58](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:58).
- **Capability/invariant:** after the filter has selected one agent, the user
  can type `@` and select another agent; the explicit mention must override the
  filter. The precondition title is `跟随筛选`; after selection title is
  `由 @ 指定` and exactly one recipient chip remains.
- **Current public owner:** mention query/selection remains public at
  [Composer.jsx:221](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:221)
  and [Composer.jsx:252](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:252);
  filter handoff remains [WorkspaceApp.jsx:829](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:829).
- **Exact red:** the unchanged filter → mention action was run independently.
  It stopped at the strict precondition: title was `@Claude · @Claude`, not
  `/跟随筛选/`; the mention action was not replaced or inferred green. Evidence:
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-composer-target/f3-composer-target-F3-CT-03-编辑框里的-压过筛选/error-context.md:1).
- **Owner request:** fix the filter-derived provenance first, then preserve the
  separate explicit-mention override phase. Acceptance requires both phases in
  this case without loosening the source-title or one-chip assertions.

### TC-0171 — REJECT / REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f3-composer-target.spec.js:82`,
  “F3-CT-04 无收件人是警告格，不是留白；且横幅恒不整块进出”; successor
  [f3-composer-target.spec.js:74](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:74).
- **Capability/invariant:** entering a no-recipient channel must leave an
  explicit stable warning surface. `.composer-disabled-reason` and the
  recipient status remain visible; status is `is-none is-muted`, exact text
  `⚠ 无收件人`, and title explains how to choose a member.
- **Current public owner:** access gating and placeholder selection are
  [WorkspaceApp.jsx:87](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:87)
  and [WorkspaceApp.jsx:837](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:837);
  when Composer is mounted, its warning rail is
  [Composer.jsx:444](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:444).
- **Exact red:** reset/login, click public `c0.public`, and run the original
  warning assertions. The first check found no `.composer-disabled-reason`
  because the page showed `频道内容不可访问`; evidence:
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-composer-target/f3-composer-target-F3-CT-04-无收件人是警告格，不是留白；且横幅恒不整块进出/error-context.md:1).
- **Owner request:** preserve a discoverable no-recipient warning under the
  current access path. A generic inaccessible placeholder is not equivalent;
  all exact status/title/geometry checks remain acceptance gates.

### TC-0173 — REJECT / REGRESSION / MISSING PUBLIC OWNER

- **Baseline/title:** `fae8b70:tests/browser/f3-dynamic.spec.js:40`,
  “F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达”; successor
  [f3-composer-baseline-0172-0175.spec.js:46](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:46).
- **Capability/invariant:** a multiline draft survives opening/closing the
  public channel-file picker; the user returns to 动态, sends to steward, and
  reaches the turn on 320px without horizontal overflow or task controls.
- **Current public owner:** Composer's only attachment control remains local
  upload at [Composer.jsx:436](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:436);
  channel artifacts are owned by Files. There is no public Composer action
  named `从频道文件选择`.
- **Exact red:** reset `long-running/1302`, login, type both historical lines,
  then click the unchanged public button. Chromium timed out waiting for that
  button before any later draft/send/geometry check; evidence:
  [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-tc0173/f3-composer-baseline-0172--59cca-5-键盘、多行草稿、附件入口与-320px-单表面可达/error-context.md:1).
- **Owner request:** supply one public channel-file action or an explicit
  product decision. Do not substitute the local upload input/private Files
  selector, and rerun the whole old draft → picker → return → send → 320px
  sequence afterward.

## F5 owner packets: all four remain open

The strict rerun used `tests/browser/f5-governance-baseline-0191-0195.spec.js`
with fresh Chromium/mock pairs at ports 16603/20003, 16604/20004,
16607/20007, and 16606/20006 (the first 16605/20005 allocation was already in
use and was not treated as evidence). Results: TC-0192,
TC-0193, TC-0194, and TC-0195 all failed at their first historical
observable. The governance candidate `6b51c7d` changed the public rail action to
the existing overview side panel, but did not provide the old independent modal
contract.

### TC-0192 — Governance / channel-create owner

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:40`,
  “F5-003 新建频道是独立 Modal 并保持四步收敛”; successor
  [f5-governance-baseline-0191-0195.spec.js:55](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:55).
- **Capability/invariant:** public `新建频道` opens an independent dialog;
  entering a name and creating it shows four confirmed stages (`账本确认`,
  `频道可观察`, `成员关系`, `服务就绪`) before entering the new channel.
- **Current owner:** rail action [WorkspaceLayout.jsx:93](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:93)
  routes through [WorkspaceApp.jsx:1357](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1357)
  to `ContextHost`/`ChannelAdministrationPanel`; the current “创建子频道”
  form is [GovernanceFeature.jsx:78](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/governance/GovernanceFeature.jsx:78).
- **First red:** `role=dialog name=新建频道` is absent immediately after the
  unchanged button click; see [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-tc0192/f5-governance-baseline-019-e042e-5-003-新建频道是独立-Modal-并保持四步收敛/error-context.md:1).
- **Owner handoff:** preserve modal/focus and all four confirmed stage
  observables, or obtain an explicit product decision; do not migrate this
  test to the overview form.

### TC-0193 — Activity → WorkItem owner

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:55`,
  “F5-004 Activity 去重并返回 WorkItem 来源”; successor
  [f5-governance-baseline-0191-0195.spec.js:70](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:70).
- **Capability/invariant:** Activity contains one canonical `Approve mock
  actionc0` row; clicking it opens the source WorkItem detail and exact
  `channels/c0/tasks?focus=work_item` route. Row presence alone is insufficient.
- **Current owner:** row rendering/click is [WorkspaceFeatures.jsx:41](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:41),
  Activity projection is [WorkspaceApp.jsx:1197](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1197),
  and navigation callback is [WorkspaceApp.jsx:1184](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1184).
  Existing task-detail navigation is [WorkspaceApp.jsx:717](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:717).
- **First red:** unique row count passed, but clicking it produced no
  `工作项详情`; evidence [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-tc0193/f5-governance-baseline-019-513a1--Activity-去重并返回-WorkItem-来源/error-context.md:1).
- **Owner handoff:** route the canonical Activity source to the existing
  `openTaskItem` owner while retaining deduplication and exact focus URL.

### TC-0194 — Governance creation/operation owner

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:66`,
  “F5-004 创建操作进入 Operation Center 并可回到原频道回合”; successor
  [f5-governance-baseline-0191-0195.spec.js:81](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:81).
- **Capability/invariant:** create `operation-room` through the historical
  channel-create flow, observe ledger confirmation, open Activity → 操作,
  select exactly one operation, and return to the original channel's
  `创建子频道` turn and 回合详情.
- **Current owner:** creation is `ChannelOverview`/`submitGovernance` at
  [WorkspaceApp.jsx:1032](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1032);
  operation projection is [WorkspaceApp.jsx:1218](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1218);
  public return callback is [WorkspaceApp.jsx:1184](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1184).
- **First red:** after unchanged `新建频道` click, the historical modal name
  input never appeared and timed out; evidence [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-tc0194/f5-governance-baseline-019-e21a6--Operation-Center-并可回到原频道回合/error-context.md:1).
- **Owner handoff:** preserve the complete create receipt → durable operation
  row → original turn/detail return. Do not skip the modal front half or use a
  live activity snapshot as a durable operation fact.

### TC-0195 — Search → WorkItem/revocation owner

- **Baseline/title:** `fae8b70:tests/browser/f5-management.spec.js:86`,
  “F5-005 全局搜索恢复频道、视图和 focus，权限撤销后不泄漏缓存”; successor
  [f5-governance-baseline-0191-0195.spec.js:101](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f5-governance-baseline-0191-0195.spec.js:101).
- **Capability/invariant:** search result returns to `c0.project` Tasks with
  WorkItem detail and exact focus URL; revocation removes detail, makes Tasks
  inaccessible, and removes the repeated search result.
- **Current owner:** Search result action is [SearchFeature.jsx:22](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/search/SearchFeature.jsx:22);
  source identity is built at [feature-search.js:312](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/feature-search.js:312);
  dispatch is [WorkspaceApp.jsx:1145](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1145)
  and detail/focus owner is [WorkspaceApp.jsx:717](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:717).
- **First red:** result count and heading `c0.project` passed, but no
  `工作项详情` appeared before the revoke half; evidence [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r32-tc0195/f5-governance-baseline-019-53ff5-搜索恢复频道、视图和-focus，权限撤销后不泄漏缓存/error-context.md:1).
- **Owner handoff:** preserve canonical WorkItem identity through open/focus,
  then independently prove access revocation and no cached search leakage. The
  later revoke assertions remain unproven until the first detail red is fixed.

## Boundary

Composer verdict is `REJECT` (0 of the four requested regressions accepted).
F5 TC-0192–0195 are four separate open regression packets. No source, vendor,
package/lockfile, private export, skip, deletion, or compatibility owner was
added.
