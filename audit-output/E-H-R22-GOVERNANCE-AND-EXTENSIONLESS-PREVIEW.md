# E–H round 22 — governance recheck and extensionless preview proof

审计快照：HEAD `4c566c4`。本轮先等待并复核治理 owner；没有发现新的治理
owner 修复，因此 EH03-01/02 不能从 REGRESSION 回填 PASS。随后把右栏无扩展名
文本预览拆成真实网络 `Response/blob()` 合同，只增加测试证据，不修改产品、旧
expected-fail witness 或 E–H 256 条总账。

## EH03-01/02：当前仍是产品回归

当前治理 source history 在 `GovernanceFeature.jsx` 仍停在既有 owner commits；公开
owner 的 `ChannelAdministrationPanel` 仍以 `useState('overview')` 初始化。完整旧动作
测试保持 raw roster/candidate fixtures，没有预清洗或点击后替代：

```text
npx vitest run tests/f5-management.test.jsx -t 'Channel Context 默认成员优先并隐藏标准 Actor|添加流程的候选人不包含 genesis 铸出的系统声明' --reporter=verbose

Test Files  1 failed (1)
Tests       2 failed | 1 skipped (3)

Both failures: tests/f5-management.test.jsx:35:83 and :60:83
Expected: 'true'
Received: 'false'
```

| case | 旧动作与 observable | 当前公开 owner / 首断点 | 裁决 |
|---|---|---|---|
| EH03-01 | 渲染 governance 后不做 tab 操作；`成员[aria-selected]` 必须为 `true`，随后 Root 可见且 system/registrar/svcactor 不可见。 | `ChannelAdministrationPanel` → `SidePanel`/`ChannelMembers`；`GovernanceFeature.jsx:97-98` 仍先选 `overview`，所以首个断言即收到 `false`。后续手动点击成员虽能观察过滤结果，但不是旧动作。 | **REGRESSION — 保持未闭合**。当前 owner 存在，不能以 post-click 过滤证据冒充默认入口 PASS。 |
| EH03-02 | 不导航，打开旧 `选择参与者`；排除 genesis `svcactor`；选择 `Analyst · Agent` 后显示 `demo:agent` 与 principal 说明。 | 同一 `ChannelAdministrationPanel`/`ChannelMembers`/`isManageableDeclaration`；初始 tab 仍在同一首断点失败。即使手动进入成员 tab，当前公开 label/selected-candidate configuration 也不同（`待引入成员`、`Analyst · 声明`），不是完整旧 observable。 | **REGRESSION — 保持未闭合**。`WorkspaceApp.submitGovernance` 的 `{ decl_id }` 路由正确，但 command payload 不能替代缺失的用户可见 action/result。 |

这两条不得计入严格 PASS，除非治理 owner 先落地并通过完整旧动作；本轮没有
修改 `src/`，也没有删除、skip、私有 export 或兼容 owner。

## 下一合同：真实 Response/blob 下的无扩展名文本预览

### 逐 case 语义

- **旧用户能力：** 在 Files 右栏选择 `Makefile` 或 `.gitignore`，打开后以文本/源码
  预览，不因 `application/octet-stream` 或没有常规扩展名而错误显示“不支持预览”。
- **不变量：** 真正的网络 `Response` 必须提供 `blob()`；未知 descriptor 可在读取后
  以 UTF-8、无 NUL 的 bytes 嗅探为文本；真实二进制仍保持 unsupported。预览 panel
  只呈现当前 preview port 的 `ready/text`，不自行重造类型判断。
- **当前公开 owner：** `useAttachmentTransactions.previewArtifact` 的
  `previewDescriptor`/`sniffText` 负责读取与类型收敛；`ArtifactPreviewPanel` 只负责
  右栏呈现。测试从 `mountAttachmentTransactions` 的公开 hook port 发起真实 read
  receipt/fetch，再把结果交给 panel。

### 证据与裁决

原有 `it.fails` witness 仍故意使用只有 `text()`、没有 `blob()` 的伪 Response；它先
在测试 fixture boundary 触发 `response.blob is not a function`，不能当作产品红项。
本轮补充的真实 `blobResponse` evidence 对同一个 public owner 分别执行
`Makefile` 与 `.gitignore` 的选择/预览动作，并断言：

1. preview 状态为 `ready`，kind 为 `text`，`sniffed: true`，正文保持 `all: build\n`；
2. `ArtifactPreviewPanel` 的源码预览出现同一正文；
3. 同一文件中的未知扩展名二进制用 Blob 嗅探仍是 unsupported，并保留下载入口。

定向结果：

```text
npx vitest run tests/artifact-preview-resolve.test.jsx --reporter=verbose

Test Files  1 passed (1)
Tests       12 passed | 1 expected fail (13)
```

新增真实 Response/blob case 是 **ACCEPT / PROVEN-DIRECT（非 256 baseline 新证据）**；
原 malformed-fixture `it.fails` 继续作为 fixture witness，不提升、不删除、不把它计入
EH09 或 256 条严格总账。当前产品最终用户能力在完整 Response 语义下已被证明；若未来
要要求 initial descriptor 本身为 `text`，应另写只观察公开 preview port 的合同，不能
用缺失 `blob()` 的伪 Response 代替网络语义。

## 本轮边界

- 没有改动任何 `src/`、vendor、package 或 lockfile。
- 没有修改 EH03 ledger 的 254/256 严格计数；EH03-01/02 仍是两条 REGRESSION。
- 现有共享工作树中的其他 owner dirty files 未纳入本轮提交。
