# S–Z round 85 — SZ-196 admission rejection preserves viewport debt

审计基线：`89c04f13e683d092e84f7bd26ae9a5e4aac19336`（独立 worktree
`unit-s-z/sz196-current-89c04f1`）。本轮只处理中央账本中的 SZ-196；没有
修改 product source、Workspace、Reading、Outbox、Feed、vendor、package、
lockfile、旧 API 或私有 export。

## 唯一 baseline 与边界

唯一 SZ-196 baseline 是历史
`tests/timeline-reading-integration.test.jsx` case：
“underfill 已有结果后，staging Admission 被拒绝/进入 holding，不能消费
同一 DOM 欠账；Admission 释放后应打开一个 successor attempt”。公开交错为：

1. viewport `onUnderfill()` 启动 K0，request 保持 pending；
2. K0 返回公开 `{ kind: 'satisfied' }`，但当前 presentation Admission
   进入 `pending-baseline-commit`，因此 K0 的 DOM obligation 仍不能被视为
   完成；
3. 同一 baseline 再次 `onUnderfill()` 必须形成 deferred waiter，不能复制
   request；
4. Admission 进入公开 `holding` 后，deferred waiter 只收到
   `consumer-recheck / admission-settled`；下一次当前 DOM 测量启动且只启动
   一个 K1 request。

这不是 SZ-195 的 settle-before-acquisition case：SZ-195 验证 Admission 在
任何补给开始前 settle 时的 handoff；SZ-196 专门验证 K0 已报告 satisfied
但结构性 Admission rejection 仍保留 DOM 欠账。它也不重复 SZ-193/194 的
reservoir 或 failure successor 边界。

## 用户能力、不变量与唯一 owner

| 项目 | 合同 |
|---|---|
| 用户能力 | 历史列表在 staging Admission 被拒绝时不会丢失“仍需补齐”的可见范围；Admission 释放后用户可继续取得同一 viewport history obligation 的供给。 |
| 不变量 | K0 `satisfied` 不绕过 blocking Admission；holding 期间同一 DOM debt 至多一个 deferred waiter，不产生第二个 request；settle 后当前 DOM owner 只开启一个 successor。 |
| semantic owner | `useConversationProjection` 暴露公开 viewport；`useHistoryConsumer` 负责 Admission gate、deferred handoff 与 successor attempt。 |
| physical/history owner | Feed 提供 typed history status/Admission snapshot；`VendorListExecutor` 是实际 DOM/range budget owner。本测试只调用公开 viewport port，不读取内部 obligation、ref、store 或 scheduler 状态。 |

## 公开证据

直接测试为
[tests/sz196-admission-reject-debt-successor-public-owner.test.jsx:67](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz196-current-89c04f1/tests/sz196-admission-reject-debt-successor-public-owner.test.jsx:67)。它通过真实
`useConversationProjection` 建立一行公开 Presentation，以公开
`presentationAdmission.snapshot` 和 `presentationAdmissionState` 驱动
Admission 交错，再从 `result.current.viewport.onUnderfill` 驱动 K0、deferred
handback 与 K1：

- K0 的公开 settle 结果为 `consumer-recheck / acquisition-satisfied`；
- Admission holding 时第二次 underfill 不增加 request count，而公开
  handback 为 `consumer-recheck / admission-settled`；
- Admission 释放后的下一次 underfill 使 request count 从 1 变为 2；
- 最终公开 status 保留 generation、source lease、`hasOlder: true`，证明
  successor 仍属于同一当前 history owner。

相关现有 owner 为
`src/ui/timeline/useHistoryConsumer.js` 的 blocking Admission 分支与
admission-settled handback；本轮未修改这些 product 文件。

## 验证结果

Focused case：

```text
npm test -- --run tests/sz196-admission-reject-debt-successor-public-owner.test.jsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

Focused 连续重复 5 次，全部为 `1 passed / 1 passed`；每次均观察到
`K0 intent_started → intent_satisfied → K1 intent_started → intent_exhausted`。

相邻 history/DOM owner smoke：

```text
7 files requested
6 files passed, 14 tests passed
```

相邻 smoke 覆盖 SZ-190、SZ-191、SZ-193、SZ-194、SZ-195 及既有 Reading
observation/bottom-intent contracts；本轮没有相邻失败。

Build：

```text
npm run build
✓ built in 3.19s
```

只有既有 Vite large-chunk warning。

**Disposition: ACCEPT / PROVEN-DIRECT for SZ-196.** 当前公开 owner 已满足
Admission rejection、DOM debt handback 与 successor 边界；本提交只增加一条
一对一 test/audit evidence，不新增 store、compat、scheduler writer，也不
改变其他 ledger row。
