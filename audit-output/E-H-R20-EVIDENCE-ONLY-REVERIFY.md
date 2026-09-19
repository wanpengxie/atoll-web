# E–H round 20 — conservative evidence-only re-verification

审计快照：当前 HEAD `4d87546`。本轮只复核 E–H 的七条指定 baseline case 和
quota 当前契约；没有修改 `src/`、`vendor/`、`package.json` 或 lockfile，也没有
删除、skip、放宽行为断言。共享工作树仍有其他 owner 的未提交变更；本报告把
它们当作待审产品/测试状态，不冒充本轮改动。

## 裁决

| case | 旧动作与 observable | 当前公开 owner 与逐条证据 | R20 裁决 |
|---|---|---|---|
| EH03-01 | 渲染 `ChannelGovernance` 后不做 tab 操作；`成员` tab 的 `aria-selected` 必须是 `true`，Root 可见，system/registrar/svcactor 不可见。 | `ChannelAdministrationPanel` → `SidePanel`/`ChannelMembers` → `isVisibleActor`。当前 `tests/f5-management.test.jsx -t 'Channel Context 默认成员优先并隐藏标准 Actor'` 原始 roster 保留四行，点“成员”后 Root 可见、三种标准 actor 均不可见，focused 1/1；`management-actors` 还证明 ordinary agent 保留。可是 `ChannelAdministrationPanel` 的初始 `tab` 明确为 `overview`，focused case 必须先点击“成员”，没有证明 baseline 的默认 `aria-selected=true`。 | **OWNER-MAPPED / strict evidence blocked**。过滤不变量已通过，但 baseline 默认入口 observable 未恢复；没有 root 的显式产品决策，不能称 obsolete，也不能称严格 PASS。当前没有足够证据下产品回归结论；首边界是现有 `ChannelAdministrationPanel` 的初始 tab。 |
| EH03-02 | 渲染旧 governance fixture，打开名为“选择参与者”的选择器；genesis `svcactor` 不得成为 option；选择普通 `Analyst · Agent` 后显示 `demo:agent`，并出现“归属 principal 由声明本身决定”。 | 当前 owner 仍是 `ChannelAdministrationPanel` → `ChannelMembers` → `isManageableDeclaration`。当前 focused test 保留普通 `demo:agent` 与 genesis `svcactor`，点“成员”并打开“待引入成员”，证明 svcactor 不在 option（1/1）；`management-actors`/predicate 也证明 ordinary agent 与合法声明保留。但当前 test 没有选择普通候选、没有检查引入 action 的 payload/按钮状态，也没有恢复 `demo:agent` 和 principal 配置提示的 observable；当前 UI 的 label 也从旧的“Analyst · Agent”变为“Analyst · 声明”。 | **OWNER-MAPPED / strict evidence blocked**。genesis 过滤 invariant 通过，完整 baseline participant-selection/configuration action/result 尚未逐条证明。当前 owner 已知但不能把过滤子断言合并成旧 case 完成；首边界是 `ChannelMembers` 的当前 candidate/action surface。 |
| EH03-03 | 旧 case 分别点击 Activity row 与 Global Search result；两次 callback 都必须收到 exact canonical `SourceRef`。 | Activity owner 为 `WorkspaceApp.activityPort` → `ActivityFeature`/`WorkspaceRightPanel`，Search owner 为 `SearchFeature`/`feature-search`。`tests/f5-management.test.jsx` Search action 的 callback exact source 通过；`tests/activity-center-accessibility.test.jsx` row callback exact source 通过，unavailable operations 不显示伪造 row/返回来源；真实 browser `workspace-activity-center.spec.js` 的 live Feed → Activity → source 与 channel handoff/drop unavailable 各通过。两条原动作分开复现，未用 suite 绿数替代 case。 | **ACCEPT / PROVEN-MERGED**。两个旧 observable 均有独立 public-owner evidence；Activity 与 Search 的拆分是 owner bridge，不是删除旧能力。 |
| EH08-12 | 直接调用旧 `redactFeedSecrets`：device key 与 nested credential 不能原样进入 IndexedDB 语义；脱敏值必须保留。 | 当前 owner 为 `createChannelReplicaCache` 的 IndexedDB persistence boundary。`tests/channel-replica-cache-redaction.test.js` 直接读 `atoll-channel-replica-v1` 原始 `rows`：写入 raw secret 不存在且 `已隐藏` 存在；重新创建 cache 后业务字段/脱敏值仍在；预置旧未脱敏 row 后重载 read 返回脱敏值且同一 rows store 被回写 canonical row（focused 3/3）。同文件全套目前 10/10。 | **ACCEPT / PROVEN-MERGED**。旧 pure helper 已桥接到真实 durable boundary；证据来自 raw IndexedDB，不是 renderer masking 或聚合数量。 |
| EH09-08 | 在 `c0/docs/` 删除 `inside.txt`，延迟 mutation receipt；用户先回 root；释放 receipt 后旧完成不得覆盖新 directory。 | `FilesFeature` row/delete → `useAttachmentTransactions.removeFile`。focused test 真实打开 `c0/docs`、点击删除、回 root、释放 receipt，root 仍有 `docs` 且不回落 `inside.txt`（1/1）。 | **ACCEPT / PROVEN-DIRECT**。原始竞态动作与 observable 保留。 |
| EH09-09 | 先在 `c0/docs/`，切换 active channel 到 `c1`；结果必须是 `c1` root/fresh.txt，不得带旧 directory/device 闭包。 | 同一 Files/attachment owner；focused test rerender active channel，目标 root 显示 `fresh.txt`、不显示旧 path（1/1）。 | **ACCEPT / PROVEN-DIRECT**。原始 channel-reset 动作与 observable 保留。 |
| EH09-14 | 点击真实 file row 的附加；durable persistence 拒绝；composer projection 必须仍为空，同时 Files surface 显示可见拒绝错误。 | `FilesFeature` attach → `useAttachmentTransactions.attach` → `persistDraftAttachments`。两个 focused case 分别证明拒绝时 persistence 被调用且 composer projection 为空、`role=alert` 显示拒绝原因（2/2）。 | **ACCEPT / PROVEN-DIRECT**。rejection、空 projection、用户可见错误均保留，未用 disabled/静默替代。 |

因此七条不是“7 条均绿”：严格通过为 EH03-03、EH08-12、EH09-08、EH09-09、EH09-14，共 **5/7**；EH03-01/02 是 **2 条 OWNER-MAPPED strict evidence gaps**。这不是产品红项声明：只有 EH03-01/02 的 baseline observable 尚未在当前公开 surface 中被证明，尚不足以把差异归因成产品回归。旧 case 不删除、不 skip、不声明 obsolete；需要 root 对默认 tab / add-flow explanatory observable 作明确决定，或补回当前公开 owner 的等价逐动作证据后再收敛。

## quota 当前契约复核

quota 的公开 owner 是 `createChannelReplicaCache`（`src/model/channel-replica.js`），持久化仍只有同一
`atoll-channel-replica-v1` 的 `rows` 与 `meta` 两个 store。当前契约和证据如下：

1. 写入边界先 `redactSensitive`；raw IndexedDB 不得保留一次性 device key 或 nested token。
2. 首次 `QuotaExceededError` 后，失败事务先回滚；owner/channel 的旧 rows 以同一 `rows`+`meta` durable transaction 原子清除/重建，保留可用 tail（当前最小 bound 为 8），Meta 的 coverage 只描述实际 surviving rows，不把已丢弃区间伪装成可恢复区间。
3. 启动时 physical rows 是 durable source of truth：旧 Meta 按实际 rows reconcile，orphan Meta 删除，survivors 再脱敏；已有 quota bound 在重载后继续生效。
4. 已进入 quota-bounded 的 channel 后续写入仍走同一 atomic replacement；并发 `saveRows` 经 Replica 内部 operation queue 串行，不能因旧 Meta race 丢后来的 row。`clear` 也只在 durable transaction 成功后发布空 Meta；失败保持旧 rows/Meta。
5. 第二次 quota retry 若仍失败，不伪造成功：旧 window 保持，公开错误为 `code: 'cache_unavailable'`、`本地缓存不可用，已转网络重取`；该失败只影响当前 channel，其他 channel rows/Meta 保留。
6. 证据不是只看 quota 单测：`npx vitest run tests/channel-replica-cache-redaction.test.js --reporter=verbose` 为 **10 passed**；包括 raw redaction、reload、旧 row migration、首/二次 quota、startup reconcile、re-redaction、并发 append、clear rollback、failed write rollback。真实浏览器 `tests/browser/f7-history-cache.spec.js` 为 **1 passed**，在真实 IndexedDB 中注入一次 `QuotaExceededError`，重载后得到 `[8,9,10,11,12,13,14,15]` 且 token 为 `已隐藏`。

这符合当前 Replica single-owner/single-cache 契约；没有 `globalMeta`、第二 cache、renderer-only masking、旧 `feed-cache` compatibility API 或第二 owner。EH08-05 旧的“两阶段 trim/retry”仍只作为 baseline 行为记录，不能反过来要求当前实现恢复已删除的旧 owner；但上述 durable window、coverage、rollback、network-refetch observables 均已由当前公开 owner 单独验证。

## 定向命令

```text
npx vitest run tests/f5-management.test.jsx -t 'Channel Context 默认成员优先并隐藏标准 Actor|添加流程的候选人不包含 genesis 铸出的系统声明|全局搜索返回规范 SourceRef 并可用其打开结果' --reporter=verbose
Test Files 1 passed; Tests 3 passed

npx vitest run tests/activity-center-accessibility.test.jsx -t 'returns an activity row to its canonical source callback|states operation facts are unavailable and exposes no fabricated operation row' --reporter=verbose
Test Files 1 passed; Tests 2 passed (2 skipped)

npx vitest run tests/management-actors.test.js -t 'keeps the channel system actor and genesis declarations out of business roster rows|recognizes standard identity by id or declaration without hiding ordinary agents' --reporter=verbose
Test Files 1 passed; Tests 2 passed (2 skipped)

npx vitest run tests/channel-replica-cache-redaction.test.js -t '一次性设备密钥和嵌套 token 不应该原样写进 IndexedDB|写入后重新创建 cache 仍保留业务字段且只返回脱敏值|旧的未脱敏 IndexedDB row 在重载时被归一化并回写 canonical rows store' --reporter=verbose
Test Files 1 passed; Tests 3 passed (7 skipped)

npx vitest run tests/channel-replica-cache-redaction.test.js --reporter=verbose
Test Files 1 passed; Tests 10 passed

npx vitest run tests/file-browser.test.jsx -t 'does not let a completed mutation refresh overwrite a newer directory|returns to the root when the active channel changes|keeps a rejected durable attachment out of the composer projection|surfaces an attach rejection as a visible file error' --reporter=verbose
Test Files 1 passed; Tests 4 passed (11 skipped)

ATOLL_TEST_WEB_PORT=16377 ATOLL_TEST_MOCK_PORT=19836 npx playwright test tests/browser/f7-history-cache.spec.js --reporter=list --workers=1
1 passed

ATOLL_TEST_WEB_PORT=16375 ATOLL_TEST_MOCK_PORT=19834 npx playwright test tests/browser/workspace-activity-center.spec.js --reporter=list --workers=1
2 passed
```

本轮没有产品 diff；报告只保留证据与未闭合 case，供 root 决定下一步，不以合并测试数量替代七条 case 的原动作/observable。
