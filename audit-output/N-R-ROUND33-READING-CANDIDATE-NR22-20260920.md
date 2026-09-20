# N–R Round 33：Reading exact-anchor candidate 验收与 N–R ledger 收尾

检查时间：2026-09-20（Asia/Singapore）。共享 HEAD 为 `445a9b4`；检查时 Reading
产品候选仍是共享 dirty 的 `src/ui/timeline/reading-geometry.js`，其
`topVisibleBookmark` 会排除 viewport 内一像素 virtualizer sliver，并在可用时要求
命中该 row 的 painted point。本轮只修改 `tests/` 与 `audit-output/`，没有 stage 或
修改该产品 dirty，也没有导出私有 owner、恢复旧 store/API、删除或 skip case。

## Reading exact anchor：repeat 5

browser 合同保持同一 `data-presentation-row-id`，屏幕 `top` 差必须 `<=1px`；不接受
`<=80px`，也不通过额外 `scrollTo`/`scrollBy` writer 补偿。测试真实走登录、频道切换
与 mounted Reading owner，`domFirst` 只作诊断，`firstHitTested` 与 `exactAnchor` 走
painted row 证据。

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16992 ATOLL_TEST_MOCK_PORT=18992 \
  npx playwright test tests/browser/reading-position-session.spec.js \
  --repeat-each=5 --workers=1 --reporter=line \
  --output=test-results-round33-reading-exact-anchor-20260920
```

结果：**5/5 ACCEPT**。五次均满足 exact row ID 与 `top<=1px` 合同；没有改阈值、
补偿 writer 或手工 runtime 注入。当前候选与 Round32 的 `67px` 红项相比已达到严格
验收条件。

## Reading unit / public geometry owner

新增的 `tests/reading-geometry.test.js` 只通过公开
`topVisibleBookmark` 验证：一像素 sliver 不得成为 anchor，命中 row 的 offset、seq、
predecessor/successor 必须精确返回。定向合并命令：

```text
npx vitest run tests/reading-geometry.test.js \
  tests/reading-session-ports.test.js \
  tests/reading-navigation-coordinator.test.js \
  tests/reading-observation-settle.test.jsx --reporter=verbose
```

结果：**4 files / 19 tests passed**。typed DOM command、exact history owner tuple、
wheel/touch/key generation、scrollend/quiet settlement、VendorListExecutor observation
authority 与 sliver/hit-test geometry 均通过。

## Single burst writer fence

继续以真实登录、频道和 mounted list 验收第一 wheel → takeover 以及 takeover 后的
writer fence：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16993 ATOLL_TEST_MOCK_PORT=18993 \
  npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='trusted wheel takeover' --repeat-each=5 --workers=1 --reporter=line \
  --output=test-results-round33-reading-writer-20260920
```

结果：**5/5 ACCEPT**；`firstWheelToTakeover=[]` 与 `postTakeover=[]`，没有用 writer
补偿 exact-anchor 几何，也没有 private owner/runtime.bind 注入。

## N–R 下一组 unique baseline

Round32 已验证总账最后一条 **NR22-01**（actor visibility）及其 supporting public
owner tests；本轮复跑：

```text
npx vitest run src/model/actor-visibility.test.js \
  tests/n-r-public-owner-contracts.test.js --reporter=verbose
```

结果：**2 files / 7 tests passed**。NR22-01 的公开语义（隐藏 system/genesis
standard actor，保留 human/business agent）通过。完整 N–R ledger 已覆盖 22 suites /
98 expanded rows；NR22-01 之后不存在另外五条未计的 unique baseline，本轮不重复计数
expanded assertions，也不虚构新的 N–R row。

## 结论与边界

- Reading exact-anchor candidate：**ACCEPT 5/5**，同 ID 屏幕 top 差 `<=1px`。
- Reading unit/public geometry：**ACCEPT 19/19**。
- Single-burst writer fence：**ACCEPT 5/5**，无补偿 writer。
- NR22-01：**ACCEPT 7/7 supporting tests**；无额外下一组五条 unique baseline。
- 本轮只纳入 `tests/` 与本审计；`src/ui/timeline/reading-geometry.js` 等共享 dirty
  产品文件未纳入提交。
