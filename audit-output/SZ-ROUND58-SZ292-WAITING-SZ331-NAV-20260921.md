# S–Z Round 58 — SZ292 Waiting bridge fix and SZ331 navigation red handoff

日期：2026-09-21

基线：`253c11399b7cf5f47e32b23ed54b9b3d6b5c6e36`

范围：现有 Waiting controller owner、直接公开回归测试和导航回归证据。
SZ331 仍只交回归包；没有修改 Workspace/navigation 产品 owner。没有新增
store、compatibility API、私有 export、skip 或弱化断言。

## SZ292：公开用户能力与首断点

精确基线是 `tests/waiting-presentation.test.js` 的
`keeps one stable id through local, landed-open, and canonical queued commits`。
用户合同不是“消息类型为 `agent.ask` 就显示 Waiting”，而是同一条用户请求
在三个公开阶段中必须保持一行、一个稳定 request id：

```text
local accepted
  -> canonical request landed, no provisional lifecycle fact
  -> canonical queued provisional
```

首个阶段由公开 `useWaitingEditingController(...).queuedTurns` 返回
`same-id` 本地行。第二阶段 canonical request 已进入 Replica，但还没有
`received/queued/deferred/processing` provisional；用户仍需看到同一条“等待账本
确认”行，不能出现空白。第三阶段显式 queued 到达后，canonical 行替换本地桥接
行，仍只能有一个 `same-id`，不能出现 local/canonical 重复。

原实现会在第二阶段因 canonical id 已存在而丢弃 pending 行，同时该 canonical
行又没有显式 queued stage，公开 `queuedTurns` 变成空数组。这是用户可见
Waiting 断档，不是私有 Replica 字段差异。

## SZ292：最小 owner 修复

现有唯一 owner 是
`src/ui/timeline/useWaitingEditingController.jsx` 的
`pendingWaitingTurns`，公开消费方仍是 `WaitingLayer`。

修复仅在该 owner 内增加 pending identity 的 landing bridge：

- 只有同一个 pending submission identity 能把 canonical、无 terminal、无
  provisional 的 landed-open turn 保持在 Waiting；因此远端无 pending 的 open
  request 仍不会被猜成 queued（SZ293 不变）。
- canonical 已有 queued/received/deferred/processing provisional，或已有
  terminal 时，仍交给现有 canonical/terminal 规则，不产生重复或错误操作。
- landed-open 行继承本地 submission 的 `waitingPresentation`，在 queued
  provisional 到达后由 `queuedTurnsOf` 单独提供 canonical 行。

回归测试
[`tests/sz-round58-sz292-sz331-red.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round58-sz292-sz331-red.test.jsx:89)
只读取 `queuedTurns` 的 request ids 和公开 presentation 字段，没有读取
`_envelopesById` 或其他私有 oracle。修复后 SZ292 已从 expected-fail 恢复为
普通正断言。

## SZ331：导航语义回归包

精确基线是 `tests/workspace-route.test.js` 的
`写入 history 时区分普通导航与 Context 入口`。当前公开调用链为
`WorkspaceApp.openTaskItem`：先选择 `tasks`，再设置 `work_item` focus；一次
Context 打开必须只产生一个新的浏览器 history entry，使 Back 回到此前用户
路由，而不能先暴露一个无面板的 `tasks` 中间 entry。

当前 owner 的首个可观察失败是：

- `openTaskItem` 调用 `setActiveView('tasks')` 后又调用 `setFocus(...)`；
- `useChannelNavigation.writeRoute` 对这两个公开命令都走 `pushState`；
- history 长度从预期 `N + 1` 变成实际 `N + 2`（当前直接回归输出：
  `expected 3 to be 2`），所以 Back 会先落到无 focus 的 tasks route；
- 当前 route state 也没有旧合同要求的 `atollContextEntry` 区分。

该证据位于同一测试文件的
[`SZ331` case](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round58-sz292-sz331-red.test.jsx:116)，
使用 `useChannelNavigation` 的公开 hook 和 `window.location/history`，没有调用
已删除的 `writeWorkspaceRoute`，也没有恢复旧 API。测试保留为
`it.fails`，交给 Workspace/navigation owner 做产品决策与最小单入口修复。

## 验证

```text
npx vitest run \
  src/ui/timeline/waiting-presentation.test.jsx \
  src/model/channel-replica-terminal-closure.test.jsx \
  tests/waiting-layout.test.jsx \
  tests/sz-round58-sz292-sz331-red.test.jsx --reporter=dot

4 files passed; 20 tests passed, 1 expected fail (SZ331).
```

本提交只包含 SZ292 现有 Waiting owner 的最小修复、公开回归测试和本报告；
SZ331 保持红证据，不修改 Workspace/navigation、Reading、Feed、Outbox、
Composer、vendor、package 或 lockfile。
