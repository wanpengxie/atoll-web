# S–Z round 86 — SZ-197 zero-row admission queues interactive demand

审计基线：`c4906ca432ea9a25294a7e13f6a252b680273e6f`（独立 worktree
`unit-s-z/sz197-current-c4906ca`）。本轮只处理中央账本中的 SZ-197；没有
修改 product source、Workspace、Reading、Outbox、Feed、vendor、package、
lockfile、旧 API 或私有 export。

## 唯一 baseline 与边界

唯一 SZ-197 baseline 是历史
`tests/timeline-reading-integration.test.jsx` case：零行的 live-admission
供给 K0 settle 后，Admission 事务必须先提交首批，再续发用户已经发出的
interactive top demand。公开交错为：

1. 空的当前 Presentation 由公开 underfill 机制启动一个 anticipatory K0；
   K0 保持 pending，不能在首个 Admission 事务结束前再启动请求；
2. K0 以公开 `{ kind: 'satisfied' }` settle，同时 Admission 进入公开
   `pending-baseline-commit`；
3. 用户在该事务尚未释放时通过公开 `viewport.onAtTop()` 发出一次真实
   interactive demand；它必须被保留为一个 typed waiter，不能与 K0 并行；
4. Admission 回到公开 `idle` 后，只续发一次 `{ reason: 'top',
   urgency: 'interactive' }` 的 history request。

这不是 SZ-193 的 reservoir-before-EOF successor、SZ-194 的 failed-attempt
successor、SZ-195 的 settle-before-acquisition handoff，也不是 SZ-196 的
rejected admission/DOM debt successor。SZ-197 专门证明“零行首批已满足但
live Admission 仍在提交”期间，用户 top 意图不丢失、不重复且在事务后续发。

## 用户能力、不变量与唯一 owner

| 项目 | 合同 |
|---|---|
| 用户能力 | 空的当前历史视图在首批供给提交期间仍可响应用户的 top 交互；事务结束后用户只会得到一个正确的 interactive history continuation。 |
| 不变量 | K0 zero-row settle 先经过 Admission；blocking 期间同一 top 意图至多保留一个 waiter；Admission 释放后只产生一个 K1，且 K1 保留 `reason=top` 与 `urgency=interactive`。 |
| semantic owner | `useConversationProjection` 暴露公开 viewport；`useHistoryConsumer` 负责 Admission gate、deferred handoff 与续发。 |
| physical/history owner | Feed/history request 是唯一 acquisition owner；本测试只使用公开 projection/history status 与 viewport port，不读取内部 ref、队列、store 或 scheduler 状态。 |

## 公开证据

直接测试为
[tests/sz197-zero-row-admission-interactive-public-owner.test.jsx:40](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz197-current-c4906ca/tests/sz197-zero-row-admission-interactive-public-owner.test.jsx:40)。它通过真实
`useConversationProjection` 建立空的公开 Presentation，以公开
`presentationAdmission.snapshot` / `presentationAdmissionState` 驱动
Admission 交错，再从 `result.current.viewport.onAtTop` 驱动用户意图：

- 首次 request 只发生一次，且代表空行 Presentation 的 underfill supply；
- K0 settle 与 `pending-baseline-commit` 同时存在时，top gesture 不增加
  request count；
- Admission 恢复 `idle` 后 request count 恰好从 1 变为 2；第二次 request
  的公开参数同时为 `reason: 'top'`、`urgency: 'interactive'` 与
  `intent: 'scroll-history'`。

测试没有断言 `_` 前缀字段、私有队列或内部 store；`activationID` 仅作为公开
Admission token 的关联值，不作为实现 oracle。

## 验证结果

Focused case：

```text
npm test -- --run tests/sz197-zero-row-admission-interactive-public-owner.test.jsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

Focused 连续重复 5 次，全部通过；每次均观察到 K0 的单次
`projection-underfill` request，以及 Admission 释放后的单次 `top` interactive
request，无并行或重复请求。

相邻 history/Admission owner smoke：

```text
6 files passed
27 tests passed
```

相邻 smoke 覆盖 SZ-193、SZ-194、SZ-195、SZ-196 及既有
history/presentation Admission contracts；本轮没有相邻失败。

Build：

```text
npm run build
✓ built in 3.08s
```

只有既有 Vite large-chunk warning。

**Disposition: ACCEPT / PROVEN-DIRECT for SZ-197.** 当前公开 owner 已满足
zero-row Admission commit、interactive top handoff 与单请求边界；本提交只增加
一条一对一 test/audit evidence，不新增 store、compat、scheduler writer，也不
改变其他 ledger row。
