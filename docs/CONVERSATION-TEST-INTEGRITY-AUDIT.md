# Conversation P0 测试真实性审计

更新时间：2026-09-17 20:13 +08:00。初始审计参照提交为
`193f189cd3ae63cf3deb9e54d71d7bbeb9fd304c`，但工作树包含多人并行未提交改动，**不存在当前冻结源码**。
因此本文把结果分为当前源码实跑、已持久化的历史/定向证据、owner 报告三类；后两类均不能替代同一冻结源码上的完整复跑。

## 0. 结论

今天的 P0 **不能整体签绿**。

- P0-4 有真实生产路径硬失败：Legend 3.3.11 下，append 后真实向上 wheel 已把 ReadingSession
  切到 browsing，但随后 28 帧仍被维持在 gap=0。该轨迹在真实 Chromium、真实生产列表组件中失败，
  且 artifact 在断言前落盘；不是 mock 假红。列表负责人复跑同一 oracle 为 0/3。root 随后已否决
  Legend production admission；所以它现在是“候选被硬门挡下”的有效证据，不是最终回退路径的验收结果。
- P0-2 现有精确 production browser gate：一个 boundary demand 跨至少两个 filtered physical pages，
  status DOM token/revision/MessageList identity 保持，内容不清空且几何 `<=1px`；定向 1/1 通过并先落 artifact。
- P0-1 首轮两个失败是 fixture 文案 `project-agent`/`steward` 不一致造成的 false red；精确修正文案后，
  当前 Virtuoso production browser 3/3 通过。cached 轨迹有当前耐久 attachment；另外两条完整输出可能被
  后续 Playwright run 清理，故结果可签定向通过，证据归档仍需补齐。
- P0-3 在回退后的 Virtuoso production browser 上也有真实失败：默认折叠→显式展开→再折叠后，
  被点击的行移动并被回收，折叠 toggle 在 10 秒窗口内没有重新出现。该失败已用独立端口/output 持久化。
- P0-5、6、7、8 都已有有价值的局部或真实浏览器证据，但当前不存在同一冻结源码的完整
  unit/browser/build 验收。P0-5 的选定 seed/单样本是已拒绝的 Legend 候选证据，不能签当前 Virtuoso；
  P0-7 的 A06 在 generation provenance 修复后已有 production Chromium active→settled→ack 1/1；
  P0-8 的 A09 三条 production Chromium 当前均通过，但两项仍只是具名定向轨迹。
- 测试基础设施污染已清理：shared setup 不再 mock production Virtuoso 或伪造 timeline 固定几何；
  失效旧路径已局部化到当前 adapter 的纯语义 helper；evidence specs 已排除。静态合同 4/4、完整
  Vitest 843/843 通过。该 unit 全绿不覆盖下述真实浏览器失败。

## 1. 本次证据冻结与命令

### 1.1 当前工作树实跑

20:12 完整性施工完成后的同次全量结果：

```text
npx vitest run --reporter=json --outputFile=/tmp/atoll-vitest-integrity-final2.json
289/289 suites passed
843/843 tests passed
0 failed；exit 0
```

施工前暴露的旧路径、全局 geometry/mock、evidence 误收集均已清零。首次施工后全量仅
`f6-composer-isolation` 两项在并行负载下撞 20 秒 harness timeout；该文件定向 5/5，5,000 行 +
真实 ProseMirror 输入单跑约 12.3 秒。只将测试时限增至 40 秒，未改文本、render 次数或发送计数 oracle；
随后完整套全绿。

证据完整性合同：

```text
npx vitest run tests/test-integrity-contract.test.js
1 file passed；4 passed / 0 failed
```

四项分别锁住：shared setup 不得 mock virtualizer/伪造 timeline 几何；helper 必须渲染完整 rows；
测试不得引用已删除的 `MessageList.jsx`；Vitest 必须排除 `docs/evidence/**`。

### 1.2 不能当作当前完整验收的结果

- waiting layout owner 报告 `3 browser passed`、`waiting-layout.test.jsx 1 passed`，并已为每条轨迹在
  业务断言前写 artifact 和四个生产文件 SHA-256；这是强定向证据，仍需随最终源码冻结归档命令输出。
- fold owner 最终定向 `3 files / 22 tests` 与 build 通过；production browser `1/1` 失败且耐久证据齐全。
- submission owner 报告发送侧定向 `Composer→ReadingIntent 5/5`、
  `useSubmissions→fake-indexeddb/wire/feed + model/offline 20/20` 和 build 通过；这 25 项只证明
  发送/持久化状态边，不证明列表接管或整体通过。
- UX owner 在当前 Virtuoso 快照上报告 A09 原两条 `2/2` 与新增 no-false-unseen `1/1` 通过；最新
  spec 均先持久化状态 artifact 再硬断言。A01 通过；generation provenance 修复后 A06 production
  active→settled→ack `1/1` 通过，before/after JSON 均在硬断言前落盘。其首跑 strict selector 同时匹配
  status 与 ack 是 false red，改为 exact selector 后完成真实交互，并未放宽业务 oracle。

结论：不同时间、不同源码、不同定向命令的绿不能相加为“全套通过”。

## 2. 证据污染与假绿清单

### 2.1 shared setup 伪几何与全局 mock

已从 `tests/setup.js` 删除 timeline 专用
`clientHeight/clientWidth/offsetHeight/offsetWidth/offsetParent/getBoundingClientRect` 覆盖和全局
`react-virtuoso` mock。通用 jsdom 能力 polyfill 不再提供 timeline 像素。语义测试使用局部
`PresentationMessageList` 或显式 semantic boundary；几何继续只由真实 Chromium 证明。
`tests/test-integrity-contract.test.js` 负责防回归。

### 2.2 helper 截断数据

`tests/helpers/PresentationMessageList.jsx` 原先使用 `snapshot.rows.slice(-64)`，会丢掉深历史、改变 index，
并可能让 filter/loading/fold 测试在错误的数据集合上假绿。现已修成完整 `snapshot.rows`，静态守卫通过。
业务代码中的文本上下文 `.slice(-64)` 或明确的 cache 容量不是此问题，不能用同名搜索误杀。

### 2.3 mock 了不存在的旧模块

19:40 时以下测试引用 `src/ui/timeline/MessageList.jsx`，而 production Timeline 已使用
`LegendMessageList.jsx`：

- `tests/agent-information-architecture.test.jsx`
- `tests/channel-feed-startup.test.jsx`
- `tests/dynamic-f3.test.jsx`
- `tests/f6-composer-isolation.test.jsx`
- `tests/progress-trail.test.jsx`
- `tests/visual-interaction-contract.test.jsx`

前五类 `vi.mock` 没有隔离实际 production list；最后一个直接读取不存在的源文件。测试若绿也不能按其
声称的隔离边界解释。应改成明确局部 mock `LegendMessageList.jsx`，或将静态合同改为当前 production
模块；不得靠全局 setup 补救。

最终三个剩余引用也已清理：`dynamic-f3`、`progress-trail` 局部 mock 当前
`LegendMessageList.jsx` 并只验语义；`visual-interaction-contract` 读取实际当前源并静态约束单 writer，
不在 jsdom 证明几何。

### 2.4 假 scrollbar 与默认 skip

`tests/browser/fixtures/reading-viewport.jsx:191-205` 的 `dragScrollbarToBottom()` 只 dispatch
PointerEvent，然后直接赋值 `scrollTop=scrollHeight` 并 dispatch `scroll/scrollend`。
`reading-viewport.spec.js:549-575` 的绿只能证明合成事件分类，不能证明浏览器原生 scrollbar thumb 接管。

真正 native thumb 用例在 `reading-viewport.spec.js:577+` 默认因未设置
`ATOLL_NATIVE_SCROLLBAR_HEADFUL=1` skip；overlay scrollbar gutter `<2` 时会再次 skip。因此默认 browser
全套没有 native scrollbar 交接证明。结果总账必须单列这个 skip，不能把 synthetic 用例替代进去。

### 2.5 只记录、不判失败的 investigation

`tests/browser/f7-admission-investigation.spec.js:200-217` 会计算 `blankAfterActionAndContent`、
`domEmptyFrames`、`ackMissing`，最终却只断言 report 条数。因此即使白帧、空 DOM 或 admission ack 丢失，
该 spec 仍可绿。它只可用于诊断，不是 P0 gate。

真正可作 gate 的 `flicker-investigation.spec.js` 会对逐帧 DOM coverage 和 CDP compositor paint 硬断言，
且先写 JPEG、timeline、summary、oracle；`legend-production-admission.spec.js` 也在最终 anchor/blank 断言前
写 summary。二者仍必须在最终冻结源码上跑预定全 seed，不能只挑一个通过 seed。

### 2.6 artifact 必须先于可能失败的业务断言

已修：

- `ux-reading-evidence.spec.js`：A09 hidden/visible、activation A→B→A、A01 stale filter、A06 ack
  均先 `writeFile(outputPath)+attach` 完整状态，再做硬断言。
- `f3-message-fold.spec.js`：collapse 后先采 rAF frames/reading trace 并持久化，再断言可见性、高度和
  `<=1px`；默认折叠场景先显式展开以建立真实 collapse 前置。
- `waiting-layout.spec.js`：三条 trajectory 均先写逐 transition 四帧、rect、0px tolerance、源码 fingerprint，
  再做 geometry expect。
- `reading-viewport.spec.js` 的 append→immediate upward wheel→resize 先写
  `append-immediate-upward-resize.json`，故现有失败可审。

仍有门：`f7-history-water.spec.js` 已补完整 Composer→outbox→receipt/feed 的 rAF 轨迹与
`browsing-send-production-evidence.json`，计划断言 bottom intent/issuer write 各一次、accept/receipt/feed
不重发、waiting 不改输入栈；但该新增 gate 尚未跑出结果。代码存在不等于 evidence，且它仍须与
production native-wheel + late-resize C1 gate 一起验。

## 3. 今天八项 P0 的 production-path oracle

| P0 | 必须经过的生产路径 | 可签收 oracle | 当前证据真实性与状态 |
|---|---|---|---|
| 1 冷频道 3s 空、缓存不首显、loading 无动态 | AppShell 频道激活 → production cache/IndexedDB → useChannelFeed/HistoryScheduler → Timeline/Virtuoso DOM | 每帧记录 heading、cache row、loading/empty/content；缓存首个可见 paint；未权威空前绝不出现 empty；cold entry 反馈时延与恢复后内容；artifact 先落盘 | exact fixture actor 从错误的 `steward` 修为实际 `project-agent` 后，独立端口 production browser **3/3 pass**：cached feedback/heading 101.3ms、DOM paint 385.6ms；no-cache feedback 109ms、network DOM 2501ms 且无假空；known-zero 126.4ms 权威空。每条 spec 都先写/attach trace 再做 post-click 业务断言；当前仅 cached attachment 明确保留，另两条成功输出可能被后续 run 清理。**具名轨迹通过，归档完整性待补**。 |
| 2 loading 每物理 batch 挂卸抖 | 同一个 production `historyDemand`/beginOperation 跨 filtered/empty physical pages，直到 visible page/EOF/error/retry | demand revision 和同一 loading DOM identity 全程不变；每个物理 batch 不重新 mount/unmount；真实 rAF 逐帧无空洞；EOF/error/retry 不清内容/不改几何；artifact 先落盘 | 当前 production App→feed→Scheduler→reading→Timeline/Virtuoso gate **1/1 pass**：单 epoch 跨至少两个 `history.batch_complete`；rAF WeakMap 验同 status token/revision、pending+spinner、同 MessageList、内容不清、宽高 `<=1px`。mock server 只提供 320 个被过滤 turn + 20 visible tail，不实现 scheduler；模型同 revision 跨三 physical pages，定向三文件 **60/60**。复签后 post-action 改为手动采集 + try/catch/finally，timeout/page异常也先写并 attach fallback artifact，再断言 capture/status/settle/DOM/revision/batch/geometry；新跑 1/1 pass。**具名 P0 oracle 可签**。 |
| 3 默认长文变展开 | 最终获准列表 adapter 的 Timeline projection/foldOverrides → FoldableBody → adapter size policy → real layout | 未操作长文默认折叠；用户 override 在 latest 更新后保持；expand 的临时 size policy 只属于该事件，匹配 token/ack 后恢复；collapse 常态 policy；rapid inverse/stale ack/unmount 隔离；真实 collapse/expand 每帧锚点 `<=1px` | **当前 Virtuoso production browser 真实失败**：独立命令 1/1 fail；默认 folded 45 行先显式 expand 再 collapse 后，toggle top `330.34375→202.40625→disconnected`，预期折叠 toggle 10 秒未出现。`docs/evidence/frontend-fold-production-20260917/` 在断言前保存 action trace，并耐久复制 screenshot/trace/error context/.last-run/source SHA。定向 3 files/22 tests 绿；`fold-admission` 只是未接 production 的候选模型，不能覆盖失败。**BLOCKED**。 |
| 4 发送后二次回底；append 后立即上滑仍被拉回 | Composer send-start → useSubmissions/outbox durable accept/receipt/feed → ReadingIntent →最终获准列表 issuer；以及 production append → native wheel → late item resize | send-start 只发一次 bottom intent；accept/receipt/feed 不重发；A→B→A/上滑使旧 token 失效；逐 rAF 帧在 browsing 后 gap 应离开 0 且不得被迟到 resize 拉回；outbox 用真 IDB/wire 精确计数 | 发送状态侧定向 5/5 + 20/20 报告有效：真 ReadingIntent 边、fake-indexeddb 事务、wire/feed 乱序与精确次数，并覆盖 phase 日志。**但 Legend 候选真实硬失败，已拒绝准入**：第 6 帧起 mode 已 browsing，28 帧 gap 全为 0；列表 owner 复跑 0/3。回退/替换后的最终 production path 尚未通过同一 oracle，故 P0 仍 **OPEN/BLOCKED FOR DELIVERY**。 |
| 5 prepend 白帧与下方 +28 | 当前 production Virtuoso + heterogeneous rows；真实 wheel 建立 browsing；prepend/下方 item growth；DOM rAF + CDP screencast | prepend 每帧 viewport 有覆盖、无 undefined slot；compositor ROI 无 blank；存活 anchor 同一稳定 ID/offset `<=1px`；下方 +28 anchor delta `<=1px`；所有 seed、当前源码 fingerprint、artifact 先落盘 | `playwright-below28` 的 anchor delta 0 单样本与 `playwright-4105-v2` 的 48 DOM/3 paint 帧来自已拒绝的 Legend 候选，只能证明当时样本，不可继承给当前 Virtuoso；+28 也只有一 paint frame。`f7-admission-investigation` 绿无硬断言，始终无效。**当前 production OPEN，须用相同全 seed gate 重跑**。 |
| 6 旧 queued 不消、复活、布局跳 | useChannelFeed accepted facts → Replica → task-discovery/task-evidence → production Timeline Waiting UI；ConversationSurface input-slot measurement +真实 Timeline | lagging snapshot 在 current terminal 后 Waiting 立即消失；late queued/旧 generation 永不复活；全过程 wire.submit=0；queued→partial→roster→running→terminal 每 transition 连续四帧，reading/stack/composer rect 精确稳定；多行输入只移动允许边 | 语义定向 `7 files / 84 tests` 通过；真实 feed→projection→hook→Timeline/Waiting 覆盖五类 terminal/processing、迟到 queued/request、旧代、partial、submit=0。最新 waiting+send production browser fresh freeze **2/2 pass**：following/browsing 两条都先写/attach 完整 rAF/rect/scroll-stack/diagnostics/source SHA，再断言；geometry delta 0，阈值 1px、discontinuity 0.5px，各一次 intent，browsing 仅一次 return，delayed writers 空。**具名语义与组合 lifecycle 可签**。 |
| 7 stale filter / ack 串 filter / focus / access 文案 | Timeline staleActorFilters + 独立 agent-activity ack；AppShell pendingChannelSelection/focus；ACCESS_MESSAGE/content gate | stale chip 可见且可移除，不重建 list/filter identity；ack 只清 activity，不改 filter；committed channel heading 获得焦点且 `preventScroll`，superseded/background 不抢；access_denied 精确文案与隐藏内容/禁写一致 | A01 production browser 当前通过；generation provenance 修复后，A06 production active→settled→ack 1/1 通过，before/after JSON 先于断言持久化，且 ack/filter 组件语义回归绿。focus 有 jsdom activeElement/rapid switch、无真实 browser prevent-scroll geometry；access 有精确 copy/gate jsdom。**A01/A06 可签定向通过；focus browser 仍 OPEN，access copy/gate 只签 jsdom**。 |
| 8 hidden/files 已读越权 | mounted but hidden Files surface → Timeline/useReadingSession surfaceVisible + materialized DOM high-water + activation-bound unseen → read ack | hidden 到达后 unseen 保留且 read cursor 不前进；仅回到可见 surface 并物化该 seq 后清；A→B→A 旧 activation observation 不得提交；采集 rows/revisions/unseen/diagnostics 后再断言 | 当前 Virtuoso 快照 `ux-reading-evidence` 原两条 `2/2` 与新增 history/replay/reconnect/filter/channel-switch no-false-unseen `1/1` 通过；均在硬断言前持久化 rows/revisions/unseen/diagnostics。**具名 production 轨迹可签定向通过**；仍不等同完整 browser/frozen-suite 通过。 |

## 4. 阈值、baseline 与可解释边界

- 冷启动 250/500/650ms 可作为明示性能预算，但慢机器超时可能 false red。必须同时断言语义状态；不得把
  “未超阈值”替代“缓存首显/未误报空/最终内容正确”。
- compositor `darkPixels < 100` 对当前深色文字 fixture 可发现整页白帧，但对均匀浅色媒体不是通用 oracle。
  应绑定 fixture、ROI、先前已出现的非空 content frame；不能推广为所有 UI 的无白帧证明。
- `f7-history-water` 以首个 populated frame 的 5% 作为 baseline，同样可能漏掉浅色或同色内容，只可解释
  为该 fixture 的相对变化。
- waiting layout 的 0px tolerance 是 owner 明示且 fixture 可控的合同，本审计不建议放宽；若环境造成 false red，
  应保留原始 rect/源码 fingerprint 定位，不改阈值换绿。
- fold/anchor `<=1px` 是合同；历史约 1.15625px 失败不得四舍五入或扩大阈值。

## 5. 最终签收条件

1. 已完成：shared setup 无 virtualizer 全局 mock/timeline 专用固定几何；必要 mock 已局部语义化；
   evidence 被 unit runner 排除；`test-integrity-contract` 4/4。
2. 已完成：旧 `MessageList.jsx` mock/静态读取已迁当前路径或局部 helper。
3. 记录一个源码冻结标识：commit，或 HEAD + dirty diff hash + production/test SHA manifest。每个浏览器 artifact
   带同一 fingerprint；不能边跑边合并别人的改动。
4. 先跑完整 Vitest，逐项列 passed/failed/skipped；再跑完整 browser，单列 native-scrollbar skip；再跑 build。
   focused 只作为定位，不覆盖完整总账。
5. 保留 P0-2 已有同一 demand 多 batch gate 并在最终 freeze 复签；修复 P0-3 的真实 fold 失败；
   P0-5 在当前 Virtuoso 跑预定全 seed；P0-7/A06 与 P0-8 在同一最终 freeze 复签。
6. P0-4 的 C1 production-path 失败未解决前，任何 unit/outbox/终态绿都不能签交付；若架构回退或更换 adapter，
   必须在新 production path 上复用同一 native wheel + late resize 逐帧 oracle，而不是删除/改松用例。
