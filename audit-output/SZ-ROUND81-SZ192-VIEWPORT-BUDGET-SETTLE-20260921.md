# S–Z round 81 — SZ-192 viewport budget settle handoff

审计基线：`c95e253bdcc3aca81684333dffa600e5b8593592`（独立
worktree `unit-s-z/sz192-current-c95e253`）。本轮只补 SZ-192 的公开合同
测试和审计；没有修改 product source、Workspace、Reading、Outbox、Feed、
vendor、package、lockfile、旧 API 或私有 export。

## 唯一 baseline 与归属

中央账本将以下一条保留为 **SZ-192 / OPEN**：

`tests/timeline-reading-integration.test.jsx` 的历史 case
“同供给 active attempt 期间 viewport 预算变化在 settle 后交回 DOM owner
重验”。历史 setup 由 `faadffb^` 中的该 case 精确恢复：公开 Reading port
先发 `onUnderfill({ demandUnits: 2 })`，同一 active attempt 未完成时再发
`onUnderfill({ demandUnits: 7 })`，首个 operation settle 后第二个 promise
得到 typed `consumer-recheck / attempt-settled`，且 physical request 仍只
有一次。

这不是 SZ-191 的 same-generation EOF/reservoir reopen：SZ-191 验证供给
证书重新打开时的新 attempt；SZ-192 验证同一个 attempt 内 DOM budget
变化必须等待 settle 后回到 DOM owner 重测。它也不是 SZ-200 的首个
Presentation range materialization：SZ-200 验证 materializing 与
viewabilityState，不验证 active viewport underfill 的 dedupe。

## 用户能力、不变量与唯一 owner

| 项目 | 合同 |
|---|---|
| 用户能力 | 页面在一次历史供给进行中改变 viewport 预算时，不丢失欠供给义务，也不重复启动同一 physical history request；供给结束后 DOM owner 可重新测量当前预算。 |
| 不变量 | 同一 activation/source/obligation 的 active attempt 只有一个；后到 budget evidence 不能复制 scheduler writer 或被静默丢弃；settle 返回 typed consumer handoff。 |
| semantic owner | `useConversationProjection` 暴露 viewport port，`useHistoryConsumer` 负责 obligation dedupe 与 settle handoff。 |
| physical DOM owner | `VendorListExecutor` 是唯一接收/发布真实 viewport geometry 的 DOM/range writer；测试只从 projection 的公开 viewport port 驱动，不读 executor ref、scheduler map 或 store 内部字段。 |

当前实现中的 `useHistoryConsumer` 对同一 obligation/source 的第二个
viewport demand 返回 `active.promise.then(() => ({ kind: 'consumer-recheck',
reason: 'attempt-settled' }))`；因此不需要新增 store、第二 scheduler 或兼容
路径。

## 公开证据

新增的直接测试为
[tests/sz192-viewport-budget-settle-public-owner.test.jsx:85](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz192-current-c95e253/tests/sz192-viewport-budget-settle-public-owner.test.jsx:85)。它通过真实
`useConversationProjection` 和 canonical replica `state.rows`/`timeline`
建立 mine-scope Presentation，随后只调用公开的
`result.current.viewport.onUnderfill`：

1. 第一次 underfill 启动一次 `reason: underfill`、`urgency: anticipatory`
   request。
2. active request 未 settle 时第二次 underfill 不产生第二次 request。
3. 首个 request resolve 后第二个公开 promise 得到
   `{ kind: 'consumer-recheck', reason: 'attempt-settled' }`。
4. request 总数仍为 1；测试没有断言 `_unmatchedTerminalClosures`、
   active refs、内部 obligation key 或任何私有 store。

现有 owner 入口位于
[src/ui/timeline/useConversationProjection.js:1017](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:1017)，settle handoff
位于
[src/ui/timeline/useHistoryConsumer.js:513](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useHistoryConsumer.js:513)。本轮没有改变这两个
product 文件。

## 验证结果

Focused：

```text
npm test -- --run tests/sz192-viewport-budget-settle-public-owner.test.jsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

同一 focused case 连续重复 5 次，均为 `1 passed / 1 passed`。

相邻历史/DOM owner 回归：

```text
npm test -- --run \
  tests/sz180-history-source-reacquisition.test.jsx \
  tests/sz181-local-only-exhaustion-public-owner.test.jsx \
  tests/sz182-bookmark-gen-source-reacquisition.test.jsx \
  tests/sz183-bookmark-supply-advance-revalidate.test.jsx \
  tests/sz191-eof-reservoir-reopen.test.jsx \
  tests/reading-observation-settle.test.jsx \
  tests/reading-bottom-intent-waiting-contract.test.jsx
Test Files  7 passed (7)
Tests       15 passed (15)
```

**Disposition: ACCEPT / PROVEN-DIRECT.** 现有唯一公开 owner 已经满足
SZ-192；本提交是 test/audit-only，不生成产品回归包，也不重复计算 SZ-191
或 SZ-200。
