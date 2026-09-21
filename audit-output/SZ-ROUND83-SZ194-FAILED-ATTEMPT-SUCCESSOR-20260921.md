# S–Z round 83 — SZ-194 failed-attempt successor

审计基线：`d754f0d4e8b13ec316630732a86adb18a4b967d5`（独立
worktree `unit-s-z/sz194-current-d754f0d`）。本轮只处理中央账本中的
SZ-194；没有修改 product source、Workspace、Reading、Outbox、Feed、
vendor、package、lockfile、旧 API 或私有 export。

## 唯一 baseline 与边界

唯一 SZ-194 baseline 是历史
`tests/timeline-reading-integration.test.jsx` case：
“新供给不能继承旧 attempt 的 anticipatory 失败且 successor 仍执行”。
精确公开交错为：

1. viewport `onUnderfill()` 启动 K0，request 保持 pending；
2. status 发布新的 `completedPages: 4, buffered: 148`，同一公开
   underfill 产生 successor waiter，但不能复制 K0 request；
3. K0 settle 为 `{ kind: 'failed', error: ... }`；
4. 在当前 K1 supply progress 下再次测量，必须启动且只启动一个新
   request；同一 K1 进度的重复 underfill 不得重放。

这不是 SZ-193 的旧 EOF 交错：SZ-193 验证旧 EOF 不封住新 reservoir；
SZ-194 专门验证旧 anticipatory failure 不污染新 supply progress。它也不
   重复 SZ-191 已 settle EOF 后的 reservoir reopen。

## 用户能力、不变量与唯一 owner

| 项目 | 合同 |
|---|---|
| 用户能力 | 一次历史补给失败后，只要新 reservoir/source progress 到达，用户仍能继续获得同一 viewport history obligation 的供给，而不是永久 unavailable。 |
| 不变量 | failure fence 只绑定旧 `historyProgressKey`；新的 supply progress 允许 successor；active K0/K1 之间最多一条未决 successor，且当前进度重复 underfill 有界。 |
| semantic owner | `useConversationProjection` 暴露 viewport；`useHistoryConsumer` 保存 attempt/failure/supply-progress 语义并决定 typed successor。 |
| physical/history owner | Feed 提供 typed history status/source progress；`VendorListExecutor` 是实际 DOM/range budget owner。本测试只调用公开 viewport port，不读取 failed ref、obligation key 或 store。 |

## 公开证据

直接测试为
[tests/sz194-failed-attempt-successor-public-owner.test.jsx:75](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz194-current-d754f0d/tests/sz194-failed-attempt-successor-public-owner.test.jsx:75)。它通过真实
`useConversationProjection` 建立一行 Presentation，公开 rerender
`history.status.completedPages/buffered`，再从
`result.current.viewport.onUnderfill` 驱动 K0、successor 与 K1：

- K0 失败后，successor 仍只完成旧 attempt 的 handoff，request count
  保持 1；
- 当前 K1 progress 下第一次 underfill 使 request count 变为 2；
- 同一 K1 progress 的第二次 underfill 不增加 request；
- 最终公开 status 保留 generation、source lease、reservoir progress、
  `hasOlder: true`。

相关现有 owner 分支为
[src/ui/timeline/useHistoryConsumer.js:448](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz194-current-d754f0d/src/ui/timeline/useHistoryConsumer.js:448)（failure fence）及
[src/ui/timeline/useHistoryConsumer.js:480](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz194-current-d754f0d/src/ui/timeline/useHistoryConsumer.js:480)（supply-progress successor）。本轮未修改这些 product 文件。

## 验证结果

Focused case：

```text
npm test -- --run tests/sz194-failed-attempt-successor-public-owner.test.jsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

Focused 连续重复 5 次，全部为 `1 passed / 1 passed`。

相邻 history/DOM owner smoke（当前 main）：

```text
12 files, 20 tests requested
11 files passed, 19 tests passed
1 unrelated existing test failed:
  tests/sz186-following-cache-authority.test.jsx
  expected viewport.availability 'readable', received 'materializing'
```

该唯一相邻失败来自当前基线已集成的
`d754f0d fix(sz200): gate cold entry on first materialized range` 与旧
SZ-186 expectation 的语义差异；本 SZ-194 commit 未修改 SZ-186、SZ-200 或
任何 product 文件，故作为独立 SZ-200 follow-up regression handoff，不计入
SZ-194 红项。

Build：

```text
npm run build
✓ built in 4.80s
```

只有既有 Vite large-chunk warning。

**Disposition: ACCEPT / PROVEN-DIRECT for SZ-194.** 现有公开 owner 已满足
旧失败与新供给 progress 的边界；本提交只增加一条一对一 test/audit
evidence，不新增 store、compat、scheduler writer，也不改变其他 ledger
row。
