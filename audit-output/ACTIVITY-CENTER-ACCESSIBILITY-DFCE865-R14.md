# Activity Center accessibility audit — dfce865 / round 14

审计对象：`dfce865`（`feat(ui): restore canonical activity center`）。本轮只补测试和审计，没有修改 `src/`、vendor、package 或 lockfile。

## 结论

**ACCEPT。** Activity Center 的四个公开行为均由当前 owner 通过可操作 DOM 证明：入口有稳定 accessible name、Context panel 进入后把焦点交给关闭控件，Escape 关闭并把焦点还给 opener，活动行把同一个 `SourceRef` 交给公开回源 command；操作事实不可用时明确显示不可用且不渲染缓存/伪造操作行。UI-VIS-10 的截图继续作为视觉补充，不能单独证明这些行为。

定向结果：

```text
npx vitest run \
  tests/activity-center-accessibility.test.jsx \
  tests/f6-accessibility.test.jsx \
  tests/workspace-channel-rail.test.jsx \
  --reporter=verbose

Test Files  3 passed (3)
Tests       10 passed (10)
```

jsdom 输出 `HTMLCanvasElement.getContext()` 未实现提示；它来自 shell 渲染路径，未产生失败或改变任一断言结果。

## Owner chain and invariants

| 层 | 当前公开 owner / entry point | 证明的不变量 |
|---|---|---|
| Entry | `WorkspaceLayout` → `WorkspaceRail` → `button[aria-label="打开活动中心"]` → `navigation.openActivity` | 用户能用辅助技术发现并打开全局入口；入口只委托 composition root，不在 rail 重造 Activity state。 |
| Composition | `WorkspaceApp` 的 `activityPort` → `WorkspaceRightPanel panel="activity"` | Activity/Operation rows 来自可见频道的 feed projection 和 agent activity snapshot；回源只能走 `commands.open`。 |
| Context lifecycle | `WorkspaceRightPanel` → `ContextHost` → `SidePanel` | 单一 context host；进入后焦点落在 `关闭活动中心`，Escape 使用公开关闭回调，卸载后恢复原 opener。 |
| Activity surface | `ActivityFeature` → `ActivityRows` | 公开 row button 携带原 `item.source`，不从标题、频道文本或 DOM 推断来源。 |
| Operation failure | `ActivityFeature` 的 `operationsUnavailable` → `ActivityRows unavailable` | 没有后端可验证事实时给出明确状态，不把 cache-only operation 冒充进行中操作，不留下可点击回源入口。 |

## Case ledger

### R14-01 — rail entry accessible name and delegation

- **Baseline / old behavior:** UI-VIS-10 `全局活动中心视觉基线`（`tests/browser/ui-visual.spec.js:173`）原本点击 `getByRole('button', { name: '打开活动中心' })`，随后只检查 panel/tabs/list 并截图。截图能证明像素存在，不能证明入口的可访问名称或 click 到达公开 owner。
- **User capability:** 使用键盘/屏幕阅读器按“打开活动中心”发现并打开全局 Activity Center。
- **Invariant:** rail 只发布一个稳定 accessible name，并把用户动作交给 `navigation.openActivity`；不会因可见文案、图标或 title 改变辅助技术名称。
- **Current public owner and evidence:** `WorkspaceLayout`/`WorkspaceRail` 的 `button aria-label="打开活动中心" title="活动中心"`；`tests/activity-center-accessibility.test.jsx` 的 `exposes the rail entry under its exact accessible name and delegates opening` 用 `getByRole`、精确 title 和 spy delegation 证明。
- **Current result:** pass.
- **Disposition:** retained as behavioral replacement for the screenshot-only portion; no old case deleted or weakened. Evidence is the passing focused run above.

### R14-02 — panel focus, Escape, and focus return

- **Baseline / old behavior:** F6 accessibility contract requires context/modal surfaces to move focus into the surface, close on Escape, and restore the triggering control. The prior Activity visual case did not assert any of these.
- **User capability:** 打开 Activity Center 后可立即从键盘使用；Escape 可逆关闭；关闭后继续从原入口操作，不丢失焦点。
- **Invariant:** `ContextHost` owns one opener reference and one document Escape handler; `SidePanel` exposes a named complementary region and named close control. No second focus owner or private helper is introduced.
- **Current public owner and evidence:** `WorkspaceRightPanel` → `ContextHost` → `SidePanel aria-label="全局活动"`, close button `关闭活动中心`; test clicks the public opener, checks `document.activeElement`, sends user Escape, checks panel absence and exact opener restoration.
- **Current result:** pass.
- **Disposition:** accepted as a focused accessibility behavior case. Existing `tests/f6-accessibility.test.jsx` remains green and still proves inert/aria-hidden for modal owners; this Activity context is not incorrectly treated as a modal dialog.

### R14-03 — source return preserves the canonical SourceRef

- **Baseline / old behavior:** F5/D1 contract says Activity/Operation entries return to their source; `SourceRef` is the shared location pointer and must not be reconstructed from labels or copied object content. The old visual baseline counted a row but did not invoke its return path.
- **User capability:** 点击某条活动事实后回到它所属频道/视图/对象，而不是相似文本或当前频道。
- **Invariant:** Activity row invokes the sole public `activity.commands.open` with the exact `item.source` object. `WorkspaceApp.openActivitySource` remains the owner that checks channel access and chooses view.
- **Current public owner and evidence:** `ActivityRows` renders a button with `返回来源 ›`; test supplies a complete canonical source (`channelId`, `view`, `objectType`, `objectId`, `requestId`), clicks the row by its user title, and asserts the callback receives the same object exactly once.
- **Current result:** pass.
- **Disposition:** accepted; this is semantic coverage of the old “can return source” requirement, not a private implementation assertion.

### R14-04 — unavailable operations fail closed

- **Baseline / old behavior:** Operation Center must only show live, verifiable operations; the D1 contract forbids pretending a cache-only item is active. The old visual case only asserted a non-empty list and could not distinguish a stale row from an authoritative one.
- **User capability:** When the backend cannot provide a trustworthy operation snapshot, the user is told that operations are unavailable and is not offered an action that cannot be honored.
- **Invariant:** `operationsUnavailable` takes precedence over `operations`; `ActivityRows` renders the explicit unavailable state and no operation row button. No disabled fake row, local reconstruction, fallback owner, or hidden actionable control is allowed.
- **Current public owner and evidence:** `ActivityFeature` selects the `操作` tab and passes the port flag to `ActivityRows`; test intentionally supplies a tempting operation row plus `operationsUnavailable: true`, then asserts both explanatory strings, no `返回来源` button, no row title, and no callback invocation.
- **Current result:** pass.
- **Disposition:** accepted. This preserves the failure assertion rather than weakening it to “empty list”.

## Scope / unresolved cases

- No product regression was observed in this unit-level public-owner verification; therefore no product-regression packet is opened.
- Browser UI-VIS-10 remains a visual supplement and was not relabeled as an accessibility oracle.
- This round did not alter the existing real browser fixture or screenshot baseline. A full browser run remains aggregate verification owned by root after all ledgers are accepted.
- Working-tree changes belonging to other workers were not staged or modified.
