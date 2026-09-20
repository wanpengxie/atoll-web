# A–D Round 37 — F5 Activity/Search and AD-153 verification

Date: 2026-09-20

Scope: independent verification of the Shell Activity candidates and the
Governance AD-153 baseline. This round changed tests and A–D audit evidence
only; no product source, vendor, package, lockfile, or private export changed.

## Case records

| Case | User capability | Invariant / public owner | Action and evidence | Result / disposition |
|---|---|---|---|---|
| `TC-0193 F5-004 Activity 去重并返回 WorkItem 来源` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:70`) | See one canonical Activity WorkItem and return to its focused task detail. | Activity data is deduplicated and the current Shell owns channel/view/focus navigation. | Reset `approval-schema/1503`, login, open Activity, click `Approve mock actionc0`, assert WorkItem detail and `tasks?focus=work_item`; targeted Chromium run: **1 passed**. | **PASS behaviorally.** The Round 36 owner audit remains: `WorkspaceFeatures` still assigns `location.hash` directly, so this pass does not approve a second router. No product edit was made. |
| `TC-0194 F5-004 创建操作进入 Operation Center 并可回到原频道回合` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:81`) | After delayed channel creation, see the operation and return to the originating channel turn. | Operation Center must consume a durable request/ledger/OBS/membership/serving projection and preserve the typed `turn` source; `agentActivity.active` is not a governance ledger. | Reset `channel-governance-delay/1504`, create `operation-room`, observe ledger confirmation, close the create dialog, open Activity → 操作; `创建频道 operation-room` count stayed **0**. | **REGRESSION / product gap.** First divergence is the current `WorkspaceApp.activityPort` Operation projection; it has no channel-create operation row. Kept as an explicit product handoff; no expected-fail or fabricated row was added. |
| `TC-0195 F5-005 全局搜索恢复频道、视图和 focus，权限撤销后不泄漏缓存` (`tests/browser/f5-governance-baseline-0191-0195.spec.js:101`) | Search a visible WorkItem, restore its channel/task focus, then revoke access and remove detail, task content, and the repeated search result. | Search is access-scoped; the public status notice and inaccessible task region are distinct current DOM owners. | Initial run stopped on a page-wide text selector matching three repeated copies of the same user wording, then on the obsolete `tabpanel` role. The test now scopes the notice to `role=status` and the task denial to `role=region[name="任务"]`; no product text changed. Rerun: **1 passed (7.2s)**. | **PASS after fixture/selector migration.** The two selector changes preserve the old user-visible observations and remove test ambiguity; no product implementation or copy was altered. |
| `AD-153 明确展示四步收敛，ready 后将新频道交给进入回调` (`channel-create-modal.test.jsx:40`, original baseline `channel-create-modal.test.jsx:105`) | See ledger/OBS/membership/serving independently, with entry enabled only after all facts converge. | `WorkspaceRightPanel → GovernanceFeature.ChannelCreateModal` consumes request-keyed typed `creation`; Shell owns `enterChannel`; a receipt or same-name child cannot imply ready. | Unit test drives a real public modal command, proves all four stage labels and no enter button after an accepted-but-unsettled receipt, then supplies typed facts and asserts four `已确认` stages plus `enterChannel({channelId:'c0.research', view:'conversation'})`. Targeted unit: **2 tests passed** (`AD-149`, `AD-153`). Browser TC-0192 independent end-to-end convergence/enter: **1 passed (6.6s)**. | **PASS.** The prior Round 35 BLOCKED owner handoff is superseded by the current typed projection already present at the frozen head; this round itself changed no product code. |

## Test-only changes

- `tests/browser/f5-governance-baseline-0191-0195.spec.js`: replaced the
  ambiguous page-wide revocation text query with the unique public `status`
  surface, and replaced the obsolete `tabpanel` role with the current public
  `任务` region. The old text, focus, revocation, cache, and search-result
  assertions remain strict.
- `tests/channel-create-modal.test.jsx`: added the one canonical AD-153
  public-owner case. It does not infer readiness from a command promise.
- `tests/blocked-round26-public-owner.test.jsx`: updated the retained AD-153
  owner evidence from the old side-panel fixture to the current public modal;
  its bare-request convergence assertion remains green and is not an
  expected-fail.
- `audit-output/RESTORE-CASES-A-D-20260919.md`: AD-153 moved to PASS with the
  independent unit/browser evidence. `A-D-UNIT-MIGRATION-VERIFICATION` records
  the resulting **326 PASS / 0 REGRESSION / 39 BLOCKED** ledger.

## Unresolved evidence

- TC-0194 remains a real Operation projection regression. The first public
  owner boundary and typed Shell/Operation contract are recorded in the Round
  36 packet; this round did not modify Activity, Workspace, Feed, or Shell
  product code.
- The full retained Round 35 Governance-owner suite still has an unrelated
  failed-ledger-terminal assertion; it is not counted as AD-153 completion and
  is not hidden by this focused green result.
- No baseline declaration was deleted or skipped. No expected-fail assertion
  is counted as PASS.
