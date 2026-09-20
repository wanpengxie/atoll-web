# N–R Round 29：destroy mutation fence 与 NR19 唯一 baseline 映射

检查时间：2026-09-20（Asia/Singapore）。检查基点为 `76ab5e6`；Feed 产品候选含
`3f2d605` 的 authority/lifecycle fence。共享工作树仍有 Reading owner dirty diff，
本报告不把该 diff 归入本分区。

本轮只增加测试/审计证据，不改 `src/`、vendor、package 或 lockfile，不恢复私有
owner/store/API，也不删除或 skip case。

## Feed destroy fence

公开测试入口是 `createChannelFeedRuntime()` 返回的 snapshot/owner snapshot；没有访问
内部 Map 或手动注入 runtime。命令：

```text
npx vitest run tests/channel-feed-runtime.test.jsx --reporter=verbose
```

结果：**25/25 passed**。

| mutation/lifecycle | strict observation | result |
|---|---|---|
| old snapshot `enqueue` | same pre-destroy generation 的 live frame 返回 false，Replica 不出现 row | ACCEPT |
| old snapshot `loadHistory` | 返回 `{ kind: 'cancelled', reason: 'runtime-destroyed' }`，wire request 数为 0 | ACCEPT |
| old snapshot `setHistoryGrants` | 返回 `stale: true`，不安装 grant/meta、不发 request | ACCEPT |
| old snapshot page/checkpoint/owner command | `pageEnd`、`liveCheckpoint`、owner enqueue/checkpoint 均 fail closed | ACCEPT |
| remaining snapshot commands | clear/read/notification/activity/background-interest/refresh/prepare 等 destroy 后均不重新取得 authority | ACCEPT |
| fresh runtime | 旧 runtime destroy 后，新 runtime 以自己的 grant/head 发出一次 demand；空页 exhausted，旧 Replica 保持空 | ACCEPT |

严格 fence 的聚合测试在
[tests/channel-feed-runtime.test.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/channel-feed-runtime.test.jsx)
的 `fails closed for every public mutation after destroy`；逐项 destroy/load/grant 与
fresh-runtime 复验也保留在同一公开 owner suite。既有 disconnect/regrant、world
replacement、clear/destroy late grant 测试仍全部通过。

## Reading 公开链复验

Reading owner 当前 dirty 候选下，原迁移 spec 的 repeat-3 命令：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=15185 ATOLL_TEST_MOCK_PORT=18844 \
  npx playwright test tests/browser/history-presentation-admission-prototype.spec.js \
  --grep='one older gesture' --repeat-each=3 --reporter=line
```

该 spec 三次在诊断辅助断言 `history-presentation-admission-prototype.spec.js:144`
首断（`admission_begin` 为 0），因此其行为证据裁决为 **REJECT/diagnostic
fixture boundary**，不能用它宣称 case1 全链 green。

为避免把 `118035d` 对 case3 的 assertion 重排当作修复证据，另以临时公开入口 spec
直接驱动真实登录、频道、wheel 和 mounted list（临时文件已删除）repeat-3：

- case1 精确可见 anchor：**ACCEPT**。三次 baseline offset 均为 `-394`，同一真实
  active list 中旧 anchor offset 均为 `-393.625`（误差 `0.375px`），`count=6`、
  `visibleRows=3`、`activeLists=1`。
- case3 post-wheel writer：**ACCEPT**。三次均 `mode=browsing`，第二次 wheel 边界
  后 `postTakeover=[]`；没有 `scrollTo/scrollBy` writer。该断言独立于现有
  `118035d` test wording。

## NR19 唯一 baseline 映射

旧 baseline 的唯一 suite 是
`tests/right-panel-file-reference.test.jsx`，原始语义为三条 legacy rows：

| 唯一 baseline row | 当前公开 owner 展开 case | 当前结果 |
|---|---|---|
| NR19-A：绝对路径文件引用在 Atoll 内打开并保留普通外链 | 1. 当前频道 preview command；2. 缺 command fail closed；3. 切频道旧 artifact 不借新 command；4. 普通外链 `_blank` 且不拦截 | 4/4 ACCEPT |
| NR19-B：嵌套 preview 的返回/关闭语义 | 5. 有上一层时返回与关闭都 pop；6. 无上一层时关闭调用 `onClose` | 2/2 ACCEPT |
| NR19-C：最近阅读可重新打开 | 7. recent entry 通过公开 preview command 重开 | 1/1 ACCEPT |

因此总账仍应计 **NR19 = 1 suite / 3 unique baseline rows**，同时记录当前
公开 owner 的 **7/7 expanded assertions**，而不是把扩展边界重复计成七个 baseline
case。定向命令及结果：

```text
npx vitest run tests/right-panel-file-reference.test.jsx --reporter=verbose
```

结果：**7/7 passed**。七条均从 `WorkspaceRightPanel`、`ArtifactPreviewPanel`、
`FilesFeature` 公开端口观察；没有 `RightPanelHost` 或旧 provider 私有耦合。

