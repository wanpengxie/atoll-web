# A–D Round 38 — Shell Activity clean candidate and Governance retry

Date: 2026-09-20

Scope: strict re-verification after Shell candidate `3847f8f`. Only test/audit
files are changed in this round; no product source, vendor, package, lockfile,
or private export was changed.

## Case records

| Case | User capability and invariant | Current public owner | Evidence | Result |
|---|---|---|---|---|
| `TC-0193 F5-004 Activity 去重并返回 WorkItem 来源` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:70`) | Activity shows one canonical WorkItem and returns to the focused task detail; Shell remains the sole channel/view/focus owner. | `WorkspaceApp.activityPort` → typed source navigation → Shell navigation; `WorkspaceFeatures.ActivityFeature` only renders/dispatches the source. | Chromium with fresh ports `16683/20083`, `--grep 'TC-019[345]'`: **1 passed**. | **PASS.** The clean candidate routes through the typed source command; no second Activity hash router is added by the test. |
| `TC-0194 F5-004 创建操作进入 Operation Center 并可回到原频道回合` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:81`) | Delayed channel creation appears as an Operation and returns to the originating `system.channel.create` turn. | `WorkspaceApp.activityPort` durable timeline projection plus typed source navigation. | Same fresh Chromium matrix: operation row found, clicked, original turn detail and `c0` verified; **1 passed**. | **PASS.** `3847f8f` supplies the missing channel-create Operation projection and canonical turn source. |
| `TC-0195 F5-005 全局搜索恢复频道、视图和 focus，权限撤销后不泄漏缓存` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:101`) | Search restores channel/task focus, then revocation removes detail, task content, and the repeated search result. | Search source navigation and access-scoped WorkItem/task owner. | Same matrix: **1 passed** after the Round 37 public `status`/`任务` region selectors; no copy or product selector was changed. | **PASS.** Strict observable assertions remain intact. |
| `AD-153 明确展示四步收敛，ready 后将新频道交给进入回调` (`tests/channel-create-modal.test.jsx:40`) | A request receipt alone cannot enable entry; ledger, OBS, membership, and serving must all confirm before the typed Shell enter command. | `WorkspaceRightPanel → GovernanceFeature.ChannelCreateModal`; `commands.enterChannel` is the Shell port. | `npx vitest run tests/channel-create-modal.test.jsx tests/blocked-round26-public-owner.test.jsx -t '\[AD-153\]'`: **2 passed**; TC-0192 fresh Chromium port `16684/20084`: **1 passed (8.9s)**. | **PASS.** No expected-fail result is counted. |
| `AD-154 提交失败与账本失败都保留输入并允许重试` (`tests/blocked-round35-governance-public-owner.test.jsx:117`) | A matching failed ledger terminal keeps the name draft, exposes a user-visible failure state, and offers retry without offering entry. | `GovernanceFeature.ChannelCreateModal` consumes `port.creation` facts. | `npx vitest run ... -t 'AD-153|failed ledger terminal'`: AD-153 **2 passed**, AD-154 **1 failed**. First assertion: expected `创建失败`; current progress remains `正在收敛`, error text is present, and no `重新创建` button exists. | **REGRESSION / product gap.** The older `ChannelAdministrationPanel` fixture was not used to mask this current modal owner. Product owner must map `creation.failed/error` to a failed convergence state and retry affordance. |

## Disposition and counts

- TC-0193/0194/0195 are independently green on `3847f8f`; TC-0194's former
  missing Operation row is closed by the existing Shell owner commit, not by a
  test relaxation.
- AD-153 is PASS through the typed public modal/Shell contract.
- AD-154 is a real regression at the first public `GovernanceFeature` owner;
  it remains ordinary red evidence and is not converted to `it.fails`.
- The A–D ledger changes from Round 37's `326 PASS / 0 REGRESSION / 39 BLOCKED`
  to **325 PASS / 1 REGRESSION / 39 BLOCKED** because the prior AD-154 PASS
  was based on a non-equivalent side-panel fixture.
- No declaration was deleted or skipped; no expected-fail result is counted as
  completion.
