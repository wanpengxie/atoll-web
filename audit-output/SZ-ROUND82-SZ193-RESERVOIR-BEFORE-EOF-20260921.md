# S–Z round 82 — SZ-193 reservoir-before-EOF settle handoff

审计基线：`6a2a377ad8d4e73dd494b1bff9a3c53d763f59e9`（独立
worktree `unit-s-z/sz193-current-6a2a377`）。本轮是 SZ-193 的单 case
公开 owner 复核；没有修改 product source、Workspace、Reading、Outbox、
Feed、vendor、package、lockfile、旧 API 或私有 export。

## 唯一 baseline 与边界

中央账本中的唯一 SZ-193 baseline 是历史
`tests/timeline-reading-integration.test.jsx` case：
“reservoir 在旧 EOF settle 前发布时保留一个同义务 successor 且不缓存迟到
EOF”。旧 setup 的 observable sequence 是：

1. viewport `onUnderfill()` 启动 K0，request promise 保持 pending；
2. status 发布 `completedPages: 4, buffered: 148` 后再次触发同一公开
   underfill；
3. K0 settle 为 `{ kind: 'exhausted' }` 时不复制 request，successor 等待
   K0 完成；
4. 对 K1 的第一次 underfill 只重新启动一次，紧随其后的 underfill 不再
   重放 K1。

这与已交审的 SZ-192 不重复：SZ-192 只证明同一 active attempt 中 viewport
budget 变化在 settle 后返回 DOM owner recheck；SZ-193 证明旧 EOF 之前出现
新的 reservoir progress 时，旧 EOF 不会封住新供给。也不重复 SZ-191：
SZ-191 从已经 settle 的 EOF 开始验证 reservoir reopen；SZ-193 覆盖
reservoir 在旧 attempt 尚未 settle 的交错。

## 用户能力、不变量与唯一 owner

| 项目 | 合同 |
|---|---|
| 用户能力 | 新历史 reservoir 在旧请求结束前到达时，当前 viewport 的历史义务继续可达；用户不会看到同义务的重复 physical request，也不会被迟到 K0 EOF 永久挡住。 |
| 不变量 | K0 与 K1 由同一当前 semantic obligation 串行衔接；K0 settle 期间最多保留一个 successor；K0 的 exhausted 结果不能被缓存/重标签为 K1 的当前 EOF；K1 settle 后重复 underfill 必须有界。 |
| semantic owner | `useConversationProjection` 暴露 viewport port；`useHistoryConsumer` 按 activation、source lease、supply progress 和 obligation 做 successor/dedupe。 |
| physical/history owner | `ChannelFeedRuntime` 提供 typed history status/source progress；`VendorListExecutor` 是真实 DOM/range budget 的唯一物理 owner。本测试只从 projection 的公开 viewport port 驱动，不读 scheduler map、active ref 或 Replica 私有 closure。 |

## 公开证据

直接测试为
[tests/sz193-reservoir-before-eof-settle-public-owner.test.jsx:76](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz193-current-6a2a377/tests/sz193-reservoir-before-eof-settle-public-owner.test.jsx:76)。测试通过真实
`useConversationProjection` 与公开 `result.current.viewport.onUnderfill`
入口，使用带一行 Presentation 的 all-scope view：

- K0 request 由一个 pending promise 表示；第一次 `onUnderfill()` 只创建
  一个 request；
- rerender 公开 history status 的 `completedPages/buffered` 供给进度后，
  第二次 underfill 不创建第二个 writer；
- K0 返回 exhausted 后，successor promise 完成但 request 仍只有一次；
- 下一次 underfill 为当前 K1 启动且只启动一次；再调用一次不重复；
- 最终公开 viewport status 仍显示 generation/source lease/current
  reservoir 与 `hasOlder: true`。

当前 owner 入口为
[src/ui/timeline/useConversationProjection.js:1017](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz193-current-6a2a377/src/ui/timeline/useConversationProjection.js:1017)，active/supply-progress successor 分支为
[src/ui/timeline/useHistoryConsumer.js:480](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz193-current-6a2a377/src/ui/timeline/useHistoryConsumer.js:480)。本轮未修改这些 product 文件。

## 验证结果

Focused：

```text
npm test -- --run tests/sz193-reservoir-before-eof-settle-public-owner.test.jsx
Test Files  1 passed (1)
Tests       1 passed (1)
```

相邻 history/DOM owner 回归：

```text
npm test -- --run \
  tests/sz180-history-source-reacquisition.test.jsx \
  tests/sz181-local-only-exhaustion-public-owner.test.jsx \
  tests/sz182-bookmark-gen-source-reacquisition.test.jsx \
  tests/sz183-bookmark-supply-advance-revalidate.test.jsx \
  tests/sz184-bookmark-retry-unmount.test.jsx \
  tests/sz185-cache-retry-epoch.test.jsx \
  tests/sz186-following-cache-authority.test.jsx \
  tests/sz187-notification-following-boundary.test.jsx \
  tests/sz190-history-demand-upgrade.test.jsx \
  tests/sz191-eof-reservoir-reopen.test.jsx \
  tests/reading-observation-settle.test.jsx \
  tests/reading-bottom-intent-waiting-contract.test.jsx
Test Files  12 passed (12)
Tests       20 passed (20)
```

Focused case repeated five times; each run was `1 passed / 1 passed`. The
production build also passed:

```text
npm run build
✓ built in 2.78s
```

Vite emitted only the repository's existing large-chunk warning. All commands
ran in the above current-main worktree.

**Disposition: ACCEPT / PROVEN-DIRECT.** 现有公开 owner 已覆盖 SZ-193；
本提交只增加一条一对一 test/audit evidence，不新增 store、compat、
scheduler writer，也不改变 central ledger 的其他 rows。
