# N–R Round 32：Reading exact anchor、single-burst writer 与 NR22 收尾 baseline

检查时间：2026-09-20（Asia/Singapore）。开始检查时共享 HEAD 为 `c1cc476`，其
Reading 相关产品代码最近提交仍为 `d965b57`；本轮没有修改 `src/` 产品代码。本轮
只修改测试/审计，不导出私有 owner，不恢复旧 store/API，不删除或 skip case，也不
修改 vendor、package 或 lockfile。

## Reading exact visible anchor

将 browser 合同从上一轮的 `<=80px` 收紧到同一 row ID 的屏幕 `top` 差
`<=1px`。测试仍通过真实登录、频道切换、mounted Reading owner 观察，并同时记录：

- `firstHitTested`：按 viewport 裁剪并经 `elementFromPoint` 命中的用户可见首行；
- `exactAnchor`：同一 `data-presentation-row-id` 的真实 row，用于精确几何合同；
- `domFirst`：仅诊断，不作为阅读锚点。

定向 browser 命令：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16990 ATOLL_TEST_MOCK_PORT=18990 \
  npx playwright test tests/browser/reading-position-session.spec.js \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=test-results-round32-reading-exact-anchor-20260920
```

结果：**1/3 passed，2/3 REJECT**。两次红项完全相同：同一 exact row ID
`c0-history-request-112` 被保留，但屏幕 top 从 `-65.5` 变为 `1.5`，差值 **67px**；
旧的 `<=80px` 会错误放过该跳动。失败断言为：

```text
Expected: <= 1
Received: 67
```

失败附件中还可见：返回频道后的 `firstHitTested` 为 `c0-history-request-111`、
`domFirst` 为 `c0-history-request-84`，而 exact row 112 在 top `1.5` 处仍存在。这
证明 exact ID 与 painted 首行/屏幕几何不能混为一谈；本轮保留严格红项，不退回
`<=80`，不以 DOM row 或邻近 sliver 冒充用户 anchor。另一次通过虽 exact row top
约为 `-65.25`，但其 painted 首行诊断为 null，不能将 repeat-3 整体判为 ACCEPT。

### Reading unit

```text
npx vitest run tests/reading-session-ports.test.js \
  tests/reading-navigation-coordinator.test.js \
  tests/reading-observation-settle.test.jsx --reporter=verbose
```

结果：**3 files / 18 tests passed**。typed DOM position command、history owner tuple、
wheel/touch/key generation、scrollend/quiet fence 与 VendorListExecutor observation
authority 均通过；unit 通过不掩盖 browser exact geometry 红项。

## Single burst writer fence

沿用真实登录、频道与 mounted reading list 链，第一 wheel 到 takeover wheel 之间及
takeover 之后均禁止程序性 `scrollTo`/`scrollBy` writer：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16991 ATOLL_TEST_MOCK_PORT=18991 \
  npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='trusted wheel takeover' --repeat-each=3 --workers=1 --reporter=line \
  --output=test-results-round32-reading-writer-20260920
```

结果：**3/3 ACCEPT**；`firstWheelToTakeover=[]`、`postTakeover=[]`，list 保持
connected 且 mode 为 browsing。没有手动 `runtime.bind` 或私有 owner 注入。

## NR 下一组唯一 baseline

NR21-02 … NR21-06 已在上一轮完成。本轮总账中剩余的下一条唯一 baseline 只有
**NR22-01**（原 `roster-visibility.test.js`，当前替代 owner 为
`src/model/actor-visibility.js`）；总账没有另外四条可合法新增的 N–R unique row，
不以 expanded assertions 重复计数。

定向命令：

```text
npx vitest run src/model/actor-visibility.test.js \
  tests/n-r-public-owner-contracts.test.js --reporter=verbose
```

结果：**2 files / 7 tests passed**。NR22-01 的公开语义是隐藏 system/genesis
standard actor，同时保留 human 与 business agent；`isVisibleActor` 与 Roster/公开
projection 均通过。其余 4 个“下一条”不存在于当前 22-suite/98-row ledger，未伪造
baseline 计数。

## 结论与边界

- Reading exact anchor：**REJECT**，当前产品候选首断为同 ID 的 `67px` 屏幕跳动；
  不接受上一轮 `<=80px`。
- Reading unit：**ACCEPT 18/18**；single-burst writer：**ACCEPT 3/3**。
- NR22-01：**ACCEPT 7/7 supporting tests**；NR ledger 无额外四条 unique baseline。
- 本轮只纳入测试/审计变更；共享工作树其余 dirty/untracked 文件属于其他 agent，未
  纳入本轮提交。
