# Conversation 当前架构索引

日期：2026-09-18。性质：当前生产源码的结构索引，不是发布总账、测试通过清单或未来重构方案。
状态结论仍以 [CONVERSATION-EXECUTION-REVIEW-LEDGER.md](./CONVERSATION-EXECUTION-REVIEW-LEDGER.md)
为准。本页只回答“事实由谁拥有、经什么边界提交、用户看到什么”；文末摘要用于防止后续源码变化被旧证据覆盖。

## 1. 已确认的产品边界

- 页面刷新或新文档从最新处开始；不恢复旧像素位置。当前文档内的 A→B→A 仍保留内存书签。
  产品没有任意消息、搜索结果或引用目标导航，因此 Content 的 semantic text-point resolver 没有列表 consumer
  不是交付缺口。
- Waiting 使用从首帧存在的固定 `48px` 收起态留白。Waiting 默认展开、自己有有界滚动；展开层高于
  `48px` 时可覆盖部分 reading 内容，这是当前简化选择，不擅自派生动态 margin、resize 或保锚合同。
- `100k` 不再是本轮硬准入门。DOM、cache、arrival journal 等仍须有界，但本索引不把某个合成规模当发布条件。
- 历史机械过程（tool/thinking/plan）不要求回放。历史 `stage:text` 的源差异单列为范围边界，不据此授权
  后端协议或 Gateway 修改。
- 前端只使用既有 Gateway view/request；没有 Waiting poller、第二历史 cursor 或自动 `system.log.query`。

## 2. 端到端主链

```text
Wire live / history_before / OBS grants / IndexedDB cache
  -> Feed producer token + connection/admission generation fence
  -> ChannelAccess + one HistoryScheduler + FeedCache
  -> one ChannelReplicaStore -> canonical Fold
  -> projectTimeline(view spec) -> HistoryPresentationAdmission
  -> ConversationPresentation candidate -> committed Presentation/Role snapshot
  -> ReadingSession commit owner -> Virtuoso public callbacks
     -> one application bottom issuer + Virtuoso-owned internal geometry writes
  -> exact visible identities / physical-tail receipt -> Cursors + unread rail

canonical Fold + local Outbox seam -> stateless WaitingPresentation -> floating WaitingLayer
Draft -> atomic Outbox acceptance -> transmit/receipt -> accepted feed -> Replica reconciliation
```

横切整条链的失效键是 `principal + channel + producer/generation + activation/view + source revision`。
旧连接、旧频道、旧筛选、放弃的 React render 或迟到 Promise 只能被拒绝，不能向新 owner 发布事实。

## 3. Owner 与提交边界

| 域 | 唯一 owner | 输入与输出 | 用户不变量 | 当前性质 |
|---|---|---|---|---|
| 访问与前台同步 | [channel-access.js](../src/model/channel-access.js)、[sync-session.js](../src/model/sync-session.js) | OBS membership/grant、连接 epoch、definitive forbidden；输出读写资格和同步 obligation | live delivery 不等于 membership；普通 unavailable 可重试，当前 generation 的 definitive forbidden 撤权并停止目标义务 | 生产结构 |
| 历史与 cache | [history-scheduler.js](../src/model/history-scheduler.js)、[feed-cache.js](../src/model/feed-cache.js) | 唯一 `history_before` 物理请求、coverage/retry/controlCurrent；IDB 只加速启动 | scope/filter 只发语义 demand；cache 不得自证 current 或空频道；regrant 复用同一 Scheduler | 生产结构 |
| 内存事实 | [channel-replica.js](../src/model/channel-replica.js)、[fold.js](../src/model/fold.js) | accepted cache/history/live row 合并成一个 channel state、turn、arrival journal | cache/network/live 是 provenance，不是并列 store；terminal、乱序合流和 trim-safe lifecycle closure 只有一份 | 生产结构 |
| 语义投影 | [timeline-projection.js](../src/model/timeline-projection.js)、[history-presentation-admission.js](../src/model/history-presentation-admission.js) | `scope/self/actorFilter/editingTarget` 生成 root-turn 单元；Admission 将 semantic demand 与一次已提交 prepend 对齐 | raw batch 不是用户可见 unit；换 view 必须取消旧 obligation；不得再建第二 HistoryProjection | 生产结构 |
| 稳定 Presentation | [conversation-presentation.js](../src/model/conversation-presentation.js)、[Timeline.jsx](../src/ui/Timeline.jsx) | render 只 `evaluate` immutable candidate；layout commit 以 exact owner receipt 发布 rows/revision，Role 再按 exact current authority 发布 `roleRevision` | suspended/aborted render 不写 owner；latest 不是“当前 loaded 最后一行” | 生产结构；不代表列表几何通过 |
| 阅读意图 | [reading-session.js](../src/model/reading-session.js)、[useReadingSession.js](../src/ui/timeline/useReadingSession.js) | following/browsing、activation/inputEpoch、bottom intent、history request、viewport evidence 和 arrival disposition | trusted browsing 输入立即夺权；旧 DOM/旧 history Promise 不得操作新 activation；新可见 projection 要新 observation | 生产结构；source-bound |
| 列表提交 | [LegendMessageList.jsx](../src/ui/timeline/LegendMessageList.jsx) | 实际为 React Virtuoso 4.18.13；`followOutput=false`；公开 range/layout/height 回调进入 Reading；应用回底只有一个 `root.scrollTo` issuer，库仍拥有初始化、prepend 与 upward measurement correction 的内部滚动 | 应用 writer 不自造阅读授权且写前复核 committed activation/inputEpoch/mode/intent；内容、Waiting 无应用级主列表写口 | 生产结构；应用单 writer 不等于全系统单物理 writer，整体几何准入不在本页声明 |
| 通知与游标 | [fold.js](../src/model/fold.js)、[cursors.js](../src/model/cursors.js)、[useChannelFeed.js](../src/app/hooks/useChannelFeed.js) | accepted live 记录稳定 arrival identity；Reading 作 visible/unseen/out-of-scope disposition；Cursors 持久化 exact identity 与 physical seq | history/cache/self/机械 progress 不制造新动态；filtered/browsing 只能 exact ack；只有 current unfiltered following tail 可推进 physical cursor | 生产结构 |
| Waiting | [waiting-presentation.js](../src/model/waiting-presentation.js)、[Timeline.jsx](../src/ui/Timeline.jsx)、[ConversationSurface.jsx](../src/ui/conversation/ConversationSurface.jsx) | canonical queued turn + durable local Outbox seam，经无状态 selector 进入 floating layer；roster/control context 只裁动作资格 | roster unknown/departed 不删除 canonical queued；terminal 只能由 Replica 移除；Waiting 不测量、不写列表坐标 | 生产结构；全集完整性受现有 history view/coverage 限制 |
| 草稿与发送 | [outbox-store.js](../src/model/outbox-store.js)、[useSubmissions.js](../src/app/hooks/useSubmissions.js)、[Composer.jsx](../src/ui/Composer.jsx) | revision draft 经 IDB CAS 固定 message ID/frame；lease 后 submit；receipt 改 Outbox，accepted feed 才归一到 Replica | 新草稿不被旧 accept 清空；uncertain/retry 保持同 ID；权限与连接分别校验；receipt/feed/retry 不另造回底意图 | 生产结构；完整场景结果见总账 |
| 附件与 feed consumer | [App.jsx](../src/App.jsx)、[useChannelFeed.js](../src/app/hooks/useChannelFeed.js) | committed feed owner token 拒绝旧 producer；附件命令以 principal/world/channel/draft epoch 跨 await 复核 | 频道或 world 已切换的上传/roster/submission callback 不得落入新 owner | 生产结构；source-bound |

## 4. 各链具体语义

### 4.1 数据、权限与 cache

[useChannelFeed.js](../src/app/hooks/useChannelFeed.js) 是网络事实进入前端的唯一编排边界。live batch 在任何 Replica、
access、arrival、unread 或 cache 副作用前先验证 committed producer token；历史页由同一
[history-scheduler.js](../src/model/history-scheduler.js) 校验并提交。[feed-cache.js](../src/model/feed-cache.js)
只保存有界 working copy；它不能替代 Replica、membership 或 coverage。

OBS 完整 membership 是关系权威。feed 只证明某一连接当时可收该行。当前 generation 的 definitive forbidden 经同步
epoch fence 后撤销 Scheduler 目标、发布 `access_denied` 并清理 self roster；普通断线或 unavailable 不伪造撤权。
新 generation/regrant 仍回到同一 Scheduler/Replica 链。

### 4.2 Fold、投影与历史供给

[fold.js](../src/model/fold.js) 持有 request/response 合流、provisional/terminal、unmatched closure 与 live-arrival
journal；[timeline-projection.js](../src/model/timeline-projection.js) 才按当前 view 选择用户可见 root turn。
历史向上需求可跨多个物理页寻找第一个匹配 semantic unit 或权威 EOF，但不会创建第二 request loop。

[history-presentation-admission.js](../src/model/history-presentation-admission.js) 把“供给到了”与“该批已经成为当前
Presentation 的精确 prepend”分开。React render 只计算候选；[Timeline.jsx](../src/ui/Timeline.jsx) 在 layout commit
后发布 Admission、Presentation 与 Role receipt。Role 的 current-entry 还要匹配 epoch/view/source revision/candidate
及 Reading coverage，不从本地数组末项猜测。

Timeline 的 Presentation choice（fold/progress/thread/details）只写稳定 choice store，不消费 Reading control。
真实 native input 由 adapter 的统一输入合同取得 browsing；processing edit 的 focused control 直接使用当前 viewport
port。只被 event/passive/Promise 使用的 edit runtime 在 layout commit 发布。每个 session callback 首次捕获自己的
committed runtime，same-channel 的最新 committed authority 只作撤权门，不能让旧 session 借用新 owner 执行动作。

### 4.3 Reading、列表与恢复

[useReadingSession.js](../src/ui/timeline/useReadingSession.js) 用 insertion-commit frame 原子发布 controller、activation、
channel/view、inputEpoch、snapshot/source revision、generation、history request、markRead 和 arrivals ports。已提交 DOM
证据也携带同一 owner；旧 owner 只可完成自己的 disposition，不能读写新 owner。

[view-session.js](../src/model/view-session.js) 在 storage 边界强制 `following + bookmark:null`，所以刷新从底部开始；
live store 仍保存当前文档的 reading copy，使 A→B→A 能恢复同一挂载期书签。书签只服务这个现有行为；不承诺刷新后的
像素位置、任意目标跳转或 semantic text-point 定位。

生产 adapter 文件名仍叫 `LegendMessageList`，但实际 import/render 的是 React Virtuoso 4.18.13。
`@legendapp/list` 不在生产链。Reading 授权与 public list commit 合流后，adapter 才能执行应用唯一的回底
`root.scrollTo`；这不接管 Virtuoso 内部的 initial positioning、prepend maintenance 或测高后的 `scrollBy`。
两类写入必须分账；“应用单 writer”不能证明全系统几何单 owner，也不能推出白帧、prepend、fold 或全部浏览轨迹
已经验收。库侧事实入口见 [CONVERSATION-VIRTUOSO-UPSTREAM-EVIDENCE.md](./CONVERSATION-VIRTUOSO-UPSTREAM-EVIDENCE.md)。

### 4.4 通知

只有 accepted live Replica commit 可调用 `recordLiveTimelineArrival`。journal 记录 stable root identity 与 seq；
Timeline 注册单一 consumer，Reading 结合当前 Presentation identity、同 revision DOM observation、document/Surface
可见性和 following/tail 事实，把每条 arrival 判为 visible、unseen 或 out-of-scope，完成后才 ack journal revision。

视图通知与频道物理已读是两套声明：filtered/browsing 可清精确已见 identity，却不能借局部 `installedHighSeq`
推进频道 cursor；physical seq 只接受 current、unfiltered、following、真实可见 tail receipt。rail 消费由此得到的
`unreadCounts`，不重新按 raw rows 计数。

### 4.5 Waiting 与固定留白

服务器事实链只有 `Gateway validated row -> Replica/Fold -> selectWaitingPresentation -> WaitingLayer`；durable local
agent request 可在 canonical queued 到达前以同 message ID 占据唯一 local seam。Waiting selector 不存第二份 lifecycle，
不发 query/retry。`controlCurrent` 决定服务器 queued 是否可呈现为 current；roster authority 只决定具体 control 是否可用，
不能删事实或用 principal/declaration 猜 actor currentness。

[ConversationSurface.jsx](../src/ui/conversation/ConversationSurface.jsx) 只测量 input slot，Waiting 是 absolute floating
sibling。[LegendMessageList.jsx](../src/ui/timeline/LegendMessageList.jsx) 的 Footer 从首帧提供固定 `48px` reserve；
[timeline.css](../src/styles/timeline.css) 保留默认展开、收起按钮和内部滚动。生命周期变化不改 reading/composer 外框，
但展开层超出 `48px` 的部分可能覆盖 reading；这是已知产品边界，不是遗漏的动态几何 owner。

### 4.6 Composer、Outbox 与 view

[Composer.jsx](../src/ui/Composer.jsx) 独占编辑器、reply、recipient、IME、selection 与提交 port；长寿命 ProseMirror
callback 只读 layout-committed owner。[outbox-store.js](../src/model/outbox-store.js) 的 `acceptDraft` 在一个 IDB 事务中
比较 revision、固定 ID 和完整 frame，然后才允许 [useSubmissions.js](../src/app/hooks/useSubmissions.js) 进入 queued /
transmitting / accepted / delayed / uncertain / rejected / landed 状态机。

发送前重新读取 current access/open epoch；receipt 不写 Replica。accepted feed 带同 ID 落入 Replica 后才做 Outbox
reconciliation。Composer 的 send-start 可在首个 await 前申请一次窄 bottom intent；durable accept 只关联该 token，
receipt、feed echo、retry 和 Waiting handoff 没有第二个意图端口。附件 await 同样受 committed principal/world/channel/
draft epoch 约束。

## 5. 生产实现、隔离候选与范围边界

### 当前生产实现

- 单 Scheduler、单 Replica/Fold、单 Presentation/Role commit chain、单 ReadingSession 和单 Virtuoso adapter；应用
  只有一个回底 writer，但 Virtuoso 仍是其内部几何 writer。
- Feed、Reading、Presentation、Role、Composer 与附件 callback 都以 commit-owned token/receipt 交接；render candidate
  不可发布外部事实。
- Waiting 是 canonical lifecycle 的无状态 UI，只有 Outbox-before-feed 的同 ID local seam。
- exact notification ack 与 physical cursor 分权；发送 durable ledger 与 Replica feed fact 分权。

以上是源码结构事实，不是同一 freeze 的完整 browser/fuzz/build 通过声明。

### 隔离或非生产内容

- [foreground-slab prototype](../tests/browser/prototypes/foreground-slab/) 是 normal-flow 隔离实验，没有接入生产，
  也不是迁移批准或已选中的 Virtuoso 替代。
- `@legendapp/list` 只是 package/test/evidence 残留；生产 adapter 是 React Virtuoso。
- [ContentPlanBlocks.jsx](../src/ui/ContentPlanBlocks.jsx) 的 semantic text-point describe/resolve 是可用能力，但按当前
  产品范围不接列表 restore。
- 旧 TaskEvidence/discovery/hook、自动 `system.log.query` 与 Waiting 专用 cursor 不在当前生产链，不得从历史证据恢复。

### 明确范围边界

前端 [turn-process.js](../src/model/turn-process.js) 把每条 `stage:text` 定义为已经交付给参与者的正文，并只把最后一条
与 terminal 相同或为其前缀的 observation 做 answer-slot handoff；更早的 `stage:text` 仍是正文。既有 Gateway
[history.go](../../atoll/platform/channelspec/history.go) 对完成 root 只保留 request + terminal，对开放 root 只保留最新
provisional，因此历史窗口不会带回完成前较早的 `stage:text`。机械 process 省略符合产品选择；`stage:text` 差异是
当前 source-fidelity 范围边界，不在本前端任务中转化为后端施工或新协议。

## 6. 可复核入口

下列文件是合同入口，不在本页继承其历史 pass 数或把某个 artifact 解释为当前整体验收：

- 数据/权限/cache：[sync-data-fuzz.test.js](../tests/sync-data-fuzz.test.js)、[channel-feed-startup.test.jsx](../tests/channel-feed-startup.test.jsx)、[channel-access.test.js](../tests/channel-access.test.js)
- Projection/commit：[conversation-presentation-react.test.jsx](../tests/conversation-presentation-react.test.jsx)、[history-presentation-admission-react.test.jsx](../tests/history-presentation-admission-react.test.jsx)、[timeline-render-authority.test.jsx](../tests/timeline-render-authority.test.jsx)
- Reading/通知：[timeline-reading-integration.test.jsx](../tests/timeline-reading-integration.test.jsx)、[reading-lifecycle.spec.js](../tests/browser/reading-lifecycle.spec.js)、[visible-unseen-ack.spec.js](../tests/browser/visible-unseen-ack.spec.js)
- cold/history：[cold-channel-entry.spec.js](../tests/browser/cold-channel-entry.spec.js)、[history-underfill-lifecycle.spec.js](../tests/browser/history-underfill-lifecycle.spec.js)
- Waiting：[waiting-presentation.test.js](../tests/waiting-presentation.test.js)、[waiting-send-transaction.spec.js](../tests/browser/waiting-send-transaction.spec.js)、[waiting-handoff.spec.js](../tests/browser/waiting-handoff.spec.js)
- Outbox/Composer：[submission-outbox.test.jsx](../tests/submission-outbox.test.jsx)、[offline-recovery.test.jsx](../tests/offline-recovery.test.jsx)、[offline-composer-recovery.spec.js](../tests/browser/offline-composer-recovery.spec.js)

## 7. 本页 source boundary

以下 SHA-256 是写本索引时读取的关键文件内容，不是 git commit，也不是测试签署：

```text
App.jsx                              1d17da45c13c87c8
useChannelFeed.js                   14132be9989139ef
useSubmissions.js                   00fa7aafffd449fe
Composer.jsx                        0b3256a4da0f5b0e
Timeline.jsx                        fe21393e22244445
useReadingSession.js                0c998c5d2b2813de
LegendMessageList.jsx               f1c51251895380cc
conversation-presentation.js        74660ae045252d90
history-presentation-admission.js   5c4688cc597d5096
channel-access.js                   7a4f6c27af3e43cf
sync-session.js                     942470f584f40ef3
history-scheduler.js                e7ccfcae5cff3222
feed-cache.js                       7396400bc552a6c6
channel-replica.js                  b06c32029d4e6384
fold.js                             418b96568591bdc7
timeline-projection.js              f5b7aeed664886e7
waiting-presentation.js             bd054694868ecaf1
cursors.js                          3e37256d8458173f
view-session.js                     37b99e84ca8ed365
reading-session.js                  84f56f61172b29c4
outbox-store.js                     ad0e5d9678c04852
turn-process.js                     31438fa3d574f547
ConversationSurface.jsx             e9a248a973d3a327
timeline.css                        f9707377d4ec0e41
```

任一权威边界文件摘要改变后，先重读实际 owner/port，再更新本页；不能把本页摘要或旧测试结果当作继承许可。
