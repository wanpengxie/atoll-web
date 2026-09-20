# N–R Round 31：用户可见 Reading anchor、single-burst writer 与 NR21 下一组 baseline

检查时间：2026-09-20（Asia/Singapore）。当前共享检查点为 `6b51c7d`；Reading 产品
最近相关提交仍为 `d965b57`，本轮未看到其后的 Reading 产品候选。本轮只增加
`tests/` 与 `audit-output/` 证据，不修改 `src/`、vendor、package 或 lockfile，不导出
私有 owner，不恢复旧 store/API，不删除或 skip case。

## Reading：严格用户可见 anchor

`tests/browser/reading-position-session.spec.js` 的 `viewportState` 现在同时保留
`domFirst` 与 `userAnchor/firstVisible`：后者先按 viewport 裁剪，再用
`document.elementFromPoint` 对每个 row 的多个 painted 点做命中检查，并按屏幕 `top`
排序。故 Virtuoso overscan 中的第一个 DOM row 不会被当作用户阅读锚点。切频道回来
后断言的是 hit-tested `afterSwitch.firstVisible.id` 与切换前用户锚点相同，并保留
`reading-user-anchor-position.json` attachment；没有用 DOM first row 或内部 owner/store
替代用户合同。

定向命令：

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16987 ATOLL_TEST_MOCK_PORT=18987 \
  npx playwright test tests/browser/reading-position-session.spec.js \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=test-results-round31-reading-position-strict-rerun-20260920
```

结果：**3/3 REJECT，稳定同一产品首断**：

```text
Expected: c0-history-request-112
Received: c0-history-request-111
```

三次 attachment 的几何证据一致：

| 阶段 | DOM first（仅诊断） | hit-tested user anchor（合同） |
|---|---|---|
| wheel 前 | `c0-history-request-104`, top `-1811` | `c0-history-request-112`, top `-65.5` |
| 返回频道后 | `c0-history-request-84`, top `-1039.1875` | `c0-history-request-111`, top `-216.6875` |

这既证明测试没有把 DOM first row 当作阅读 anchor，也证明当前产品在公开频道切换链
中把 painted 用户首行从 112 恢复成 111。该红项保留为产品缺口，等待 Reading 产品
候选后再按同一严格断言复验；本轮不以 retained DOM row 或 offset 放宽来追绿。

相关单元公开合同复验：

```text
npx vitest run tests/reading-navigation-coordinator.test.js \
  tests/reading-observation-settle.test.jsx --reporter=verbose
```

结果：**2 files / 14 tests passed**。wheel/touch/key generation、scrollend/quiet
settlement、host/epoch fence 与 VendorListExecutor observation authority 均通过；这
不掩盖上面的 browser 用户几何红项。

## Single burst：firstWheel → takeover writer fence

在现有真实登录、频道与 mounted reading list browser 链上，测试保留每个 writer phase
并新增严格区间断言：同一个物理 burst 从第一个 trusted wheel 开始，到用户 takeover
wheel 之前，`firstWheelToTakeover` 必须为空；takeover 后的 `postTakeover` 也必须为空。
未手动 `runtime.bind`，未注入私有 owner。

```text
CHOKIDAR_USEPOLLING=1 ATOLL_TEST_WEB_PORT=16988 ATOLL_TEST_MOCK_PORT=18988 \
  npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='trusted wheel takeover' --repeat-each=3 --workers=1 --reporter=line \
  --output=test-results-round31-reading-writer-strict-rerun-20260920
```

结果：**3/3 ACCEPT**。三次均保持 `mode=browsing`、list connected，且
`firstWheelToTakeover=[]`、`postTakeover=[]`。

## 下一组五条唯一 baseline：NR21-02 … NR21-06

```text
npx vitest run tests/roster.test.js --reporter=verbose
```

结果：**1 file / 14 tests passed**。逐条映射如下；NR21-03/04 的旧私有 session/feed
getter 仍按总账标为 ORACLE/current，不以私有 helper 冒充当前产品合同。

| 唯一 baseline | 当前公开 owner 证据 | 状态 |
|---|---|---|
| NR21-02 | 完整 Actor OBS 才发布当前 principal/channel/generation 的 authoritative roster | ACCEPT/current |
| NR21-03 | 缺 principal 时不把 roster row 标为当前 human；公开 projection 行为通过，旧直接 session getter 仍不可迁移 | ORACLE/current |
| NR21-04 | submission receipt → feed sender 的旧 self-learning/persistence 依赖已删除 private store；不恢复旧 API | ORACLE/current |
| NR21-05 | 通过公开 `handleEnvelope` 观察治理 completed terminal，触发一次公开 roster refresh 并更新 rows/authority | ACCEPT/covered current |
| NR21-06 | narration/member completed terminal 在 300ms debounce 内合并为一次 OBS，得到新成员 projection | ACCEPT/covered current |

## 结论与边界

- Reading strict user-anchor：**REJECT**，首断为 `112 → 111`，是当前产品候选缺口。
- single-burst writer：**ACCEPT**，3/3；Reading unit：**ACCEPT**，14/14。
- NR21-02/05/06 公开 owner 合同通过；NR21-03/04 保持 ORACLE/current，未恢复私有
  owner/store/API。
- 本轮只触及测试与此审计文件；共享工作树中其他 agent 的产品或未跟踪文件未纳入。
