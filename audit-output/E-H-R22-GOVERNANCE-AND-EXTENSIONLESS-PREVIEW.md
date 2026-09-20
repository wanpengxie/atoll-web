# E–H round 22 — governance recheck and extensionless preview proof

审计快照：HEAD `6f673cb`。本轮先等待并复核治理 owner；并行 owner 修复
`4a7e623` 已在复核期间落地，故 EH03-01/02 经过完整旧动作重跑后从
REGRESSION 回填 PASS。随后把右栏无扩展名文本预览拆成真实网络
`Response/blob()` 合同，只增加测试证据，不修改产品、旧 expected-fail witness。

## EH03-01/02：治理 owner 修复后严格 PASS

`4a7e623` 将现有 `ChannelAdministrationPanel` 的初始 tab 恢复为 `members`，并在
现有 `ChannelMembers` owner 内恢复参与者类型 label、selected-candidate id 和
principal 配置提示；没有创建第二 owner 或恢复旧 API。完整旧动作测试保持 raw
roster/candidate fixtures，没有预清洗或点击后替代：

```text
npx vitest run tests/f5-management.test.jsx --reporter=verbose

Test Files  1 passed (1)
Tests       3 passed (3)
```

| case | 旧动作与 observable | 当前公开 owner / 首断点 | 裁决 |
|---|---|---|---|
| EH03-01 | 渲染 governance 后不做 tab 操作；`成员[aria-selected]` 必须为 `true`，随后 Root 可见且 system/registrar/svcactor 不可见。 | `ChannelAdministrationPanel` → `SidePanel`/`ChannelMembers`；`GovernanceFeature.jsx:127-130` 初始 tab 为 `members`，raw roster 经 `isVisibleActor` 过滤。完整 f5 case 无导航即断言 `true`，再观察 Root 与三种标准 actor 的可见性。 | **PASS / PROVEN-DIRECT**。旧默认入口和 roster observable 均在现有 owner 内复现。 |
| EH03-02 | 不导航，打开旧 `选择参与者`；排除 genesis `svcactor`；选择 `Analyst · Agent` 后显示 `demo:agent` 与 principal 说明。 | 同一 `ChannelAdministrationPanel`/`ChannelMembers`/`isManageableDeclaration`；`4a7e623` 恢复 `选择参与者`、按声明 kind 显示 `Analyst · Agent`、选择后显示 `demo:agent` 与 principal 提示；`WorkspaceApp.submitGovernance` 仍把 declaration candidate 映射为 `{ decl_id }`。完整 f5 case 逐动作通过。 | **PASS / PROVEN-DIRECT**。genesis exclusion、普通候选 selection 和 type-specific configuration observable 均已证明。 |

治理修复由并行治理 owner 提交；本轮只读复核，没有修改 `src/`，也没有删除、skip、
私有 export 或兼容 owner。

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
- EH03-01/02 已按完整旧动作从 REGRESSION 回填 PASS；ledger 严格证明总账应为
  256/256（79 direct + 177 merged），无 E–H regression。
- 现有共享工作树中的其他 owner dirty files 未纳入本轮提交。
