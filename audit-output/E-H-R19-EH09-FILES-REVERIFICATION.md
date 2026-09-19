# E–H round 19 — EH09 baseline re-verification and right-panel preview boundary

审计基线：当前 HEAD `74efa9b`，Files 生命周期修复为 `31a892d`。本轮只复核产品提交已经承接的公开 owner，并同步 `E-H-BASELINE-CURRENT-OWNER-CASE-LEDGER.md`；没有修改 `src/`、没有新增 owner/compat、没有删除或放宽测试。

## 结论

- **EH09-08 ACCEPT / 严格 PASS**：延迟删除回执不能把用户已经返回的根目录覆盖成旧目录。
- **EH09-09 ACCEPT / 严格 PASS**：频道切换后只落到目标频道根目录，不复用上一频道的 directory/device 闭包。
- **EH09-14 ACCEPT / 严格 PASS**：持久附件拒绝时不进入 composer projection，并在 Files surface 呈现可见错误。
- 三条仍是原始 baseline 用户动作，不是静态注入 entries 的替代断言。`tests/file-browser.test.jsx` 15/15 通过；与 channel/files-panel/right-panel/outbox 公开 owner 证据聚合为 5 suites、36/36 通过。
- 右栏无扩展名文本 expected-fail **REJECT（不作为产品回归接受）**：当前断言首先暴露的是测试 Response fixture 缺少公开网络响应应有的 `blob()`，并非 `ArtifactPreviewPanel` 的渲染首断点；另有一个真实的初始 descriptor 分类差异，但当前 `previewArtifact` 的真实 Blob sniff fallback 会在读取后将文本恢复为 `kind: text`。保留该 expected-fail 供后续把 fixture/语义拆开，不回交产品红项。

## 逐 case 合同

### EH09-08 — completed mutation cannot overwrite a newer directory

- **旧行为 / setup → action → result：** 用户在 `c0/docs/` 中点击 `inside.txt` 的删除；删除 resource receipt 故意延迟；用户立即点击“返回上一级”回到 `daemon://local-device/c0/`；释放删除回执后，根目录仍显示 `docs/`，不应重新显示旧 `inside.txt`。
- **用户能力：** 文件写操作在后台完成时，用户仍可浏览/返回目录；旧操作完成不得把视图跳回过期目录或覆盖新目录内容。
- **不变量：** mutation completion 只能刷新它捕获且仍然 active 的 channel + directory + device；如果 committed file view 已变化，stale completion 必须丢弃 refresh，而不能 abort 或覆盖新请求。
- **当前公开 owner 与证据：** `FilesFeature` 删除按钮 → `commands.remove` → `useAttachmentTransactions.removeFile` → `refreshDirectory`。`removeFile` 在 operation 开始捕获目录/device，在 settle 时比较 `activeChannelRef`、current directory 和 current device；只有三者仍一致才 refresh。`tests/file-browser.test.jsx` 以真实 row、真实 confirm、延迟 delete receipt 和返回动作复现该竞态。
- **结果：** **PASS / CLOSED / PROVEN-DIRECT**。`31a892d` 后 `it.fails` 已是普通 `it`；EH09 focused case 与完整 Files 聚合均通过。

### EH09-09 — channel switch lands at the new channel root

- **旧行为 / setup → action → result：** 用户先在 `c0/docs/` 浏览，再把 active channel 切换到 `c1`；测试要求新请求为 `daemon://local-device/c1/` 根目录，并显示 `fresh.txt`，不得带着 `c0/docs/` 的路径。
- **用户能力：** 切频道后文件面板显示目标频道自己的根目录，旧频道的 directory/device 闭包不会污染新频道。
- **不变量：** channel switch 是 attachment owner boundary；reset effect 必须先丢弃旧 device/directory，目标 device 确认后才能由唯一 owner 发起目标 root refresh；旧 channel completion 不得发布到新 channel。
- **当前公开 owner 与证据：** 同一 FilesFeature row/breadcrumb → `navigateFiles`；`useAttachmentTransactions` 的 channel reset 清理旧 device，待目标 device rows 到达后再加载目标 root。测试用真实 `view.rerender` 从 `c0` 切到 `c1`，只用 wire resource 返回目标根的 `fresh.txt`。
- **结果：** **PASS / CLOSED / PROVEN-DIRECT**。原始 channel switch/root assertion 保留，15/15 file-browser tests 与 5-suite aggregate 通过。

### EH09-14 — rejected durable attachment stays out of the composer

- **旧行为 / setup → action → result：** 用户在真实文件行点击“附加”；`persistDraftAttachments` 故意以“草稿所有权已变化”拒绝；测试要求 composer projection 仍为空，并在 Files surface 显示包含该错误的 `role="alert"`，不能静默吞掉 rejection。
- **用户能力：** 用户能看到附加失败且不会误以为文件已加入草稿；失败的 durable attachment 不污染 composer。
- **不变量：** attach 通过同一个 captured draft/authority owner；persist rejection 必须保持 projection 不变并发布 files error；FilesFeature 事件边界消费 promise rejection，不能制造 unhandled rejection。
- **当前公开 owner 与证据：** FilesFeature 公开附加按钮 → `commands.attach` → `useAttachmentTransactions.attach` → `persistDraftAttachments`。hook 在同一 owner 内发布 `filesError` 后 rethrow，FilesFeature 以 `role="alert"` 呈现，事件 handler 消费 rejection。测试仍点击真实 row/button，并检查 persistence 调用、空 projection 与 alert 文案。
- **结果：** **PASS / CLOSED / PROVEN-DIRECT**。原始 rejection/empty-projection 断言为普通 `it`，通过 15/15 file-browser 与 36/36 Files aggregate。

## 右栏无扩展名文本预览：首断点审计

目标能力是右栏 `ArtifactPreviewPanel` 能打开常见无扩展名文本（例如 `Makefile`、`.gitignore`）。当前工作树的 `tests/artifact-preview-resolve.test.jsx` 保留一个 `it.fails` case，输入 `name: 'Makefile'`、`mediaType: 'application/octet-stream'`，wire receipt 正常，但 `textResponse('all: build')` 只提供 `text()`，没有 `blob()`。

### owner 链与边界

1. **第一个产品语义差异：** `useAttachmentTransactions.previewDescriptor` 只把 `name` 最后一个 `.` 后的 literal extension 与 `TEXT_EXTENSIONS` 比较。`Makefile` 产生 `makefile`，`.gitignore` 产生 `gitignore`，二者都不在 set 中，所以 initial descriptor 是 `{ kind: 'unsupported' }`。这是分类兜底缺失，owner 是 `useAttachmentTransactions`，不是右栏 panel。
2. **当前测试的第一个实际异常：** descriptor 为 unsupported 且 response 没有可用 content-type 时，`previewArtifact` 进入 `response.blob()` → `sniffText(blob)` 的公开读取分支。测试的 `textResponse` 没有 `blob()`，因此在 `tests/artifact-preview-resolve.test.jsx` 的 fixture boundary 先抛 `TypeError: response.blob is not a function`，catch 发布 error/unsupported；断言随后才看到 `kind !== 'text'`。这不是 panel render failure。
3. **读取后的真实产品行为：** 真实 `fetch` Response 具有 `blob()`；同一 owner 已有 unknown-extension + octet-stream 的 `blobResponse` 测试，文本 bytes 会经过 `sniffText` 返回 `{ kind: 'text', status: 'ready', sniffed: true }`。`ArtifactPreviewPanel` 只按 port 的 `preview.kind/status/text` 渲染，不自行判断扩展名；因此当前 expected-fail 不能单独证明右栏最终用户能力缺失。

### 定向证据

```text
npx vitest run tests/artifact-preview-resolve.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       11 passed | 1 expected fail (12)
```

该 expected-fail 应保留为审计见证，但不能计入 EH09 或 256 条 baseline 的未闭合数。若后续需要把它变成严格产品回归，应先用完整 Response/blob fixture 证明最终 panel 仍不能显示 text；若要证明 descriptor 初始分类本身，则应新增只观察公开 preview port 初始状态的合同，而不是用缺失 `blob()` 的伪 Response 代替网络语义。本轮不改测试、不改产品，避免把 harness 缺口误报成产品红项。

## 复核命令

```text
npx vitest run tests/file-browser.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       15 passed (15)

npx vitest run \
  tests/file-browser.test.jsx \
  tests/channel-files.test.jsx \
  tests/files-panel-lifecycle.test.jsx \
  tests/right-panel-file-reference.test.jsx \
  tests/outbox-attachment-transaction.test.js \
  --reporter=verbose
Test Files  5 passed (5)
Tests       36 passed (36)
```

本轮未改产品；`31a892d` 的产品修复与公开 Files tests 是既有提交，本报告只把已经通过的真实 baseline evidence 回填到总账。
