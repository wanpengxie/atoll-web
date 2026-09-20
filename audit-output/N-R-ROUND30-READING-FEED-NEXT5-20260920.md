# N–R Round 30：Reading 输入边界、Feed teardown fence 与下一组五条 baseline

检查时间：2026-09-20（Asia/Singapore）。共享检查点为 `978f206`，其中包含
Reading wheel-burst 修复 `d965b57` 和 settlement owner 测试调整；Feed teardown/fence
候选为 `3f2d605`。本轮只修改测试/审计证据，不改 `src/`、vendor、package 或
lockfile，不导出私有 owner，不恢复旧 store/API，不删除或 skip case。

## Reading：unit 输入边界

定向命令：

```text
npx vitest run tests/reading-navigation-coordinator.test.js \
  tests/reading-observation-settle.test.jsx --reporter=verbose
```

结果：**2 files / 14 tests passed**。

`reading-navigation-coordinator.test.js` 的 10 条公开 coordinator 合同逐条通过：

| 输入/边界 | 公开结果 | 状态 |
|---|---|---|
| wheel burst | 同一 generation，native `scrollend` 或 bounded quiet 完成 | ACCEPT |
| wheel 后续 burst | quiet 后新 generation，不复用旧事务 | ACCEPT |
| touch momentum | contact/end 后保持同一 generation，`scrollend`/quiet 完成 | ACCEPT |
| touch cancel | 不支持 scrollend 时 quiet 收敛；零位移取消显式结束 | ACCEPT |
| key repeat/split | 同键 repeat 保持事务，不同导航键 supersede | ACCEPT |
| direction reversal | 更新方向但不另造 generation | ACCEPT |
| activation/host fence | activation replacement 与 host replacement 均拒绝迟到事件 | ACCEPT |
| pointer quiet | pointer transaction 在可取消 quiet deadline 完成 | ACCEPT |

`reading-observation-settle.test.jsx` 的 4 条真实 `VendorListExecutor` → ReadingSession
公开链也通过：wheel + scrollend 保持 user authority；selection/layout/epoch-stale
settlement 均不取得 following。

## Reading：browser 精确几何与 writer

### Canonical older gesture / anchor

首次按原 spec 执行时，用户可见断言已经通过，但旧诊断名称
`history.admission_begin` 恒为 0；当前 owner 实际发布的是
`history.intent_started → history.admission_commit → history.intent_satisfied`。
这只是迁移后的诊断词汇/时序，不是产品行为缺口。已将 canonical spec 的辅助诊断
观察改为当前名称，保留严格用户几何断言，未改产品。

定向命令（修正后的 spec，repeat 3）：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16982 ATOLL_TEST_MOCK_PORT=18982 \
  npx playwright test tests/browser/history-presentation-admission-prototype.spec.js \
  --grep='one older gesture' --repeat-each=3 --workers=1 --reporter=line \
  --output=test-results-round30-case1-fixed-20260920
```

结果：**3/3 passed**。三次均保留一个 active list、可见 rows、原 anchor，baseline
offset `-394` 与 settled offset `-393.625`（`0.375px` 漂移，`toBeCloseTo(..., 0)`
严格通过），并且 list count 增长。用户几何断言先于诊断 witness 执行。

### Trusted wheel takeover writer

定向命令（真实登录、频道、mounted list、wheel，repeat 3）：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16983 ATOLL_TEST_MOCK_PORT=18983 \
  npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='trusted wheel takeover' --repeat-each=3 --workers=1 --reporter=line \
  --output=test-results-round30-case3-independent-20260920
```

结果：**3/3 passed**。三次均保持 list connected、`mode=browsing`，第二次 trusted
wheel 边界后的 `postTakeover` writer 集合为空；未通过手动 `runtime.bind` 或私有
owner 注入冒充证据。

## Feed：3f2 teardown/mutation fence

定向命令：

```text
npx vitest run tests/channel-feed-runtime.test.jsx --reporter=verbose
```

结果：**25/25 passed**。公开 `createChannelFeedRuntime()` snapshot/owner snapshot
观察到：disconnect/regrant、world replacement、clear/destroy late grant 均不复活
退休 demand；destroy 后旧 snapshot 的 `enqueue`、`pageEnd`、`liveCheckpoint`、
`loadHistory`、`setHistoryGrants` 及 owner/activity/notification/refresh commands 均
fail closed；正常新 runtime 能以独立 generation/head 发起新 demand。

## 下一五条唯一 baseline：NR20-01 … NR21-01

本轮将总账中的下一组五条唯一 baseline 映射到当前公开 channel-roster owner。定向命令：

```text
npx vitest run tests/roster-self-from-attach.test.js tests/roster.test.js \
  src/model/actor-visibility.test.js --reporter=verbose
```

结果：**3 files / 18 tests passed**。五条唯一 baseline 的处置如下：

| 唯一 baseline | 当前公开入口/可观察语义 | 本轮状态 |
|---|---|---|
| NR20-01 | `useChannelRoster` stable port 的 seed/noteSelf/self；attach 后可立即读 identity | ACCEPT；不导入旧 session roster |
| NR20-02 | 重复 attach/seed 保持同一 stable port 与公开 projection；旧 return-value 细节不升级为产品契约 | ACCEPT/current projection；旧 return check ORACLE |
| NR20-03 | 缺 channel/actor 时不写 self，空 identity 优先 | ACCEPT/current；无私有 helper |
| NR20-04 | `clearChannel` 清除 rows、authority、self，退休成员不复活 | ACCEPT |
| NR21-01 | OBS 前可显示 seed cache 与公开 rows/self projection | ACCEPT；authority 仍未伪造为 network complete |

`src/model/actor-visibility.test.js` 另外确认标准 actor 隐藏而 human/business agent
保留；它不改变五条 roster baseline 的计数。

## 边界与首断点

- canonical case1 的原始红项仅为旧 `admission_begin=0` 诊断词汇；用户几何在原始
  run 已通过，修正观察名称后 3/3 通过；不报告为产品红。
- Reading unit、browser anchor/writer、Feed teardown/fence 与五条 roster baseline
  当前均 ACCEPT/COVERED，无新的产品首断点。
- 本轮未改任何产品文件；共享工作树中其他 agent 的 dirty 文件未纳入提交。
