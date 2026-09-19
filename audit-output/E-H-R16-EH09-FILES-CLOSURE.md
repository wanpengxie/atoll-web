# E–H round 16 — EH09 Files owner closure

本轮处理 `audit-output/E-H-BASELINE-CURRENT-OWNER-CASE-LEDGER.md` 中 EH09-08、EH09-09、EH09-14 三条原 `FIXTURE-BLOCKED`。三条都属于同一公开生命周期 owner：`useAttachmentTransactions`（authority、directory/device request、draft persistence）+ `FilesFeature`（文件表面与用户错误反馈）。没有创建第二 owner、compat API 或 test-only branch。

## 结论

**EH09-08 ACCEPT；EH09-09 ACCEPT；EH09-14 ACCEPT。** 原始用户动作与失败断言保留，fixture 仍从公开 `FilesFeature` 入口操作，产品修复只收敛同一 owner 的 stale completion、channel handoff 和 attach error publication。

定向结果：

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
  --reporter=dot
Test Files  5 passed (5)
Tests       33 passed | 1 expected fail (34)
```

更宽的 1 条 expected fail 属于既有 `right-panel-file-reference` 绝对路径来源 provider 缺口，不是 EH09-08/09/14，也没有被改写或跳过。`npm run build` 通过。

## 逐 case ledger

### EH09-08 — mutation completion cannot overwrite a newer directory

- **旧行为 / setup → action → result:** 在 `c0/docs/` 发起删除，删除回执故意延迟；用户先返回根目录；旧测试要求延迟完成后不能把 `docs/` 的结果覆盖已经提交的根目录，根目录仍显示 `docs/` 且不出现 `inside.txt`。
- **用户能力:** 用户在后台文件写操作完成前可以继续浏览/返回上一级；旧操作完成不会把视图跳回过时目录或显示错误内容。
- **不变量:** mutation completion 只能刷新它捕获的仍然 active 的 channel+directory+device；如果 committed file view 已变化，completion 必须丢弃 stale refresh，不得 abort/overwrite 新请求。
- **当前公开 owner 与证据:** `FilesFeature` 的删除按钮 → `commands.remove` → `useAttachmentTransactions.removeFile` → `refreshDirectory`。当前 owner 在删除开始时记录目录/device，并在 settlement 时对 `activeChannelRef`, current directory/device 做同一 owner 检查；只有仍匹配才 refresh。`tests/file-browser.test.jsx` 以真实 row click、真实 confirm、延迟 delete receipt 和返回上一级动作复现。
- **结果 / disposition:** **PASS / CLOSED。** 断言保留并从 `it.fails` 恢复为普通 `it`；没有把 stale fixture 预改成静态成功。

### EH09-09 — channel switch lands at the new channel root

- **旧行为 / setup → action → result:** 在 `c0/docs/` 浏览后切换到 `c1`；旧测试要求新频道初始请求 `daemon://local-device/c1/` 根目录，而不是沿用 `docs/` 子目录，并显示 `fresh.txt`。
- **用户能力:** 用户切频道后看到目标频道自己的文件根目录，不被上一频道的 directory/device 闭包污染。
- **不变量:** channel switch 是 attachment owner boundary；reset effect 与自动 directory refresh 不能在同一提交中让旧 channel state 对新 channel 发起请求。设备重新确认后，唯一 refresh 使用目标 channel 的 committed directory/device。
- **当前公开 owner 与证据:** 同一 `FilesFeature` row/breadcrumb entry → `navigateFiles`，外层 Harness 只复现 WorkspaceApp 传入的 stable channel/device/wire refs；`useAttachmentTransactions` 在 channel reset 时清空旧 device 触发的 refresh，待目标设备回执后再启动目标 root refresh。测试真实 `view.rerender` 到 `c1` 并断言 `fresh.txt`。
- **结果 / disposition:** **PASS / CLOSED。** 原切频道动作和 root assertion 保留；没有把新频道 fixture 改为旧目录或直接注入 entries。

### EH09-14 — rejected durable attachment is absent and visibly explained

- **旧行为 / setup → action → result:** 文件行点击“附加”，draft persistence 故意拒绝；旧用户合同要求附件不进入 composer projection，并在文件 surface 给出可见 `role="alert"` 错误，而不是静默 unhandled rejection。
- **用户能力:** 用户知道附件关联失败及原因，且不会误以为文件已经附加；失败资源不能污染草稿。
- **不变量:** `attach` 使用同一 captured draft/authority owner；persist rejection 必须保持 composer projection 不变、发布文件错误；FilesFeature 事件边界必须消费 promise rejection，不能制造 unhandled rejection。
- **当前公开 owner 与证据:** `FilesFeature` 的公开“附加”按钮 → `commands.attach` → `useAttachmentTransactions.attach` → `persistDraftAttachments`。owner catch 将当前频道错误写入 `filesError`，FilesFeature 以 `role="alert"` 展示；按钮事件消费 rejection。测试仍使用真实 row/button，检查 persistence 被调用、projection 为空和 alert 文本包含 `草稿所有权已变化`。
- **结果 / disposition:** **PASS / CLOSED。** 原 `it.fails` 改为普通行为断言；没有删除 failure assertion，也没有只吞掉错误来取绿。

## 最小 owner diff

- `useAttachmentTransactions.removeFile` 捕获 settlement 时的 current directory/device；stale view 不再调用 refresh。
- channel reset 先清除旧 device，待新 device rows 确认后才触发目标目录 refresh；保留 per-channel session restore，不改变 public port。
- `useAttachmentTransactions.attach` 在同一 owner 内把 persist failure 发布为 `filesError` 后重新抛出；`FilesFeature` 事件边界消费 rejection，避免 unhandled，同时保留 visible alert。

未修改 package、lockfile、vendor；未恢复旧 `ArtifactsView`/`FilesPanel` API；未改 EH08-12 cache-redaction owner。
