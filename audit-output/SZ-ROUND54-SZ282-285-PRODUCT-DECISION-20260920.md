# S-Z Round 54：SZ-282–285 产品取舍与公开 owner 迁移

日期：2026-09-20

基线：`2bf5173`

分支：`unit-s-z/round54-sz282-285-decision-2bf5173`

本轮只处理 SZ-282、SZ-283、SZ-284、SZ-285 四个 OPEN。目标是保留用户可感知的历史读取与终态结果，明确放弃旧 scheduler 的分段 reservoir/页来源顺序等实现细节；不恢复 `createHistoryScheduler`、不新增 owner、不删旧 baseline/skip。

## 逐案决定

| case / exact baseline title | 保留的用户能力 | 不变量 | 当前公开 owner / 结果 | 产品裁决 |
| --- | --- | --- | --- | --- |
| SZ-282 / `drains one bounded reservoir newest-first across partial reveal segments` | 用户向上浏览时，旧历史按当前 demand 逐步出现，顺序不跳跃、不重复，并能在不可用时看到 pending/error/retry。 | 当前 activation 的 history obligation 单一归属；前台错误不伪装 EOF，也不由旧缓存猜出完成。 | 当前 owner 是 `useHistoryConsumer` → `ChannelFeedRuntime.loadHistory/historyFor` → Replica projection。公开 `historyDemand`、`buffered`、`revealVersion`、retry 已覆盖用户反馈；旧 `beginOperation().next({count})` release 顺序不再是公开能力。 | **迁移并放弃实现细节**：不保留 `[3]→[2]→[1]` reservoir 单测；以当前 history demand 的可见进展、pending/error/retry 和最终行顺序为合同。原 OPEN 需 owner 后续补一条公开 UI/projection successor，不能恢复旧 scheduler。 |
| SZ-283 / `merges a concurrent live terminal before publishing its buffered replay page` | live 终态先到时，历史页稍后发布仍显示同一 turn 已完成，Waiting 不复活。 | Feed 的 buffered history 与 live ingress 必须汇入同一 Replica terminal authority。 | 当前 owner 是 `ChannelFeedRuntime.enqueue/pageEnd` + Replica + `selectFeatureWaitingFacts`。新增公开测试先缓冲 request/queued，再 live enqueue terminal，最后 pageEnd；公开 turn 为 `completed`，Waiting 为空。 | **保留用户能力，迁移 owner**：接受当前 Feed/Replica 公共结果；放弃旧 scheduler 的 trim/segment choreography。建议 SZ-283 以该 successor 关闭，不能把内部 page buffer 顺序继续列为产品合同。 |
| SZ-284 / `uses IndexedDB pages in the same terminal-before-request order` | 冷入口/缓存入口即使 terminal 先恢复，用户最终仍看到已完成 turn，不看到错误 Waiting。 | cache source 受当前 world/generation/range authority 约束；terminal-first 只能合并到精确 request，不能猜 EOF。 | 当前 source owner 是 `ChannelFeedRuntime` + `createHistorySourceAdapters`，canonical outcome owner 是 Replica/Waiting。新增公开测试以 `source:'cache'` terminal-first → request → queued 验证 `completed` 与 Waiting 为空；现有 Feed tests 另覆盖 cache range 校验及 partial-cache→network fallback。 | **迁移并放弃 IndexedDB 分段顺序细节**：保留 terminal-first 的用户结果与 cache authority；不要求旧三页读取顺序、不恢复旧 reservoir。建议用当前 cold-entry/cache public outcome successor 取代原 OPEN。 |
| SZ-285 / `merges a cached terminal into an already-materialized canonical request` | 已显示 request 收到缓存 terminal 后立刻完成；不生成第二个 turn，Waiting 消失。 | terminal 按精确 parent/request id 合并，终态优先于旧 request/provisional。 | 当前 canonical owner 是 `createChannelReplicaStore` + `selectFeatureWaitingFacts`。新增公开测试先 live materialize request/note，再 cache terminal；公开 turn 为 `completed/terminalSeq=2`，Waiting 为空。cache adapter 的 authority/range 仍由现有 Feed tests 覆盖。 | **保留并迁移**：这是用户可感知 finality，不是可放弃的实现细节；接受 Replica public snapshot successor，放弃旧 `readCache`/scheduler release 细节。建议 SZ-285 以该 successor 关闭。 |

## 当前正常/不可用体验证据

当前公开 owner 的正常与低频失败反馈保持单一来源：

- 未有 history grant 时，`loadHistory` 返回 `kind: 'waiting'`、`reason: 'history-grant-pending'`，`historyFor(channel).historyDemand.phase` 为 `pending`。
- 当前 Feed/`useHistoryConsumer` 的 error 会保留 typed history demand，并由同一 owner 的 retry 重新请求；不会创建第二个 scheduler 或将失败伪装为空频道。
- 本轮新增 `tests/sz-round54-waiting-public-decisions.test.jsx`：SZ-283 live-before-buffered-page、SZ-285 cached-terminal merge、SZ-284 terminal-first cache outcome 均只读取公开 timeline 与 `selectFeatureWaitingFacts`，没有下划线字段、私有 export 或测试专用产品分支。

## 定向验证

```text
npx vitest run tests/sz-round54-waiting-public-decisions.test.jsx tests/channel-feed-runtime.test.jsx tests/channel-feed-runtime-physical-operation.test.jsx tests/history-scheduler-modules.test.js --reporter=dot
```

结果：4 个 test files、52 个 tests passed。

本轮只新增一份公开 owner 测试与本报告；未修改产品源、vendor、package/lockfile，未删 test/skip，未恢复 `ui.*` 兼容路径。SZ-282 保留 OPEN 等待公开 history progression successor；SZ-283/284/285 的用户能力已给出迁移裁决与公开结果证据，中心账本待 root 采纳状态。
