# E–H round 17 — right-panel file-reference owner closure

本轮处理 `tests/right-panel-file-reference.test.jsx` 原 `it.fails` 的 provider 缺口。旧
`RightPanelHost` 已删除，当前公开链路是：

```text
WorkspaceApp.filesPort.commands.preview
  → WorkspaceRightPanel
  → ArtifactPreviewPanel
  → MarkdownContent
```

现有 `MarkdownFileReferenceProvider` 是唯一文件引用边界；本轮把它挂在当前
`WorkspaceRightPanel` 的 artifact composition boundary，并把引用转换为现有
`files.commands.preview` 接受的 canonical attachment。没有恢复旧 `FilesPanel`、旧
`RightPanelHost` 或另建导航 owner。

## 结论

**ACCEPT。** 原绝对路径文件引用行为已从公开右侧面板复现并闭合；外链仍保持新标签
页；缺少公开 preview command 或 artifact 所属频道已切换时，引用 fail-closed，既不伪造
内部打开，也不让 host 浏览器访问本地路径。

定向结果：

```text
npx vitest run tests/right-panel-file-reference.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       7 passed (7)

npx vitest run \
  tests/right-panel-file-reference.test.jsx \
  tests/artifact-preview-resolve.test.jsx \
  tests/markdown-content.test.jsx \
  tests/file-browser.test.jsx --reporter=dot
Test Files  4 passed (4)
Tests       44 passed | 1 expected fail (45)
```

更宽命令中的唯一 expected fail 是既有 `artifact-preview-resolve` 无扩展名文本兜底缺口，
与本轮 provider/navigation 不同 owner；未改写或跳过。

## 逐 case ledger

### RPFR-01 — 当前 artifact 的绝对路径引用走公开 preview command

- **旧行为 / setup → action → result:** 旧测试直接渲染 `ArtifactPreviewPanel`，因缺少
  provider，绝对路径被当成普通 `_blank` 链接；用户点击后不会进入 Atoll 文件预览。
- **用户能力:** 用户在右侧 Markdown 文件预览中点击 `/path/file.md:20`，应在当前频道的
  Atoll artifact 预览中打开，并保留行号；普通网页链接仍去外部新标签页。
- **不变量:** 文件引用只能由现有 `files.commands.preview` 导航；路径转换必须保留
  canonical `resource_id/resourceId/name/media_type/mediaType/line`，不能通过 host URL
  或第二个 Files owner 打开。
- **当前公开 owner 与证据:** `WorkspaceRightPanel` 的 artifact 分支在
  `ArtifactReferenceBoundary` 提供 `MarkdownFileReferenceProvider`；provider 调用现有
  `files.commands.preview`。测试从真实 `WorkspaceRightPanel` 整体渲染，点击绝对路径和
  外链，断言 command payload、`defaultPrevented`、外链 target。
- **结果 / disposition:** **PASS / CLOSED。** 原 `it.fails` 改为普通断言；未删除用户
  动作或弱化防 host 导航断言。

### RPFR-02 — 缺少公开 preview command 时 fail-closed

- **旧行为 / setup → action → result:** provider 缺席会退回普通 host 链接；若测试只给
  一个假 callback，则会把“可点击”误报为真实内部导航。
- **用户能力:** 当前 artifact owner 尚未提供 preview command 时，用户不能误触发本地
  路径导航；系统不能声称文件已在 Atoll 内打开。
- **不变量:** provider 缺 command 时不调用任何替代 owner，不构造旧 API/host URL；事件
  仍被消费，避免浏览器访问绝对路径。
- **当前公开 owner 与证据:** `ArtifactReferenceBoundary` 只接受
  `files.commands.preview`；缺失时 callback 直接返回。测试传入空 commands，点击绝对
  路径并断言事件被阻止，且没有伪造 command 调用。
- **结果 / disposition:** **PASS / CLOSED。** 这是能力缺失的 fail-closed 合同，不是
  假装 provider 可用。

### RPFR-03 — channel switch 不得把旧 artifact 路由到新频道

- **旧行为 / setup → action → result:** 旧面板没有 channel-bound provider；若闭包沿用
  旧 artifact，新的 active channel command 可能用错频道读取路径。
- **用户能力:** 切换频道后，旧频道 artifact 引用不能借新频道的 preview command 打开；
  只有当前频道 artifact owner 可导航。
- **不变量:** `selectedArtifact.channelId === channel.id` 是 provider 导航前置条件；不匹配
  时 fail-closed，不猜频道、不跨频道读资源。
- **当前公开 owner 与证据:** `ArtifactReferenceBoundary` 同时读取当前
  `channel.id` 与 `files.selectedArtifact.channelId`，只把匹配的引用转给现有 preview
  command。测试先建立 c0 artifact，再 rerender 为 c1 并保留 c0 artifact，点击后断言
  事件被阻止且 command 未调用。
- **结果 / disposition:** **PASS / CLOSED。** 保留频道切换语义，没有用新频道 fixture
  伪造成功。

## 最小 owner diff

- `src/ui/features/WorkspaceFeatures.jsx` 新增当前 composition boundary 的
  `MarkdownFileReferenceProvider`，使用已存在的 `attachmentFromFileReference` 和
  `files.commands.preview`；无新 owner、私有 export 或 compat API。
- `tests/right-panel-file-reference.test.jsx` 将原旧面板 `it.fails` 迁移到公开
  `WorkspaceRightPanel`，并覆盖 success / missing command / channel switch。
- 未修改 vendor、package、lockfile；未恢复 `ArtifactsView`、`FilesPanel` 或
  `RightPanelHost`。
