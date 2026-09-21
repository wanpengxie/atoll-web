# S–Z round 84 — SZ-195 admission-settle underfill handoff

审计基线：`e60b20a9043594aaaa7064cac93782acae3cadf4`（独立
worktree `unit-s-z/sz195-current-e60b20a`）。本轮只处理中央账本中的
SZ-195；没有修改 product source、Workspace、Reading、Outbox、Feed、
vendor、package、lockfile、旧 API 或私有 export。

## 唯一 baseline 与当前语义

唯一 SZ-195 baseline 是历史
`tests/timeline-reading-integration.test.jsx` case：
“blocking admission 结束后把 anticipatory underfill 交回 DOM owner 重验而
不直接取数”。当前语义保留原用户能力，并接受 SZ-200 的
`materializing` 冷入口状态：本 case 已有一行 Presentation，不对
`viewport.availability` 做旧 readable 断言。

精确公开交错为：

1. 当前 Presentation admission 为与 activation/view/generation 匹配的
   `pending-baseline-commit` token；
2. viewport 公开 `onUnderfill({ demandUnits: 3 })` 返回 pending debt，
   不启动 history request；
3. admission 回到 `idle` 后，pending debt 只 resolve 为 typed
   `consumer-recheck / admission-settled`；request 仍为零。

该合同不重复 SZ-192 的 active attempt settle，也不重复 SZ-193/194 的
reservoir/failure successor。它专门证明 staging authority 持有期间 DOM
budget debt 不会绕过 Admission 直接取数。

## 用户能力、不变量与唯一 owner

| 项目 | 合同 |
|---|---|
| 用户能力 | Presentation 正等待 blocking admission commit 时，viewport 欠供给不会触发错误的第二历史写入；commit 完成后由当前 DOM owner 重新测量。 |
| 不变量 | matching activation、viewID、generation 的 blocking token 是唯一 staging authority；underfill debt 不被消费、不复制 scheduler request；token 退出 blocking phase 只产生 typed handback。 |
| semantic owner | `useConversationProjection` 暴露 viewport port；`useHistoryConsumer` 通过 `blockingAdmission` 管理 deferred recheck。 |
| physical owner | `VendorListExecutor` 是唯一真实 DOM/range budget owner；Admission 只提供 typed snapshot/evaluate/source fence。本测试不读私有 deferred ref、store 或 scheduler map。 |

## 公开证据

直接测试为
[tests/sz195-admission-settle-underfill-public-owner.test.jsx:65](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz195-current-e60b20a/tests/sz195-admission-settle-underfill-public-owner.test.jsx:65)。它通过真实
`useConversationProjection`、一行 Presentation 和公开
`result.current.viewport.onUnderfill` 驱动 admission：

- `pending-baseline-commit` token 的 activation/view/epoch 与当前 public
  viewport 完全匹配；
- underfill debt 建立期间 `request` 保持未调用；
- admission 变为 `idle` 后 debt resolve 为
  `{ kind: 'consumer-recheck', reason: 'admission-settled' }`；
- resolve 后 request 仍为零，证明 handback 没有隐式启动第二 writer。

相关 owner 代码为
[src/ui/timeline/useHistoryConsumer.js:603](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz195-current-e60b20a/src/ui/timeline/useHistoryConsumer.js:603)（blocking admission defer）和
[src/ui/timeline/useHistoryConsumer.js:1117](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz195-current-e60b20a/src/ui/timeline/useHistoryConsumer.js:1117)（admission-settled handback）。本轮未修改 product owner。

## 验证结果

Focused case：

```text
npm test -- --run tests/sz195-admission-settle-underfill-public-owner.test.jsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

Focused 连续重复 5 次，全部为 `1 passed / 1 passed`。

相邻 owner smoke：

```text
npm test -- --run \
  tests/sz191-eof-reservoir-reopen.test.jsx \
  tests/sz193-reservoir-before-eof-settle-public-owner.test.jsx \
  tests/sz194-failed-attempt-successor-public-owner.test.jsx \
  tests/sz190-history-demand-upgrade.test.jsx \
  tests/reading-observation-settle.test.jsx \
  tests/reading-bottom-intent-waiting-contract.test.jsx
Test Files  5 passed (5)
Tests       13 passed (13)
```

Build：

```text
npm run build
✓ built in 3.09s
```

只有既有 Vite large-chunk warning。

**Disposition: ACCEPT / PROVEN-DIRECT.** 当前公开 owner 覆盖 SZ-195；本
提交只增加一条一对一 test/audit evidence，不新增 store、compat 或
scheduler writer，也不改动 SZ-200 的 materializing 语义。
