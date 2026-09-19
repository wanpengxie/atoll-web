# E–H round 15 — G1/G2 governance closure

基线 ledger：`audit-output/E-H-BASELINE-CURRENT-OWNER-CASE-LEDGER.md`。本轮选择两个互不冲突的治理 case（EH03-01 / EH03-02）做严格闭合；没有修改 `src/`、vendor、package、lockfile 或其他 owner 的测试。

## 结论

**EH03-01 ACCEPT；EH03-02 ACCEPT。** 两条此前登记为 REGRESSION 的 case 在当前 HEAD 的公开 `ChannelAdministrationPanel` owner 下通过真实 DOM 行为证明。测试 fixture 故意保留 system、registrar、svcactor roster 以及 genesis `svcactor` declaration；过滤发生在现有 `actor-visibility.js` / `GovernanceFeature.jsx` owner，不是 fixture 预清洗。

当前修复 owner 是既有公开治理 owner（`b57f72e`），本轮只做验证和逐 case 审计，不重新实现或创建治理 owner。

## 定向证据

```text
npx vitest run \
  tests/f5-management.test.jsx \
  tests/management-actors.test.js \
  src/model/actor-visibility.test.js \
  tests/workspace-governance-features.test.jsx \
  --reporter=verbose

Test Files  4 passed (4)
Tests       11 passed (11)
```

同一 run 保留普通业务 Root、普通 Agent、普通 `demo:agent` declaration，证明不是把整个候选集合清空。`tests/f5-management.test.jsx` 的两条 UI case 直接输入 raw roster/declarations，再切换公开“成员” tab 查询可见结果。

## Owner and semantic bridge

| case | 旧行为 / 用户能力 | 不变量 | 当前公开 owner 与证据 | 结果 / 处置 |
|---|---|---|---|---|
| EH03-01 | 旧 `ChannelGovernance` 的“成员” surface 默认不显示标准 system/registrar/svcactor；用户只能看到可管理业务成员并对其执行详情/移除。当前 setup 直接渲染 `ChannelAdministrationPanel`，切换公开“成员” tab。 | 标准 actor identity 不能泄漏为业务成员；按 `id` 或 declaration id 命中标准身份；普通 human/业务 agent 保留。 | `ChannelAdministrationPanel` → `ChannelMembers` → `isVisibleActor`（`src/model/actor-visibility.js`）。raw fixture 包含 `root`, `system`, `registrar(decl_id=registrar)`, `svcactor(decl_id=svcactor)`；断言 Root 存在且三种标准身份均不在 DOM。 | **PASS / CLOSED.** 既有产品修复 `b57f72e` 已把 predicate 接到当前 owner；无 fixture 预过滤、无旧 API 恢复。 |
| EH03-02 | 旧添加成员流程先让用户从合法参与者/声明中选择，再按对象类型配置；genesis/system declaration（如 svcactor）不能作为业务成员候选。当前 setup 打开公开“待引入成员” combobox。 | genesis `atoll-internal:`/`peer:`/标准 declaration 不得进入可管理候选；普通 `demo:agent` 必须保留，避免通过清空候选取得假绿。 | `ChannelMembers` → `isManageableDeclaration`（`src/model/actor-visibility.js`）。raw declarations 同时含 `{id:'demo:agent'}` 与 `{id:'svcactor'}`；打开 SelectMenu 后断言 svcactor option 缺失，predicate 单测同时证明普通 declaration 可管理。 | **PASS / CLOSED.** 当前公开治理 owner 已按同一身份策略过滤候选；无 fixture 预过滤、无跨 owner 投影。 |

## Remaining E–H rows observed, not closed here

本轮没有把其他 owner 的红项改成绿：

- EH08-12 cache-redaction 仍在 `tests/channel-replica-cache-redaction.test.js` 真实失败：IndexedDB 原始 row 仍含 device key/token；交 cache/Replica 产品 owner。
- EH09-08 / EH09-09 / EH09-14 仍由 `tests/file-browser.test.jsx` 的同一 FilesFeature/attachment owner expected-red 记录；本轮不改 fixture 或产品，保留原始语义与首断点。

因此本轮只把 REGRESSION 计数从 3 降为 1（EH08-12），FIXTURE-BLOCKED 仍为 3；EH03-03 的 owner-mapped reconnect retention 也未被本轮误报为闭合。
