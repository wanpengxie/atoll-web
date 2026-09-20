# SZ-280 public-owner self-review

日期：2026-09-20

基线：`d9050dfbacf918fb08e08045aaffc9a8406beb1d`

分支：`unit-s-z/round52-sz280-public-d9050df`

## 唯一 baseline 与归属

本提交只处理 `SZ-280`：`tests/waiting-closure-entry.test.jsx` 中的
`keeps a matched live terminal across trim until an older in-flight page releases`。
它不是 SZ-281 的重复：SZ-281 是 terminal-first 页面先到、再释放旧 request/queued 页；SZ-280 的合同是 live lane 先形成 request/queued/terminal matched turn，trim 后再释放旧 history 页。

当前唯一 owner 是 `createChannelReplicaStore` 的 Replica projection，用户可见 Waiting 由 `selectFeatureWaitingFacts` 投影。旧 scheduler 不在当前 owner 中重建；测试将其可观察的行到达顺序直接映射到当前公开 Replica 入口。

## 公开合同

1. live `request → queued → completed terminal` 先形成同一 turn；随后 `trim(c0, 4)` 必须实际移除物化行。
2. trim 后只通过公开 `state(channelId).timeline` 读取 UI snapshot：此时 compact lifecycle proof 尚未有可显示 turn，不能凭空生成 Waiting action；`selectFeatureWaitingFacts(...)` 必须为空。
3. 旧 history 页随后补回同一 request/queued；公开 timeline 必须恢复为 `completed` 且 `terminalClosureOnly: true` 的 turn，说明 terminal 仍是权威终态；Waiting projection 仍必须为空，不能把旧 queued 页重新显示为进行中操作。

新增 `tests/sz-round52-sz280-public-owner.test.js` 只读取这些公开 observable：

- `createChannelReplicaStore().commit/trim/state`；
- `state(channelId).timeline` 的用户投影字段；
- `selectFeatureWaitingFacts` 的公开 Waiting projection。

测试不读取 `_unmatchedTerminalClosures`、`_envelopesById` 或任何其他下划线字段，不新增 export，不构造私有 oracle。

## 定向验证

```text
npx vitest run tests/sz-round52-sz280-public-owner.test.js tests/waiting-replay-owner.test.js --reporter=dot
```

结果：2 个 test files、2 个 tests 全部通过。

本 worktree 仅新增上述直接测试与本报告；没有改产品源、Workspace/Reading/Feed/Outbox/Composer、vendor、package/lockfile，也没有删 test、删 skip、放宽断言或恢复旧 API。
