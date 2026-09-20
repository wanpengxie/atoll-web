# S–Z Round 59 — SZ331 single-owner route/history contract

日期：2026-09-21

基线：`8c5c1598a090f62cebe1500668ea06da02ab8ce7`

分支：`unit-s-z-round59-sz331-router`

## 精确用户合同

`SZ-331` 的精确基线标题是
`tests/workspace-route.test.js — 写入 history 时区分普通导航与 Context 入口`。
当前公开调用链是 `WorkspaceApp.openTaskItem`：先把普通视图切到 `tasks`，再把
工作项 focus 作为 Context 打开。用户可见不变量为：

1. 普通视图/频道导航只替换当前 route，不凭普通导航制造新的 Back 步骤；
2. 非空 typed focus 是一次 Context 入口，只新增一个 history entry；
3. Back 回到无 focus 的普通 route，Forward 恢复同一个 typed focus；
4. history state 明确区分普通 route (`atollContextEntry: false`) 和 Context
   (`atollContextEntry: true`)，并保留 `{ channelId, view, focus }` 的 typed
   `atollRoute` 投影。

## 唯一 owner 与最小实现

唯一 router owner 仍是
[`useChannelNavigation`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/unit-s-z-round59-sz331-8c5c159/src/app/hooks/useWireSession.js:475)，
没有新 store、旧 `workspace-route` helper 或第二路由 owner。

[`writeRoute`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/unit-s-z-round59-sz331-8c5c159/src/app/hooks/useWireSession.js:410)
现在统一写入：

```text
history.state = {
  ...previousState,
  atollContextEntry: boolean,
  atollRoute: { channelId, view, focus: { type, key } | null },
}
```

- `select`、`setActiveView` 和清空 focus 的普通 route 使用
  `replaceState(..., atollContextEntry:false)`；
- 非空 `setFocus` 使用一次 `pushState(..., atollContextEntry:true)`；
- 现有 `openTaskItem` 的 `setActiveView('tasks') → setFocus(...)` 顺序因此只
  增加一个 Context history entry，不需要改造第二个入口或引入事务 store；
- 已有 `popstate/hashchange` route consumer 读取 URL 的 view/focus，负责 Back/
  Forward 的 React projection 恢复。

## 公开合同测试

新增/扩展的直接测试在
[`tests/channel-navigation-route.test.jsx:23`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/unit-s-z-round59-sz331-8c5c159/tests/channel-navigation-route.test.jsx:23)。
它只使用 `useChannelNavigation` 的公开返回值和浏览器公开
`window.location/history`：

- 普通 `setActiveView('tasks')`：history 长度不增、URL 无 focus、typed state
  为 `atollContextEntry:false`；
- `setFocus({ type:'work_item', key:'task-1' })`：history 只增加一条、URL 和
  typed focus 正确、state 为 Context；
- `history.back()`：恢复 `tasks` 且 `focus === null`；
- `history.forward()`：恢复同一个 `work_item/task-1` focus 和 Context URL。

这覆盖了此前 SZ331 红证据的首断点：`openTaskItem` 路径实际 history 长度从
`N` 变成 `N+2`，现在普通 view replace 不占槽，最终只保留一个 Context push。

## 验证

```text
npx vitest run tests/channel-navigation-route.test.jsx --reporter=verbose
1 file passed; 6 tests passed

npx vitest run \
  tests/channel-navigation-route.test.jsx \
  tests/workspace-route-navigation.test.jsx \
  tests/workspace-channel-navigation.test.jsx \
  tests/workspace-real-runtime-composition.test.jsx --reporter=dot
2 files passed; 21 tests passed
```

`workspace-route-navigation.test.jsx` 与 `workspace-channel-navigation.test.jsx`
在该 exact base 不存在，Vitest 仅执行实际存在的两个 owner files；不存在的旧
路径没有恢复。

后续另行执行 `npm run build`，结果通过。未改 Reading/Feed/Outbox/Composer/
Vendor/package/lockfile，也未删/skip/放宽任何测试。
