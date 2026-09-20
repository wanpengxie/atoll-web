# N–R Round 28：Feed 生命周期与 NR19 公开 owner 证据

检查时间：2026-09-20（Asia/Singapore）。

本轮只在 `tests/` 与 `audit-output/` 留证；没有为测试导出私有 owner、恢复旧 store/API、删除或 skip case。共享工作树的产品候选由其他 owner 同时维护；本报告不把其 dirty diff 归属于本分区。

## Feed 生命周期公开 owner

当前检查点：`118035d7d97a01e28d2d34cca97e8458e891de88`（另有共享工作树 dirty 产品候选）。

公开入口：`createChannelFeedRuntime()` 的 `mount/getSnapshot/setHistoryGrants/loadHistory/disconnectHistory/pageEnd/clear/destroy`。定向命令：

```text
npx vitest run tests/channel-feed-runtime.test.jsx --reporter=verbose
```

结果：**19/19 passed**。

| contract | public observation | result |
|---|---|---|
| disconnect/regrant | 已发出的 generation-1 demand 被取消；重授权不会偷 replay 退休 intent；调用者发起新 demand 后才以 generation-2 发出 request | ACCEPT |
| worldChanged | late generation-1 page 的 `pageEnd` 返回 false，旧 rows 不进入当前 Replica，新的 boot/generation 保持可用 | ACCEPT |
| clear + late grant | late `setHistoryGrants` 不发网络、不创建 Replica state、不恢复 attached/loading | ACCEPT |
| destroy + late grant | 旧 snapshot 的 late grant 被 lifecycle fence 拒绝；不发网络、不创建 state、不复活 history | ACCEPT |
| normal replacement runtime | 退休 runtime 的 pending demand 不泄漏；新 runtime 获 grant 后从 head+1 发出一次干净 demand，空页正确 exhausted | ACCEPT |

对应测试在 [tests/channel-feed-runtime.test.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/channel-feed-runtime.test.jsx)；所有断言都经公开 Feed snapshot 完成，没有手动注入内部 store。

## Reading 最新候选复验

这些是只读复验，未改 Reading 产品文件。

命令：

```text
ATOLL_TEST_WEB_PORT=15183 ATOLL_TEST_MOCK_PORT=18842 npx playwright test tests/browser/history-presentation-admission-prototype.spec.js --grep='one older gesture' --repeat-each=3 --reporter=line --output=test-results-round28-case1-current-3d69bd4
ATOLL_TEST_WEB_PORT=15184 ATOLL_TEST_MOCK_PORT=18843 npx playwright test tests/browser/history-reveal-prototype.spec.js --grep='trusted wheel takes over history work' --repeat-each=3 --reporter=line --output=test-results-round28-wheel-writer-current-3d69bd4
```

- Case1：**REJECT**。三次都保持一个真实 active list/可见 rows，但 anchor 精确像素没有保持基线 `-394`；收到 `35.1875`、`35.1875`、`-33.8125`。首断点为 `history-presentation-admission-prototype.spec.js:135` 的 anchor offset，而非诊断事件缺失。
- Trusted wheel writer：**REJECT**。三次都保持 list connected、mode `browsing`，但在反向 wheel 后观察到 `scrollTo({ top: 3964, behavior: "auto" })`；首断点为 `history-reveal-prototype.spec.js:104` 的 `writes === []`。这仍是公开 VendorListExecutor/Reading 链上的 writer 泄漏，不以删 assertion 处理。

## NR19 七条 evidence

定向命令：

```text
npx vitest run tests/right-panel-file-reference.test.jsx --reporter=verbose
```

结果：**7/7 passed**。七条都从公开 `WorkspaceRightPanel`、`ArtifactPreviewPanel`、`FilesFeature` owner 驱动：

1. 当前频道的绝对路径 Markdown 通过公开 preview command 内开；阻止 host 导航。
2. 没有 preview command 时文件引用 fail closed，既不导航也不伪造内部打开。
3. 切频道后旧 artifact 不借新频道 command 打开。
4. 普通外链保留 `_blank`，且 click 不被拦截。
5. 有上一层时“关闭”与“返回上一个文件”都 pop 同一 preview stack。
6. 没有上一层时“关闭”调用真实 `onClose`。
7. recent entry 可通过公开 preview command 重新打开。

这七条已在当前 suite 中执行，但旧 NR19 ledger 仍按原迁移行数记为三条；本报告作为补充计数证据，避免把后续 public-owner expansion 遗漏为未覆盖。当前七条均 ACCEPT；不再沿用旧 `RightPanelHost` 或私有 provider。

