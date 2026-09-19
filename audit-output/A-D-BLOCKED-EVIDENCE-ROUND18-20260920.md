# A–D blocked-evidence recovery, round 18 (2026-09-20)

This packet selects exactly 20 rows from the 82-row blocked remainder.
The scope avoids flat/cache, Reading, and Composer conflict surfaces and
covers the current public target-handoff and governance/permission/failure
owners. Every row retains its baseline user capability and invariant. An
`expected fail` is evidence of the current public gap, not a recovered case.

## Focused result

```text
npx vitest run tests/blocked-round18-public-owner.test.jsx --reporter=dot

Test Files  1 passed (1)
Tests       4 passed | 16 expected fail (20)
```

Four rows are promoted to PASS in the ledger: AD-096, AD-098, AD-154, and
AD-191. The other 16 rows remain BLOCKED. No source, vendor, package,
lockfile, private export, deletion, or skip was introduced.

## Per-case evidence

| ID | User capability | Invariant | Current public owner and setup/action | Result / disposition |
|---|---|---|---|---|
| AD-096 | 切换已发出但目标尚未 commit 时，旧频道终端入口立即不可用。 | Terminal command 只能绑定 committed channel。 | `WorkspaceLayout` renders c0, clicks public c1 rail selection, and inspects the public `workspace-terminal-toggle` at [`blocked-round18-public-owner.test.jsx:55`](../tests/blocked-round18-public-owner.test.jsx:55). | **PASS**: the handoff gate disables the old terminal entry until commit. |
| AD-097 | A→B 未 commit 时快速反选 A，应取消旧 pending。 | 最新用户选择是唯一 pending owner。 | `WorkspaceLayout` public rail selection at [`blocked-round18-public-owner.test.jsx:65`](../tests/blocked-round18-public-owner.test.jsx:65). | **BLOCKED**: expected fail; same-channel reselect returns before clearing the pending target. |
| AD-098 | 第三频道 committed 后应 supersede 旧 target。 | 新 committed identity 清除旧 pending，不能继续控制 terminal。 | `WorkspaceLayout` selects c1, then receives committed c2 navigation and checks the public terminal entry at [`blocked-round18-public-owner.test.jsx:75`](../tests/blocked-round18-public-owner.test.jsx:75). | **PASS**: the different committed identity clears the old pending gate. |
| AD-099 | 无效 target 被拒绝并退回原频道后，旧 pending 应结束。 | Directory rollback 与 shell pending 必须同一 handoff。 | `WorkspaceLayout` public navigation is rerendered with the invalid target boundary at [`blocked-round18-public-owner.test.jsx:90`](../tests/blocked-round18-public-owner.test.jsx:90). | **BLOCKED**: expected fail; no current public directory rollback/fallback owner is exposed to the shell. |
| AD-101 | 窄屏文件/终端覆盖消息面时发布 `false`，返回消息面恢复 `true`。 | Surface visibility 是显式事实，不由 CSS 猜测。 | `WorkspaceLayout` mobile topology/terminal boundary at [`blocked-round18-public-owner.test.jsx:105`](../tests/blocked-round18-public-owner.test.jsx:105). | **BLOCKED**: expected fail; current shell does not publish `data-surface-visible`. |
| AD-105 | 快速 A→B→A 只交接最终选择。 | 旧 pending 不能抢焦点或 terminal owner。 | `WorkspaceLayout` public rail selection at [`blocked-round18-public-owner.test.jsx:118`](../tests/blocked-round18-public-owner.test.jsx:118). | **BLOCKED**: expected fail; current same-channel early return leaves the first pending selection. |
| AD-106 | 离开频道再回来仍保留该频道 terminal split。 | PTY/session/layout visibility 按 channel 隔离并保留。 | `WorkspaceLayout` public channel rerenders at [`blocked-round18-public-owner.test.jsx:128`](../tests/blocked-round18-public-owner.test.jsx:128). | **BLOCKED**: expected fail; committed navigation does not publish retained per-channel visibility. |
| AD-108 | 收起一个频道的 split 不影响另一个频道。 | Terminal visibility 是 channel-scoped。 | `WorkspaceLayout` public channel rerenders at [`blocked-round18-public-owner.test.jsx:140`](../tests/blocked-round18-public-owner.test.jsx:140). | **BLOCKED**: expected fail; current shell exposes only committed-channel visibility. |
| AD-149 | 独立创建对话框打开并首先聚焦名称。 | Create dialog owns focus and submit lifecycle. | Current `ChannelAdministrationPanel` boundary at [`blocked-round18-public-owner.test.jsx:162`](../tests/blocked-round18-public-owner.test.jsx:162). | **BLOCKED**: expected fail; current owner is a side panel, not the baseline independent dialog/focus owner. |
| AD-150 | 创建时可把当前频道 Agent 带入 initial actor seats。 | Seat choice来自当前公开 roster，不能猜测。 | Current governance panel boundary at [`blocked-round18-public-owner.test.jsx:170`](../tests/blocked-round18-public-owner.test.jsx:170). | **BLOCKED**: expected fail; current panel has no Agent-seat selector. |
| AD-151 | 先读取模板 body，再发送公开 recipe create。 | Create 不能只把模板 ID 当 recipe。 | Current governance panel template combobox/submit at [`blocked-round18-public-owner.test.jsx:177`](../tests/blocked-round18-public-owner.test.jsx:177). | **BLOCKED**: expected fail; current panel sends one create command and no template-get phase. |
| AD-152 | 模板 compact closure 稳定提示详情不可用，不把缺 recipe 猜成业务失败。 | 缺失结果是 unavailable，不是 fabricated recipe/error。 | Current governance panel at [`blocked-round18-public-owner.test.jsx:189`](../tests/blocked-round18-public-owner.test.jsx:189). | **BLOCKED**: expected fail; no template closure/result owner is exposed. |
| AD-153 | 明确展示 ledger/OBS/membership/serving 四步，ready 后再进入。 | 单个 command receipt 不能宣告 serving ready。 | Current governance create action at [`blocked-round18-public-owner.test.jsx:197`](../tests/blocked-round18-public-owner.test.jsx:197). | **BLOCKED**: expected fail; no four-step convergence region or enter owner exists. |
| AD-154 | 提交失败和 ledger failure 都保留输入并允许 retry。 | Failure lifecycle 不得清空 draft，retry 使用同一公开输入。 | `ChannelAdministrationPanel` submit rejection, external `operation` failure, and second submit at [`blocked-round18-public-owner.test.jsx:206`](../tests/blocked-round18-public-owner.test.jsx:206). | **PASS**: current public panel retains name/purpose through both failure facts and leaves create retryable. |
| AD-155 | 支持 Escape、遮罩关闭、焦点闭环及关闭后 focus return。 | Independent dialog owns full focus lifecycle. | Current governance side-panel boundary at [`blocked-round18-public-owner.test.jsx:229`](../tests/blocked-round18-public-owner.test.jsx:229). | **BLOCKED**: expected fail; side panel does not expose the baseline dialog/backdrop/focus-trap owner. |
| AD-191 | 标准/foundation actor 受保护，内部 declaration 不进入业务候选。 | System/genesis identity 与 ordinary business actor 分离。 | Current `ChannelAdministrationPanel` roster/declaration projection at [`blocked-round18-public-owner.test.jsx:237`](../tests/blocked-round18-public-owner.test.jsx:237). | **PASS**: system/genesis roster rows and internal declarations are filtered while ordinary human/Agent rows remain. |
| AD-192 | 用户选择器只接受真实 human principal。 | Agent/retired identities 不能成为 human admission target。 | Current `WorkspaceApp` governance-port boundary reproduced through the public panel at [`blocked-round18-public-owner.test.jsx:263`](../tests/blocked-round18-public-owner.test.jsx:263). | **BLOCKED**: expected fail; the panel assumes upstream filtered principals and does not itself reject mixed non-human/retired rows. |
| AD-193 | Create success must separately converge ledger, OBS, membership, and serving. | Readiness is the conjunction of independent facts. | Current create command/refresh port at [`blocked-round18-public-owner.test.jsx:280`](../tests/blocked-round18-public-owner.test.jsx:280). | **BLOCKED**: expected fail; current owner exposes one submit + directory refresh only. |
| AD-194 | Member operation keeps ledger terminal and roster convergence separate. | Terminal receipt cannot fabricate roster state. | Current member tab/refresh port at [`blocked-round18-public-owner.test.jsx:290`](../tests/blocked-round18-public-owner.test.jsx:290). | **BLOCKED**: expected fail; no public owner exposes the two convergence facts together. |
| AD-195 | Compact closure retains lifecycle but missing business result is not ready. | Unavailable result must remain unavailable. | Current governance operation boundary at [`blocked-round18-public-owner.test.jsx:300`](../tests/blocked-round18-public-owner.test.jsx:300). | **BLOCKED**: expected fail; no current channel-governance compact-closure result owner exists. |

## Ledger and boundary handoff

The ledger now records **287 PASS / 0 REGRESSION / 78 BLOCKED**. The four
promoted rows are AD-096, AD-098, AD-154, and AD-191. The 16 expected-fail
assertions remain explicit blocked evidence and are not counted as completion,
obsolete cases, deletion, or skip. Existing Activity/Operation gaps AD-002–004
remain unchanged and are documented by the round-16/round-15 packets.

This packet changes only the A–D test and audit-report boundary. It does not
touch flat/cache, Reading, Composer, Feed runtime, terminal/node/restart
product code, vendor, package manifests, lockfiles, or private production
exports.
