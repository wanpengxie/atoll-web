# N–R Round 38：picker provenance / world reset / Governance owner audit

复验基线：拆分提交 `3847f8f`（Shell picker receipt/source routing）与
`6b38eac`（mobile drawer modal focus）；当前 HEAD `77bfccc`。共享工作树另有
`GovernanceFeature` 的 failed-terminal dirty candidate，本轮只读其行为，没有修改
任何产品文件。

## 边界与执行合同

完整遵守 `docs/TEST-MIGRATION-EXECUTION-CONTRACT.md`。picker 经公开
`WorkspaceFeatureOverlays` port 与真实 `WorkspaceApp → Composer` 组合验证；world
reset 经公开 `useWireConnection` port 验证；Governance 经公开
`ChannelAdministrationPanel` / `ChannelCreateModal` port 与真实 Chromium 链验证。
没有导出私有 owner、恢复旧 store/API、手工 `runtime.bind`、删/skip 红例。

## 当前合同矩阵

| case / owner | 当前结果 | 裁决 | 证据 |
|---|---|---|---|
| picker stale `files.error` provenance | 旧 error 与旧 settled receipt 不 settle 新 request；只有 current `refreshReceipt` epoch/channel/device 对齐后才 settle | **ACCEPT** | `tests/n-r-round34-picker-governance.test.jsx` stale-receipt case；`tests/workspace-file-picker.test.jsx` receipt error case；split candidate 通过 |
| picker current refresh rejection | 当前 request 的 typed refresh rejection resolve picker，dialog 保留 | **ACCEPT** | `tests/workspace-file-picker.test.jsx` 与 `tests/workspace-real-runtime-composition.test.jsx` 通过 |
| mobile drawer focus / inert | close autofocus；last→Tab→first、first→Shift+Tab→last；`main.inert` 打开为 true、Escape 后恢复 false | **ACCEPT** | `tests/n-r-round35-shell-filter-notification.test.jsx` 4/4 |
| world reset waiter | Registrar old-world template projection 在 world boundary 同步清空；`setHistoryGrants` 在 deferred `onWorldChanged` resolve 前不调用，resolve 后按 reset→grants 顺序调用 | **ACCEPT** | `tests/world-change-reset.test.js`，公开 connection port 1/1 |
| template identity | UI 发送 stable `templateId`，不把显示名当 ID | **ACCEPT** | `tests/n-r-round34-picker-governance.test.jsx` stable-id case |
| child parent identity | UI 发送 canonical parent channel ID，不发送 parent display name/template name | **ACCEPT** | 同文件 stable-id/parent-id case；`channel:parent-7` 与 `研究父频道` 刻意不同 |
| Registrar list/get/body → create recipe | 真实 Workspace 先 list，再 matching get/body，create 使用 canonical recipe、无 raw templateId | **ACCEPT** | `tests/browser/governance-template-wire-contract.spec.js`，Chromium 1/1 |
| Governance failed terminal + retry | `creation.failed/error` 映射为“创建失败”，保留 draft，显示可用“重新创建”，不显示进入新频道 | **ACCEPT（当前 dirty candidate）** | `tests/blocked-round35-governance-public-owner.test.jsx` `[AD-154]` 当前通过；owner 变更仍在共享 dirty `GovernanceFeature.jsx`，未由本轮提交 |

## 定向执行证据

```text
npx vitest run \
  tests/world-change-reset.test.js \
  tests/n-r-round34-picker-governance.test.jsx \
  tests/workspace-file-picker.test.jsx \
  tests/n-r-round35-shell-filter-notification.test.jsx \
  tests/blocked-round35-governance-public-owner.test.jsx --reporter=dot

5 files, 16 passed, 0 failed
```

`HTMLCanvasElement.getContext()` 为既有 jsdom warning，不是失败。

```text
ATOLL_TEST_WEB_PORT=16998 ATOLL_TEST_MOCK_PORT=18998 \
npx playwright test tests/browser/governance-template-wire-contract.spec.js --reporter=line

1 passed
```

真实浏览器链没有预置 template row 或手工注入关键 owner；list/get receipt 与
canonical recipe 均由公开 Workspace/Registrar 接线产生。

## Owner handoff

### World reset

测试先在旧 world 的公开 session access port 写入 Registrar template，随后由 wire
attach 触发 world change。旧 template 在 deferred reset waiter 等待期间已经不可见，
而 history grants 直到 waiter resolve 才安装；这同时验证了 template provenance 和
history grant ordering。

### Governance identity / failure

stable-id case 使用 display name 与 ID 不同的 template，并使用 display parent name
与 canonical parent ID 不同的 channel；payload 只能带 `templateId` 与 `parentId`。
AD-154 当前 dirty owner candidate 显示失败终态、保留输入并提供 retry；此前首断点是
progress 仍为“正在收敛”、无“重新创建”，该红结论已保留在上一轮审计，当前通过仅归因于
共享 dirty `GovernanceFeature` candidate，不伪称为本轮产品提交。

## 越界审计

本轮交付仅：

- `tests/world-change-reset.test.js`：world waiter 与旧 template 清理合同；
- `tests/n-r-round34-picker-governance.test.jsx`：stable template ID / canonical
  parent ID、display-name 反例；
- 本审计报告。

未改 `src/`、vendor、package manifest、lockfile；未导出私有 API，未恢复旧 owner，未
删除或 skip 任何 case。共享树中 `GovernanceFeature` 和其它分区 dirty 变更不在本轮
交付范围。
