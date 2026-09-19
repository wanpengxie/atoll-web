# A–D blocked-evidence recovery, round 19 (2026-09-20)

This packet independently exercises 20 rows from the 78-row blocked remainder
at round start through their current public owners. During the packet, the
already landed shell owner `3d1c061` closed AD-101, so the current remainder
is 77 rows. The packet deliberately avoids Search,
Reading, cache/startup, and Activity/Operation. The packet covers navigation,
create-channel governance, governance convergence, and principal-scoped
control recovery. Every row retains the baseline user capability and
invariant. An `expected fail` is current product-gap evidence, not a recovered
case.

## Focused result

```text
npx vitest run tests/blocked-round19-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       1 passed | 19 expected fail (20)
```

AD-101 is green through the already landed `WorkspaceLayout` owner
(`3d1c061`). The other 19 assertions remain BLOCKED. Expected-fail assertions
are not counted as completion, obsolete cases, deletion, or skip. The ledger
after this packet is **288 PASS / 0 REGRESSION / 77 BLOCKED**.

## Per-case evidence

| ID | User capability | Invariant | Current public owner and setup/action | Result / disposition |
|---|---|---|---|---|
| AD-097 | A→B 未 commit 时快速反选 A，旧 pending 应结束。 | 最新用户选择是唯一 pending owner。 | `WorkspaceLayout` renders c0, clicks c1 then c0 on the public rail at [`blocked-round19-public-owner.test.jsx:68`](../tests/blocked-round19-public-owner.test.jsx:68). | **BLOCKED**: expected fail; same-channel reselect returns before clearing the first pending target. |
| AD-099 | 失效 target 回滚到原频道后结束旧 pending。 | Directory rollback 与 terminal handoff 必须共享 committed identity。 | `WorkspaceLayout` selects c1, rerenders the public navigation with origin c0 and no channel at [`blocked-round19-public-owner.test.jsx:78`](../tests/blocked-round19-public-owner.test.jsx:78). | **BLOCKED**: expected fail; the shell has no public invalid-target rollback fact. |
| AD-101 | 窄屏 terminal 覆盖 Dynamic 时发布 `false`。 | Surface visibility 是显式事实而不是 CSS 猜测。 | `WorkspaceLayout` is rendered with the public mobile `matchMedia` boundary and terminal visible at [`blocked-round19-public-owner.test.jsx:93`](../tests/blocked-round19-public-owner.test.jsx:93). | **PASS**: `data-surface-visible=false` is published by owner `3d1c061`. |
| AD-105 | 快速 A→B→A 只交接最终目标。 | 旧 pending 不能抢焦点或 terminal owner。 | Public `WorkspaceLayout` rail selection at [`blocked-round19-public-owner.test.jsx:105`](../tests/blocked-round19-public-owner.test.jsx:105). | **BLOCKED**: expected fail; the stale first pending remains the only shell handoff state. |
| AD-106 | 切走频道再回来仍保留其 terminal split。 | PTY/session/layout visibility 按 channel 隔离并保留。 | Public `WorkspaceLayout` rerenders c0(open) → c1 → c0 at [`blocked-round19-public-owner.test.jsx:115`](../tests/blocked-round19-public-owner.test.jsx:115). | **BLOCKED**: expected fail; no current public per-channel retained terminal owner is exposed. |
| AD-108 | 收起一个频道的 split 不影响另一个频道。 | Terminal visibility 必须 channel-scoped。 | Public `WorkspaceLayout` rerenders c0/c1 visibility at [`blocked-round19-public-owner.test.jsx:133`](../tests/blocked-round19-public-owner.test.jsx:133). | **BLOCKED**: expected fail; current shell only receives committed-channel visibility. |
| AD-149 | 新建频道打开独立 dialog 并聚焦名称。 | Dialog owner 负责 focus 与 submit lifecycle。 | Current `ChannelAdministrationPanel` boundary at [`blocked-round19-public-owner.test.jsx:152`](../tests/blocked-round19-public-owner.test.jsx:152). | **BLOCKED**: expected fail; current owner is a side panel, not the baseline independent dialog/focus owner. |
| AD-150 | 创建时可带入当前频道 Agent seat。 | Seat 来源必须是公开 roster，不能猜测。 | Current governance panel receives a public Agent roster at [`blocked-round19-public-owner.test.jsx:160`](../tests/blocked-round19-public-owner.test.jsx:160). | **BLOCKED**: expected fail; no Agent-seat selector exists. |
| AD-151 | 模板 body 先读取再发送公开 recipe。 | Create 不能只发送 template ID。 | Current template combobox and create command at [`blocked-round19-public-owner.test.jsx:170`](../tests/blocked-round19-public-owner.test.jsx:170). | **BLOCKED**: expected fail; current port sends one `create_child` command and no template-get phase. |
| AD-152 | 模板 compact closure 缺 body 时稳定提示 unavailable。 | 缺失详情不能伪造 recipe 或业务失败。 | Current governance template boundary at [`blocked-round19-public-owner.test.jsx:182`](../tests/blocked-round19-public-owner.test.jsx:182). | **BLOCKED**: expected fail; no template closure/result owner is exposed. |
| AD-153 | 显示 ledger/OBS/membership/serving 四步，ready 后才进入。 | 单一 command receipt 不能宣告 serving ready。 | Current create action boundary at [`blocked-round19-public-owner.test.jsx:190`](../tests/blocked-round19-public-owner.test.jsx:190). | **BLOCKED**: expected fail; no four-step convergence region or enter owner exists. |
| AD-155 | 支持 Escape/遮罩关闭/焦点闭环及 focus return。 | Independent dialog owns the full focus lifecycle. | Current `GovernanceFeature`/`SidePanel` boundary at [`blocked-round19-public-owner.test.jsx:199`](../tests/blocked-round19-public-owner.test.jsx:199). | **BLOCKED**: expected fail; no create-dialog backdrop or focus-trap owner exists. |
| AD-192 | 用户选择器只接收真实 human principal。 | Agent/retired identities 不能成为 human admission target。 | Current governance panel receives mixed public principal rows at [`blocked-round19-public-owner.test.jsx:209`](../tests/blocked-round19-public-owner.test.jsx:209). | **BLOCKED**: expected fail; the panel assumes upstream filtering and the current public composition does not prove retired-principal exclusion at this boundary. |
| AD-193 | Create success 分别收敛 ledger、OBS、membership、serving。 | Readiness 是独立事实的 conjunction。 | Current `ChannelAdministrationPanel` create + refresh port at [`blocked-round19-public-owner.test.jsx:225`](../tests/blocked-round19-public-owner.test.jsx:225). | **BLOCKED**: expected fail; current owner exposes one submit plus directory refresh only. |
| AD-194 | 成员操作分别判断 ledger terminal 与 roster convergence。 | Terminal receipt 不能伪造 roster state。 | Current member tab and public refresh command at [`blocked-round19-public-owner.test.jsx:234`](../tests/blocked-round19-public-owner.test.jsx:234). | **BLOCKED**: expected fail; no public owner exposes both convergence facts or a ready state. |
| AD-195 | Compact closure 保留 lifecycle，缺业务结果不 ready。 | Unavailable result 必须保持 unavailable。 | Current externally supplied governance operation at [`blocked-round19-public-owner.test.jsx:247`](../tests/blocked-round19-public-owner.test.jsx:247). | **BLOCKED**: expected fail; no channel-governance compact-closure result owner exists. |
| AD-196 | Failed compact closure 保留失败 lifecycle，不猜失败原因。 | Failed 与 unavailable result 必须分开。 | Current create command rejects through the public governance command port at [`blocked-round19-public-owner.test.jsx:254`](../tests/blocked-round19-public-owner.test.jsx:254). | **BLOCKED**: expected fail; current owner reports a generic command failure and has no compact-closure unavailable result fact. |
| AD-197 | Compact result 缺失是稳定可观测的 unavailable 终态。 | 缺 result 不能进入 ready。 | Current completed operation boundary at [`blocked-round19-public-owner.test.jsx:264`](../tests/blocked-round19-public-owner.test.jsx:264). | **BLOCKED**: expected fail; no public compact-result phase/error is rendered. |
| AD-256 | 刷新后按 principal 恢复 control state，并把 sending 变 uncertain。 | Control recovery 必须 principal-scoped 且 durable。 | Public `useComposerSubmissionRuntime` cancel port is mounted, unmounted, and remounted with the same principal at [`blocked-round19-public-owner.test.jsx:297`](../tests/blocked-round19-public-owner.test.jsx:297). | **BLOCKED**: expected fail; runtime keeps control state in memory and restores no principal-scoped control record. |
| AD-257 | 只持久化可解释 active state，并序列化 Error。 | Persisted control errors must be bounded/serializable; unrelated states are discarded. | Public `useComposerSubmissionRuntime` receives a closed cancel error and is remounted at [`blocked-round19-public-owner.test.jsx:313`](../tests/blocked-round19-public-owner.test.jsx:313). | **BLOCKED**: expected fail; current submission owner does not persist/restore `controlStates` or the serialized error fact. |

## Boundary handoff

This packet changes only the A–D test and audit-report boundary. It does not
modify product source, vendor, package manifests, lockfiles, Search, Reading,
cache/startup, Feed runtime, Activity/Operation, private production exports,
or baseline declarations. AD-002–004 remain unchanged Activity/Operation
owner gaps. The 19 expected-fail rows are returned to their first current
public owners and must not be judged obsolete, deleted, skipped, or merged.
