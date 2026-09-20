# N–R Round 34：picker / governance / Reading geometry 公共 owner 验收

日期：2026-09-20  
当前验收 HEAD：`45a8da5`（包含 `a149766` picker/治理桥接、`0de172d` picker 浏览器合同、`6878fcc` Reading geometry 候选）。

本轮只增加 `tests/n-r-round34-picker-governance.test.jsx` 与本审计文件；没有修改 `src/`、vendor、package 或 lockfile，也没有导出私有 owner、恢复旧 store/API、删除或 skip case。

## 公共 owner unit

定向命令：

```text
npx vitest run \
  tests/n-r-round34-picker-governance.test.jsx \
  tests/workspace-file-picker.test.jsx \
  tests/reading-geometry.test.js \
  tests/reading-session-ports.test.js \
  tests/governance-feature-owner.test.jsx \
  tests/workspace-governance-features.test.jsx \
  --reporter=verbose
```

结果：**6 files / 16 tests passed**。

| 合同 | 公开入口 | 结果 |
| --- | --- | --- |
| 新建频道 dialog 初始 focus、Tab/Shift+Tab 闭环、Escape 关闭并恢复 opener/inert | `WorkspaceRightPanel` → `ChannelCreateModal` → `useModalFocus` | **ACCEPT** |
| 文件 picker Escape 取消不选资源 | `WorkspaceFeatureOverlays` → `ChannelFilePickerModal` | **ACCEPT**（浏览器链另验 backdrop） |
| 频道模板选择透传 `templateId` 与 `parentId` | `ChannelAdministrationPanel` 概览 → `commands.submit` | **ACCEPT** |
| 6878fcc：虚拟化 top sliver 不冒充 bookmark，保留 hit-tested anchor offset | `topVisibleBookmark` / Reading public geometry test | **ACCEPT** |

模板 unit 通过真实的 `ChannelAdministrationPanel` port 选择 `Team` option，再观察 `create_child` typed command payload；没有手动注入私有 runtime。

## picker 浏览器公共链

命令（使用独立 web/mock 端口）：

```text
ATOLL_TEST_WEB_PORT=16990 ATOLL_TEST_MOCK_PORT=18990 \
  npx playwright test tests/browser/composer-channel-file-picker-contract.spec.js --reporter=line
```

结果：**2 passed / 2 failed**。失败均保留为产品回归，不通过放宽断言处理：

| case | 结果 | 首断点 |
| --- | --- | --- |
| picker focus remains inside modal while tabbing | **REJECT** | `ChannelFilePickerModal` 只把焦点放到关闭按钮，没有 Tab key trap；Tab 后 `document.activeElement` 离开 dialog。应接入已存在的公共 modal focus contract，由产品 owner 修复。 |
| Escape + backdrop cancellation preserve draft/attachments | **ACCEPT** | Escape/backdrop 关闭不触碰 draft/attachment projection。 |
| switching channel cancels old picker request | **REJECT** | 真实用户点击 `# c0.project` 时被 `.attachment-picker-backdrop` 拦截，30s timeout；虽 `WorkspaceApp` 有 active-channel cancellation effect，但当前 modal 覆盖层使该用户切换路径不可达。 |
| selecting one public channel file creates one attachment | **ACCEPT** | 选择真实 Files projection 后 picker 关闭并只产生一个 draft attachment。 |

因此 `a149766` 的 picker 取消与 resource selection 证据可接受；picker focus trap 与“打开 picker 后仍可切频道并取消旧 request”仍是产品红项。没有把 source effect 的存在冒充为可达的用户合同。

## N–R 唯一 baseline 账目

当前总账 `N-R-BASELINE-CURRENT-OWNER-CASE-LEDGER.md` 仍为 **22 suites / 98 expanded rows，98/98 已处理**。上轮已收尾最后一条唯一 baseline `NR22-01`（actor visibility）；本轮之后没有可诚实新增的 N–R unique row。picker/governance/geometry 是当前候选 owner 证据，不能重复计作新的旧 baseline row，也没有虚构“下一五条”。

