# Conversation 六链独立架构差异卡（2026-09-18）

性质：只读源码合同审计；不修改生产、不替代执行总账、不用测试计数升级状态。审计对照
`CONVERSATION-FRONTEND-REBUILD.md`、`CONVERSATION-IMPLEMENTATION-SPEC.md` 与作为失败迁移记录的
`CONVERSATION-LEGEND-INTEGRATION-SPEC.md`。第三份不是当前生产设计；当前生产列表是文件名仍为
`LegendMessageList.jsx` 的 Virtuoso 4.18.13 薄适配器。

源码边界：`HEAD 193f189cd3ae63cf3deb9e54d71d7bbeb9fd304c`；本卡正文引用的十五个关键文件以
“路径 + `git hash-object`”组成 manifest，其 SHA-256 为
`4eff2c05e446f6a4cbd8cb50a1aee9b3b8e460430f2b2ee80e351a1a7e57b46d`。
共享工作树仍在施工；后续源码变化必须重审，不继承本卡结论。

严重度只描述合同风险，不表示发布裁决：P0 = 可越过身份/权限/activation/已读等权威边界；P1 =
已知职责或原子提交缺口；OK = 本次静态范围未发现第二 owner，但不等于行为验收通过。

## 差异总览

| 链 | 唯一 owner 与真实写入口 | 当前跨层边界 | 裁决 |
|---|---|---|---|
| history/live/cache → Replica → Presentation → list | `ChannelReplicaStore` 唯一写 materialized facts；`useChannelFeed.applyRows` 是 live 与 Scheduler replay 的共同入口。`HistoryScheduler` 只写物理请求/coverage/reservoir；`ConversationPresentation` 只写不可变可见快照；Virtuoso 只消费快照 | 没发现第二 Replica 或 UI 直写事实。仍按 raw record/byte release；`loadHistory` 以无 Presentation 实例的 `projectTimeline(...).firstVisibleSeq` 判 supply satisfied，未形成 conversation semantic unit/已提交物化边界 | **P1，已知设计缺口** |
| scope / activation / cancel | `ReadingSession controller` 写 mode/bookmark/intent；Presentation 以 viewID 隔离；adapter layout commit 后绑定 activation；Scheduler operation/AbortController 属当前 semantic view | hook、Timeline、Composer port、feed/submission async port 仍在 render 发布 ref；可丢弃 render 能替换已提交事件随后读取的 owner。`initialLocationRef` 也在 render 固化候选 | **P0** |
| Waiting canonical facts / layout | Replica fold 是服务器生命周期唯一 owner；Outbox 只拥有 ledger 前的 durable-local 意图；`selectWaitingPresentation` 应为无状态 join；Surface + 固定 48px Footer reserve 拥有布局 | canonical queued 只受 channel `controlCurrent` 门；App 已算出的 principal/channel/generation roster authority 未进入 selector。旧 incarnation/离场 actor 的 open queued 可被当作当前 Waiting；设计中的 content/controls completeness/partial 元数据也未接 selector | **P0 currentness；布局 owner OK** |
| unseen / read | Replica live-arrival journal 只记录 accepted live；ReadingSession/ViewSession 拥有视图 unseen；`Cursors` 拥有频道 durable read seq | 当前过滤 Presentation DOM 的 `installedHighSeq` 可直接调用频道 `markRead`，缺未过滤、current physical head 与连续 coverage 门；视图 ack 越权成频道级已读/rail 清除 | **P0** |
| send/outbox/draft → view | IndexedDB Outbox/Draft store 是 durable owner；Composer 只提交 editor snapshot；`acceptDraft` 原子 CAS；pending local agent request 只投 Waiting，其他 local echo 投 Presentation；accepted live 回 Replica 后 reconcile | AppShell 的稳定 Composer port 在 render 直接换 targets。旧已提交 Composer 可命中未提交频道 callback，把正文/附件写到错误 `activeChannelId`。Composer/useSubmissions 另有同型 render ref 发布 | **P0** |
| foreground / access sync | `ChannelAccessTracker` 唯一写 access；attach membership snapshot、current live evidence、definitive denial是事实入口；SyncCoordinator 只写 freshness obligation | 初审反例已在本源码边界内修复：current connection/admission epoch 的 `forbidden` 先停止目标义务，再经 Scheduler generation fence 撤 access/self；新 attach 可 regrant | **源码结构已闭；行为仍归root验收** |

## 1. 数据合流链

唯一物化入口成立：`src/app/hooks/useChannelFeed.js:70-164` 将 cache/history replay 与 live 都汇入
`replicaRef.current.commit`；`src/model/channel-replica.js:31-108` 是唯一 store，重复 seq/重复 envelope
不会形成另一份 UI 事实。`src/model/timeline-projection.js:61-183` 负责 scope/filter/local echo，随后才由
`src/model/conversation-presentation.js:223-404` 产生 detached immutable rows；生产 UI 仅在
`src/ui/Timeline.jsx:899-905` 调用这条链。

未闭原子边界与主设计 §7.3 的现状描述一致：Scheduler 的 `release` 仍选择固定数量/字节的 raw
records（`src/model/history-scheduler.js:581-602`），`loadHistory` 每批后以无 Presentation 实例的
`projectTimeline` 首个可见 seq 决定满足（`src/app/hooks/useChannelFeed.js:494-545`）。Fold 的倒序供给通常会让
request 到达后才出现完整 root turn，但接口没有“semantic unit 已完整且已提交物化”的显式 token；不能把
8 records/256KiB 宣传为 8 conversation units，也不能由这条 supply completion 推出列表几何 ready。

另一个共因属于下一节：Scheduler replay 通过 `applyRowsRef.current`，live batch 通过
`landLiveEventsRef.current`；两者当前都在 render 写 ref，而不是 committed owner port。

## 2. scope、activation 与取消

adapter 自己的主 binding 已按 commit 发布：`src/ui/timeline/LegendMessageList.jsx:867-937` 在 layout
effect 才替换 `readingRef/snapshotRef/activationOwnerRef`，旧 activation cleanup 也只观察、不写几何。
然而上游仍有下列真实旁路：

- `src/ui/timeline/useReadingSession.js:382-427,924-945` 在 render 重置或发布 controller、session、
  snapshot、history、markRead、arrival resolve/ack ports。历史 Promise、visibility handler 与 list callback
  会读取这些 refs，因此 abandoned render 可把未提交 view/controller 暴露给已提交回调。
- `src/ui/Timeline.jsx:957,1057-1058` 在 render 发布 reading control 与 edit runtime；已提交点击/卸载可命中
  候选 controller/state。
- `src/ui/timeline/LegendMessageList.jsx:1715-1730` 在 render 第一次写 `initialLocationRef`。adapter 的其他
  activation owner 虽已 commit-bound，这个一次性初始位置仍不在同一原子边界。
- `src/app/hooks/useChannelFeed.js:164,309` 与 `src/app/hooks/useSubmissions.js:52-54` 同样在 render 发布
  外部异步入口所读的函数/状态。

这违反实施规格 §3 的“React render及可丢弃候选不发布owner”以及 §3.2 的 activation/version 条件写。
修复边界应是统一 committed port/epoch，而不是逐个在 Promise resolve 后再检查。

## 3. Waiting facts 与布局

正确的两阶段所有权是：Outbox 只在 ledger 前拥有 durable-local intent；一旦 canonical request/stage 存在，
Replica fold 独占 queued/processing/terminal。`src/model/waiting-presentation.js:23-51` 按稳定 request ID 做
local→canonical/continuity handoff，没有第二个 terminal store；`src/ui/Timeline.jsx:166-247` 的 180ms exiting
副本为 `aria-hidden + inert`，只做视觉交接。

当前确定缺口是 actor currentness。`selectWaitingPresentation` 的全部输入见
`src/model/waiting-presentation.js:8-64`：canonical queued 只检查 `controlCurrent`，没有 authoritative roster
Set、principal/channel/generation token或 exact incarnation 门。调用点 `src/ui/Timeline.jsx:981-1002` 也未传；
而 App 已在 `src/App.jsx:255-273,657-662` 维护该 authority，却没有进入 Timeline/Waiting。这与总设计
§8 的 current-generation roster 门矛盾。Replica lifecycle 为真不等于 actor 仍是当前成员；两种权威必须
exact join，不能由 channel tail current 代替。

设计还要求不完整 evidence 只读/partial，并以 content/controls completeness 决定动作；当前 selector 与
WaitingLayer没有这些字段。按钮最终仍由同一 progress frame 的 controls + `member_active` 门控制
（`src/model/task-controls.js:60-106`），所以这不是“任意按钮已越权”的结论，但 completeness UI/动作合同缺失。

布局本次未见第二 owner：`src/ui/conversation/ConversationSurface.jsx:25-224` 只测 in-flow input slot；
`src/styles/app-shell.css:107,119` 将 Waiting 放在 absolute floating sibling；
`src/ui/timeline/LegendMessageList.jsx:61-68` 与 `src/styles/timeline.css:31` 从首次 mount 保留固定 48px Footer。
Waiting lifecycle 本身不写 scrollTop/高度。

## 4. unseen 与 durable read

事实入口是 accepted live commit 后的 `recordLiveTimelineArrival`（`src/app/hooks/useChannelFeed.js:97-118`；
`src/model/fold.js:96-151`）；cache/history/self/provisional不制造 arrival。视图内 visible/unseen join 在
`src/ui/timeline/useReadingSession.js:193-302,625-667`，与频道 cursor 是两个问题。

越权发生在两者合流处：adapter 的 `installedHighSeq` 只遍历**当前 Presentation rows/DOM**
（`src/ui/timeline/LegendMessageList.jsx:150-157,1078-1111`）。ReadingSession 在 following、atTail、Surface/document
visible 后直接 `markRead(installedHighSeq)`，没有 unfiltered scope、physical head 或 continuous coverage 条件
（`src/ui/timeline/useReadingSession.js:947-958,1015-1039`）。最终
`src/app/hooks/useChannelFeed.js:556-581` 推进频道物理 cursor并清 rail unread。因此“我的往来”或成员过滤列表
到达自己的尾部，可能越过当前视图排除的消息。修复必须保留 view unseen ack 的局部语义，同时为 durable
channel read 使用独立的未过滤、同generation、连续覆盖到物理tail证据。

次级失效边界：arrival journal在当前 controller `stageArrivals` 后立刻全局 acknowledge，而尚未分类的
`pendingRecords` 只存在 controller 内；controller/scope切换不会持久化或移交它们
（`src/ui/timeline/useReadingSession.js:95,193-216,304-313,625-667`）。若产品要求同一 view 切走再回来仍保存
“尚未取得同revision viewport observation”的 arrival，该原子 handoff 也未实现；需由产品语义裁决，不能从
现有代码声称已保留。

## 5. send/outbox/draft 到 view

耐久事实链本身是单 owner：Composer 在首个 await 前取得 reading token并提交 exact editor snapshot
（`src/ui/Composer.jsx:735-918`）；`useSubmissions.send` 二次校验 membership 后以 `acceptDraft` CAS 原子写 draft
consumption + stable-ID submissions（`src/app/hooks/useSubmissions.js:435-498`）；feed commit 先进入 Replica，再按
message ID reconcile Outbox（同文件 `570-601`）。没有发现 receipt/feed/retry 直接写 Presentation。

确定的跨频道反例位于稳定 UI port：`src/app/AppShell.jsx:53-71,338-349` 在 render 直接替换
`composerActionTargetsRef.current`。这些 targets 中 `onDraftChange/onRemoveAttachment/onClearAttachments` 捕获当次
render 的 `activeChannelId`（`src/App.jsx:1575`）。若频道 B 的 concurrent render 被丢弃，仍已提交的频道 A
Composer 可在该窗口通过稳定 wrapper 调用 B callback，把 A 的输入/附件写到未提交 B。按频道 `key` 只约束
commit/remount，不能约束 render 期间的 port。Composer 自己也在 render 写 `onDraftChangeRef/submitRef` 等
ProseMirror 外部回调入口（`src/ui/Composer.jsx:480-484,717-724,935`）。这些入口须以 committed channel/principal
epoch整体发布。

## 6. foreground 与 access 同步

`ChannelAccessTracker` 是 access owner；attach membership snapshot在 `src/App.jsx:526-555` 安装，accepted live
只证明 observer eligibility（`src/model/channel-access.js:231-245`），发送的 definitive forbidden 目前在
`src/app/hooks/useSubmissions.js:401-405` 撤权。这些入口职责明确。

初审发现前台 freshness error 没有回到同一 owner：频道进入/重选/hidden→visible 调
`syncCoordinator.interest`（`src/App.jsx:294-297,931-941`；`src/app/hooks/useChannelFeed.js:300-325,467-470`），
probe 是 `wire.channelMeta`。该反例已在本卡记录的源码边界内修复：coordinator 先通过
connectionEpoch + admissionEpoch stale fence，再把 definitive error 与瞬时错误分流；`forbidden` 会从当前
admission 删除目标、停止retry但保留未fulfilled revision（`src/model/sync-session.js:184-223`）。feed callback
再核 `admissionGeneration === attachedGeneration`，调用 target-scoped Scheduler revoke，并且无论 revoke 是否命中都执行
`access.forbidden + roster.clearSelf + onAccessChanged`（`src/app/hooks/useChannelFeed.js:209-240`）。Scheduler revoke
自身再次核全局generation与该频道attachedGeneration，只取消目标batch/waiters/foreground并撤
`controlCurrent`（`src/model/history-scheduler.js:1442-1469`）。新 attach 的完整 admission Set 会递增epoch并按原
interest revision重启；history_meta没有单独铸造membership。按当前源码，原“forbidden通用retry且缓存继续展示”
的P0不再成立。

Scheduler revoke 即使因 concurrent reset 返回 no-op，feed callback仍执行access/self撤销，不会留下
“sync blocked但cached access仍member”的静默状态。`resetReplica/attach` 同turn的 late forbidden 仍应纳入
root行为门验证epoch fence；本卡只给源码结构关闭，不替root签行为验收。

## 结论

本次静态审计未发现第二 Replica、第二 Waiting terminal store、receipt/feed直写 Presentation或 Waiting lifecycle
直接写滚动几何。当前阻断不是“所有层都有两套实现”，而是三个仍存在的明确权威连接缺口：

1. 未提交 render 可发布已提交事件会读取的 owner/port；
2. Waiting 未 join current-generation roster authority；
3. filtered Presentation visibility 可推进 physical channel read cursor；

初审的第四项——current-generation `channel_meta forbidden` 未归一到 access owner——已在本源码边界内完成
上述静态闭环，但仍保留 reset/attach 竞态反例门，不据此签完整前台权限验收。

raw history semantic-unit、Waiting completeness metadata及 pending-arrival跨activation handoff为P1/待裁决；它们不能
被窄场景绿灯或单一 owner 静态事实覆盖。上述P0关闭后仍需按root总账在同一冻结源码上验收，本卡本身不签发布。
