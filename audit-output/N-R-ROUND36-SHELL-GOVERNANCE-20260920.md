# N–R Round 36：Shell / Files picker / Governance public-owner audit

审计检查点：当前共享工作树 `0152f07`。该检查点之后仍有其他分区的 dirty
候选（包括 `src/app/WorkspaceApp.jsx`、`src/app/hooks/useWireSession.js`）；本轮
没有编辑这些产品文件，也没有把它们纳入本交付。N–R 原始账本的唯一未继续编号仍是
`NR22-01`；本轮新增的是 owner 回归证据，不虚构新的 baseline row。

## 执行合同与边界

完整遵守 `docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`：测试从
`WorkspaceApp`、`WorkspaceFeatureOverlays`、`WorkspaceRightPanel` 和
`GovernanceFeature` 的公开入口观察能力；没有导出 `useWireSession`、旧
`createSessionRoster` 或其它私有 helper，没有恢复旧 store/API，没有删/skip 红例。
新增的 invalid Files row 例通过公开 `WorkspaceApp → Composer command port →
WorkspaceFeatureOverlays` 链路驱动，而不是手动调用私有 `chooseChannelFile`。

## 当前合同矩阵

| case / owner | 当前观察 | 裁决 | 首断点或证据 |
|---|---|---|---|
| Files picker focus trap + sibling inert | 真实公开 overlay 的 close focus、Tab/Shift+Tab wrap、外部 sibling `aria-hidden` 通过 | ACCEPT | `tests/workspace-file-picker.test.jsx`；picker Chromium focus case 通过 |
| Files refresh reject / error settle | refresh reject 与 Files error 都 resolve `null`，错误 dialog 保持可见 | ACCEPT | `tests/workspace-file-picker.test.jsx` 2 cases |
| Files invalid row settle | 公开 Workspace 组合中缺 `resourceId` 的 file row 令 Composer promise resolve `null`，picker 保持可见，未 attach | ACCEPT | `tests/workspace-real-runtime-composition.test.jsx` 新增 case；1 file / 8 passed |
| Mobile Shell channel drawer focus trap/inert | 打开后 close autofocus、Escape restore 通过；Tab 到最后一个后没有回到第一个，且 Shell 没有 modal inert boundary | REJECT / product gap | `tests/n-r-round35-shell-filter-notification.test.jsx:64`；实际 active element 为 `#c1`，预期 global search button；owner 是 `WorkspaceLayout` drawer lifecycle |
| Composer manual target > filter fallback | 真实 `WorkspaceApp` composition 中手选 Agent 后，Conversation filter callback 不覆盖手选 target | ACCEPT | `tests/workspace-real-runtime-composition.test.jsx`；同套件该 case 通过 |
| Governance creation session correlation | 同名旧 child 不满足新 request；匹配 typed creation facts 后仅走 `commands.enterChannel`，不写 `location.hash` | ACCEPT / public feature contract | `tests/blocked-round35-governance-public-owner.test.jsx` 2/2；无私有 owner import |
| Governance create dialog public entry | `WorkspaceRightPanel` 打开真实 create dialog、焦点到名称、submit 使用 typed `create_child` command，并保持四步收敛等待 | ACCEPT | `tests/channel-create-modal.test.jsx` 通过 |
| Governance template selection port | `ChannelAdministrationPanel` 选择模板后仅从公开 command port 发 `templateId`，并请求 directory refresh | ACCEPT / feature-level | `tests/n-r-round34-picker-governance.test.jsx` 通过 |
| Registrar list → get/body → recipe create（真实 Chromium） | 公开 Workspace 治理端口已接通 directory refresh→list、matching get/body，再以 canonical recipe create；raw `templateId` 未进入 wire create | ACCEPT（dirty candidate） | `tests/browser/governance-template-wire-contract.spec.js`，当前 1/1 passed |

## 定向验证

当前 HEAD/dirty 候选上运行：

```text
npx vitest run \
  tests/n-r-round35-shell-filter-notification.test.jsx \
  tests/workspace-real-runtime-composition.test.jsx \
  tests/workspace-file-picker.test.jsx \
  tests/channel-create-modal.test.jsx \
  tests/blocked-round35-governance-public-owner.test.jsx \
  tests/n-r-round34-picker-governance.test.jsx --reporter=dot

6 files, 20 passed, 1 failed
RED: n-r-round35 ... mobile channel drawer focus wrap
Canvas getContext 输出是既有 jsdom warning，不是失败。
```

公开 Governance / picker 合同子集：

```text
npx vitest run tests/blocked-round35-governance-public-owner.test.jsx \
  tests/n-r-round34-picker-governance.test.jsx --reporter=dot
2 files, 5 passed
```

真实 Chromium picker（端口由本次命令显式隔离；dirty 的 multiline parent case 排除，未改它）：

```text
ATOLL_TEST_WEB_PORT=16993 ATOLL_TEST_MOCK_PORT=18993 \
npx playwright test \
  tests/browser/composer-channel-file-picker-contract.spec.js \
  tests/browser/governance-template-wire-contract.spec.js \
  --grep-invert 'multiline draft' --reporter=line

4 passed, 1 failed
RED（本组命令所含治理链在当时 dirty 接线前的运行记录）：governance-template-wire-contract.spec.js:56

治理候选接线出现后重跑：

```text
ATOLL_TEST_WEB_PORT=16996 ATOLL_TEST_MOCK_PORT=18996 \
npx playwright test tests/browser/governance-template-wire-contract.spec.js --reporter=line

1 passed
```

F5 治理支持复验：

```text
ATOLL_TEST_WEB_PORT=16995 ATOLL_TEST_MOCK_PORT=18995 \
npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js --reporter=line

3 passed, 2 failed
PASS: TC-0191 member owner, TC-0192 create dialog/four-step convergence, TC-0193 activity source
UNRESOLVED supporting cases: TC-0194 operation row absent; TC-0195 strict revoke-text selector
matched three legitimate access surfaces. These are outside the N–R baseline ledger and are
not upgraded or weakened here.
```

## 回归包与 owner handoff

### Shell drawer focus/inert（REJECT）

最小复现：`WorkspaceLayout` 公开 Shell 打开“频道列表”→聚焦最后一个可聚焦控件→
Tab；焦点停在 `#c1`，没有回到 drawer 第一控件（反向 Shift+Tab 同样未建立闭环）。
Escape 仍关闭 drawer 并恢复 opener。首个 divergence 在 `WorkspaceLayout` 的
`mobileChannelsOpen` effect：当前只做 close autofocus/Escape listener，没有 modal
focus trap，也没有把应用 sibling 标成 inert。不得通过跳过 Tab 断言或把 drawer 当
普通导航来改写能力。

### Registrar template session（ACCEPT on current dirty candidate）

真实 Chromium 登录 `channel-governance`→频道操作→频道详情→概览→刷新目录事实后，
当前 dirty candidate 已由同一公开 `governancePort` 发出 list receipt，随后选择真实
Registrar row 触发 matching get/body，最后 create frame 只含 canonical `recipe`，没有
raw `templateId`。`governance-template-wire-contract.spec.js` 当前 1/1 passed，故这条
链在当前候选上 ACCEPT。接线证据位于公开 port 的 `refresh('directory')`、`listTemplates`、
`getTemplate`、`creation` 与 `enterChannel`，不是测试预置行或手工 runtime bind。

此前 list=0 的结果保留在上面的历史 dirty 记录，仅作为候选修复前首断点，不再作为
当前 HEAD 结论。

## 越界审计

本轮实际改动仅：

- `tests/workspace-real-runtime-composition.test.jsx`：公开 Workspace picker
  invalid-row case；
- 本审计报告。

未改 `src/`、`vendor/`、package manifest、lockfile；未导出私有函数，未恢复旧 owner，
未删除或 skip 任何 case。当前共享工作树其它 agent 的 dirty source/test/report 不在
本提交范围。
