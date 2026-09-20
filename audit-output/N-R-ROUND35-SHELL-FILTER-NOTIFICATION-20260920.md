# N–R Round 35：Shell focus / external channel cancel / filter fallback / notification leave

日期：2026-09-20  
当前验收基线：`74c85fa`（picker canonical route cancellation）、`54f122e`（following lease promotion fence）、`acac6c8`（timeline presentation）；本轮测试变更另见 `tests/n-r-round35-shell-filter-notification.test.jsx` 与真实 Workspace composition test。

本轮只增加/修改测试和本审计文件；没有改 `src/`、vendor、package 或 lockfile，没有导出私有 API，也没有删/skip case。

## 公共合同结果

### Shell mobile drawer

`WorkspaceLayout` 公开入口（打开频道列表按钮）可在打开时把焦点放到关闭按钮，Escape 关闭后返回 opener：**ACCEPT**。

新增的 Tab/Shift+Tab 闭环合同为 **REJECT**：当前 Shell 只注册 Escape 与 opener handoff，没有 drawer 内 focus trap；从 drawer 最后一个 channel button 按 Tab 后焦点落到 rail 外的全局搜索按钮。首断点是 `WorkspaceLayout` mobile drawer 生命周期，不能由 CSS 的 mobile overlay 代替焦点 owner。

定向结果：`tests/n-r-round35-shell-filter-notification.test.jsx` **1 red / 3 passed**；红断言保留为产品回归，不放宽。

### External channel change cancellation

沿用当前 `0de172d` picker public browser owner test，经 `74c85fa` 改为真实 canonical route/popstate 驱动，不手动调用私有 runtime。定向结果：**3 passed / 1 red**：

| case | 结果 | 说明 |
| --- | --- | --- |
| Escape/backdrop 取消且 draft/attachment 不变 | ACCEPT | public picker cancellation |
| canonical external channel route 关闭旧 picker，回到原频道 draft 不串 | ACCEPT | `pushState` + `popstate`，真实 Workspace route |
| 公开 Files 选择产生一个 draft attachment | ACCEPT | 当前 channel/resource owner |
| picker Tab focus trap | REJECT | picker modal 当前无 Tab trap；不把 Escape pass 算成 focus pass |

因此 external channel change cancel 当前可接受；上一轮“点击被 backdrop 拦截”的红已修正为可达的公开 route 合同。picker focus trap 仍是独立产品红，不与 route cancellation 混算。

### Filter fallback 不污染 manual owner

纯公开 Composer selection model 的 `manual > recent > selected(filter)` precedence：**ACCEPT**（`37/37` supporting tests 通过，其中 agent-selection 21、navigation 3、notification 13）。

真实公开组合新增 case：

```text
WorkspaceApp → conversation.onFocusAgentChange('agent:filter:1', 'filter')
```

先经 `useAgentProbes.pickAgent('agent:worker:1')` 建立用户手选，再由 ConversationSurface 的 filter fallback 回调。结果为 **REJECT**：`composerAgent` 从 `agent:worker:1` 被改成 `agent:filter:1`。这证明纯 model precedence 不能掩盖 Workspace callback owner 的覆盖行为；首断点是 `WorkspaceApp` `onFocusAgentChange` 回调仍调用 `composer.commands.selectAgent`，没有把 filter source 限定为 fallback-only。

该真实 composition run：**6 passed / 1 red**；红项作为产品回归包保留。

### Notification 真实 leave 撤 following lease

公开 `createChannelFeedRuntime` 反例：先在物理 tail 以 `following=true/surfaceVisible=true` 确认 seq=1，seq=2 被短 lease 吸收；随后以 `atTail=true` 但 `surfaceVisible=false` 的真实离开撤 lease，再进入 seq=3。结果：**ACCEPT**，后续未读为 `{ related: 2, total: 2 }`，证明隐藏 surface 的 leave 会撤 lease，不会永久吞掉 live arrivals。

现有 notification contract 与本轮新增反例均通过；promotion 中间 `following:false` 但仍 at-tail/visible 的 lease 保留也继续通过。

## N–R baseline 账目

`N-R-BASELINE-CURRENT-OWNER-CASE-LEDGER.md` 仍是 **22 suites / 98 expanded rows，98/98 已处理**；最后唯一 baseline 为 `NR22-01`。本轮 Shell、filter、notification 是当前 owner 回归/机制证据，不重复计旧 expanded rows，也没有诚实存在的“下一批唯一 N–R baseline”可新增。

