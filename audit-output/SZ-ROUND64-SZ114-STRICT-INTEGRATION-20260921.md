# SZ-114 strict：真实 history consumer → Surface failure/retry 合同

日期：2026-09-21
基线：`71d890b5a947f810829f8b1a8f85ba237f1ea1dc`
分支：`unit-s-z/sz114-strict-82e22`
范围：只新增公开集成测试与审计；不修改产品源、协议、backend、store、Reading owner 或兼容路径。

## 严格用户合同

当当前频道已有可见动态但较早 history supply 进入失败态时，用户必须看到服务错误而不是空频道/EOF；唯一当前 Surface Retry 必须回到同一 `scroll-history` obligation（当前视图、当前 source lease、首行 anchor），并在 owner 发布 pending/settled 后分别显示进度、清除错误。

唯一 owner 链：

`history.status` / `history.request` public port → 真实 `useConversationProjection` → 真实 `useHistoryConsumer.retry` → `ConversationSurface`。

## 新增 strict 证据

`tests/sz114-history-failure-ui-integration.test.jsx` 保留真实 `useConversationProjection` 与 `useHistoryConsumer`，只隔离非目标的物理 `ReadingContainerHandoff`、Waiting、Timeline row renderer 和偏好 hook。测试不读 React/fiber/private store，也没有复制 SZ-282 Feed 测试计分：

1. 公开 status 从 `pending` rerender 到 `error`，Surface 渲染服务错误 `temporary offline`、`role="alert"` 与唯一“重试”。
2. 点击真实 Surface Retry 后，公开 `history.request` 收到真实 consumer 生成的 typed 请求：`reason: 'retry'`、`intent: 'scroll-history'`、`anchorSeq: 20`、`explicitRetry: true`、当前 `viewSpec.scope: 'all'`。初始挂载无额外 request，证明没有第二 scheduler。
3. status 从 retry 后 `pending` 到 `idle`，同一 Surface status 区域显示“正在读取更早动态…”并最终清除错误；测试只观察公开 DOM/port。

## 定向验证

```text
npm test -- --run tests/sz114-history-failure-ui-integration.test.jsx --reporter=dot
✓ Test Files 1 passed (1)
✓ Tests 1 passed (1)

npm run build
✓ built successfully
```

strict owner 链已闭合；该提交不重复计算已计入 SZ-282 的 Feed runtime 证据，只提供 SZ-114 当前 UI/consumer 的新增集成覆盖。
