# Conversation 全任务结构审核（2026-09-18）

性质：独立、只读、source-bounded 架构审核。不修改生产，不替代执行总账，不用测试数量推导结构正确。
对照 `CONVERSATION-FRONTEND-REBUILD.md`、`CONVERSATION-IMPLEMENTATION-SPEC.md`、
`CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md` 与当前生产源码。旧浏览器失败只说明当时源码；除非当前调用链仍在，
本卡不把它写成当前缺陷。当前源码后续变化也不得继承本卡结论。

源码边界：`HEAD 193f189cd3ae63cf3deb9e54d71d7bbeb9fd304c`；正文涉及的二十一个生产文件以
“路径 + `git hash-object`”组成下附 manifest，整体 SHA-256 为
`a94e3fc625aaae8b4a6827e87f351c26410143b22f7615f2e5c846eeb1900740`。严重度描述权威边界风险，不是发布裁决：
P0 = 候选/旧身份可能写当前权威；P1 = 用户语义或原子交接能力缺口；OK = 静态范围未见第二 owner，不等于行为验收。

### 三项需求重判（2026-09-18续审）

本节只重判用户明确点名的阅读恢复、Waiting固定留白与历史conversation unit；它不把其他owner的后续施工结果
并入本卡，也不替总账改变状态。下文相应旧段落均以本节为准。本次续审只绑定本节末列出的十三个文件；页尾原二十一个
文件manifest仍是首轮全任务审核边界，不得把其他owner在两次边界间的变化倒推成已审。

| 项目 | 当前事实/已有能力 | 产品边界 | 裁决 |
|---|---|---|---|
| semantic text-point | Content已有DOM→`blockID + textOffset + context`描述/解析能力；列表恢复只消费message row及row offset | 用户已取消任意历史消息/pixel恢复，刷新从底部开始；同一挂载期块内selection稳定仍是独立能力 | **无consumer不是交付缺口**。保留resolver无害，但不得借它重新引入已取消的跨刷新/任意历史定位；跨虚拟回收Selection只有在另有明确需求时才是能力项 |
| Waiting fixed48 | Virtuoso Footer从首帧恒留48px；Waiting默认`collapsed=false`，展开层最高`42vh/420px`并内部滚动 | 48px是用户选择的**收起态reserve**，不是展开层真实高度；旧F19要求保持默认展开 | 保留固定48和默认展开。当前absolute浮层只证明外框不动；在这项简化选择下，最低要求是展开/收起与任务操作始终可达，收起后48px真实释放正文。若仍要求展开时正文同时完全无遮挡，则与当前三项约束不同时成立，须另作产品取舍，不能由审计擅自加resize/保锚施工 |
| history semantic unit | Scheduler仍唯一；`projectTimeline`已把root turn聚为一个投影项，Admission按该投影项计数；response-before-request在Fold中等root到达后合流 | “一个投影turn”在fresh history与live/cache间仍须保有已发送给参与者的正文；用户明确不要求历史机械process | **不缺第二个前端unit owner**。确定缺口仅是既有Gateway History View对完成root只留request+terminal，连同机械process一起删掉了仍被前端定义为参与者正文的早期`stage:text`；process删除本身不是缺口 |

Waiting的最小产品一致方案不新增几何合同：Surface保持永久48px reserve、默认展开与浮层内部有界滚动；展开/收起、任务控件
必须始终可操作，用户收起后由固定48px真实恢复正文空间。当前“展开420px浮层 + 恒定48px reserve + 正文同时完全无遮挡”
三者不能由现结构同时保证；如果产品仍要求第三项，需要用户/root另裁一个约束，而不是本卡自行指定动态margin/Footer、resize、
保锚或第二scroll writer。

## 总览

| 链 | 唯一权威与写入口 | 当前用户语义 | 当前源差异 |
|---|---|---|---|
| feed / cursors / Reading | Replica arrival journal记录accepted live；ViewSession拥有视图unseen；Cursors分别拥有exact identity ack与physical read seq | 只有真实可见身份能清视图通知；filtered/browsing只能exact ack；无过滤All在current generation、following、tail才可推进physical cursor | exact/physical已分权；arrival只在visible/unseen/out-of-scope disposition后确认，未决记录可交给新activation。Reading事件port仍可把旧DOM证据接到候选render事实（P0） |
| Scheduler cold / regrant / controlCurrent | SyncCoordinator拥有interest obligation；HistoryScheduler独占物理来源、批次、coverage、retry、controlCurrent；`setHistoryGrants`是attach/regrant seam | cache可先读，current必须来自当前generation与覆盖；撤权停止目标义务，再授权恢复同一未完成revision | 没发现第二网络调度器；root-turn投影计数边界已存在，确定缺口是Gateway历史投影删掉完成turn中已发送给参与者的早期`stage:text`正文；机械process历史省略符合用户要求（P1/范围阻塞） |
| Waiting facts / permissions / fixed48 | Replica fold独占canonical lifecycle；Outbox只拥有ledger前local intent；WaitingPresentation无状态派生；roster authority只裁动作资格 | unknown/departed仍显示canonical queued但只读；终态只由Replica移除；同ActorID TERM restart现有OBS不可辨；48px只代表收起态reserve且默认展开不变 | 旧“roster可裁restart/删除queued”结论撤回；content/controls completeness与集合partial未接。fixed48是当前明确简化选择；源码保留可达的收起/展开及内部滚动，不再自行增加动态遮挡几何门 |
| submission / draft / view | IndexedDB Outbox/Draft是durable owner；`acceptDraft`原子CAS；receipt只改outbox，accepted feed经Replica后reconcile；Presentation只读local echo | 新输入不被旧accept清除；重试同ID；reconnect只是传输资格，不是成员授权 | consumer port与live batch/roster producer现以同一principal-owner token交接；附件集合仍以render mirror跨await读取（P1） |
| list / Admission / role / Content | ReadingSession拥有阅读意图；唯一adapter是Virtuoso薄层，内建follow=false，应用只有一个`root.scrollTo`入口；Presentation拥有rows/changes；ContentPlan拥有块身份 | prepend/role/content只提交事实，不自造阅读授权；latest必须exact authority；内容identity在合法续写中稳定 | Presentation、RoleFinalizer及Reading/Timeline提交边界按本卡原source另审；semantic text-point无consumer因用户取消该恢复范围而不是交付缺口 |

## 1. 通知：accepted arrival、视图unseen与频道read不是一件事

### 唯一权威与入口

- `useChannelFeed.applyRows`在accepted live Replica commit后调用`recordLiveTimelineArrival`；cache/history、自发消息、
  processing revision与重复终态不制造新arrival（`src/app/hooks/useChannelFeed.js`、`src/model/fold.js`）。
- `createController`内的`unseenRecords`属于一个`channel + viewKey + activation`阅读会话，并通过ViewSession持久化；
  adapter只上报当前DOM命中的stable row identity与seq（`src/ui/timeline/useReadingSession.js`、
  `src/ui/timeline/LegendMessageList.jsx`）。
- `createCursors`分别保存频道physical read seq与exact message identity ack。`history-demand.js`只允许当前
  channel/view/activation/generation/source receipt写入；filtered或browsing只产exact identities，无过滤All且
  following+tail才产physical seq。因此旧“filtered tail直接推进physical cursor”的源码反例在当前边界已消失。

### 生命周期与当前缺口

正常链是 `Replica arrival → 当前Presentation identity → 同revision viewport observation → visible丢弃或unseen发布 →
exact/physical read receipt`。当前源码已有明确的原子交接结构：Timeline以token登记mounted consumer；Reading只在controller的
pending为零、事件已得到visible、持久unseen或更新projection证明out-of-scope的disposition后，才确认Replica journal的
throughRevision。activation替换从Replica acknowledgedRevision重新取未决事件；短暂零consumer也不会确认先前已被viewport
接手但尚未dispose的backlog。因而“stage进controller后立即全局ack、切activation丢失”是审核过程中已经失效的旧反例，
不再列当前P0。仍须以行为证据覆盖卸载/注册间arrival、bounded overflow合并以及scope切换的logical identity，但静态结构已有
单一journal与交接token，不能把这些待证边界误写为确定丢失。

另有commit风险：`useReadingSession`仍在render写session/snapshot/history/markRead refs。已提交adapter的range/layout/scroll
回调及document visibility listener会读它们；旧DOM的visibleRows可能与候选snapshot/source revision拼成一张receipt。
这是一条真实外部事件调用链，不是单纯“发现ref赋值”。

## 2. Scheduler：cold、regrant与controlCurrent

### 唯一权威、写入口与生命周期

- `SyncCoordinator.interest`拥有进入、重选、回前台等有限freshness obligation；connection/admission epoch拒绝旧probe。
- `HistoryScheduler`独占cache/network选择、`history_before`/cancel、reservoir、coverage、foreground owner、retry与
  `controlCurrent`。UI只经HistoryDemand打开语义operation；没有Waiting专用poller或第二cursor。
- `setHistoryGrants`同步安装当前generation的grant/meta；Boot不匹配先reset内存世界。definitive forbidden经双generation
  fence撤目标scheduler/access/self；同频道重新出现在后续grant Set时，admission恢复尚未fulfilled的interest revision。
- cache可先形成readable projection，但只有当前attach generation与连续tail证据能令`messageCurrent/controlCurrent`为真；
  authoritative empty还要求head=0、本地恢复已决与sync obligation current。

foreground definitive forbidden也已回到同一authority链：SyncCoordinator先用connection/admission epoch拒绝旧probe，再把当前
channel移出admission并停止retry；useChannelFeed复核attached generation后调用Scheduler targeted revoke、`access.forbidden`、
roster self清理及一次目录失效。普通unavailable不撤权，下一attach generation经同一`setHistoryGrants`可恢复未完成interest。
当前静态路径未见第二access owner或后台补偿poller。

### 当前缺口

`HistoryPresentationAdmission`已经把render候选与owner发布拆开：Timeline render只调用`evaluate`取得immutable receipt，
layout commit后才以owner identity、authorityRevision、phase、viewID和epoch复核并`commitCandidate`；旧的
`projectTimeline → admit → render内改phase/committed`反例在当前源码失效。后续`prepareCommit/bindPresentation/acknowledge`
也只从已提交layout链进入。本审核因此不再把Admission自身列为render-side-effect P0。

`completeConversationUnits`计数`projectTimeline`的非narration项；这里的项已经是`orderedTimeline`形成的root turn或standalone，
而不是任意raw response。带`parent_id`但request尚未到达的response保存在Fold `_unmatchedByParent`，不会成为可见orphan；
较老request到达时才按seq合流为同一个turn。因此，仅凭`kind !== narration`不能证明前端缺少semantic-unit结构，也没有理由
再建一个与Presentation/Fold并列的`ConversationHistoryProjection`权威。

确定的完整性反例在**来源内容**而不在unit计数：

1. [turn-process.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/turn-process.js:16)
   把每条`stage:text`定义为“已经发给参与者的正文”，只把最后一条与terminal完全相同/前缀相同的echo交接；
   更早的stage明确“一个都不能少”。Timeline在terminal后仍渲染这些正文。工具、thinking等机械process走另一条
   `executionProcessObservations`/`ProgressTrail`路径，不能与participant text混为一类；实际终态渲染见
   [Timeline.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/Timeline.jsx:594)。
2. Platform [history.go](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll/platform/channelspec/history.go:25)
   的公开结构语义已经写明“完成request保留terminal、开放request只保留latest provisional”，实现
   [projectHistoryWindow](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll/platform/channelspec/history.go:150)
   在terminal parent存在时排除所有nonterminal response；[mock/server.mjs](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/mock/server.mjs:420)
   实现相同过滤。这会删除完成前的所有早期`stage:text`和process。
3. 因而同一完成turn在live/现有cache里可含全部provisional，而fresh device或cache丢失后经`history_before`只剩
   request+terminal。Admission仍把它计为一个完整turn并结束该unit需求，无法补回已经被View删掉的participant text。

这不是前端“再做一个unit聚合器”可修的缺口，而是既有Gateway History View的source-fidelity产品裁决。用户明确不想加载
历史机械process，所以tool/thinking/plan被历史投影删除是预期能力边界，不是缺口；唯一冲突是`stage:text`已经被当前前端
定义并呈现为参与者正文。要么产品明确它也只是live/cache瞬态，并同步修改“参与者正文/更早stage不能少”的现语义；要么
History View须保留这类participant text。当前前端-only边界不允许悄悄改协议或另发请求，所以本卡将其列为范围阻塞，
而非已批准的前端施工。

## 3. Waiting：事实、成员权限、工作currentness与fixed48

### 两类权威必须分开

- 服务器生命周期：`Gateway validated row → ChannelReplicaStore/Fold → selectWaitingPresentation → WaitingLayer`。
  terminal吸收、乱序合流和trim-safe closure只由Replica裁决；Waiting不持久化第二份queued/terminal。
- ledger前本地意图：durable Outbox row可在canonical request到达前显示；相同message ID完成local→canonical handoff。
- member currentness：`createWaitingTargetAuthority`绑定principal/channel/feed generation、complete roster与exact actor ID；
  `taskControlContext`用它把receiver-directed controls降为unknown/departed只读。caller自己queued request的单条cancel另由
  ownership+write access裁决。
- work/control currentness：canonical queued是否仍开放只来自Replica lifecycle与Scheduler `controlCurrent`，不能由roster删除。

这修正旧六链卡中过宽的判断：当前后端restart可在同ActorID下换TERM，OBS roster行不变；roster exact join只能证明
离席/删除重建，不能证明同ID restart后的旧queued仍可操作。unknown/departed不应删除canonical fact，终态仍由Replica移除。

### 当前能力缺口

设计要求逐项`contentComplete/controlsComplete`与集合partial，但selector/Waiting props没有这些字段；当前只是从最新
queued/processing frame读取controls，并用roster currentness门控。scan-limited history或compact closure缺正文时，UI没有
统一partial/completeness语义，不能声称Waiting集合或正文完整。

布局owner仍单一：Surface只测input slot，Waiting在absolute floating sibling，Virtuoso Footer从首帧恒留48px。
这保证Waiting mount不会改变Surface外框；用户选择的fixed48只定义**收起态**永久留白，不等于展开层实际高度。
`WaitingLayer`初始化`collapsed=false`，旧[F19](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/USER-REPORTED-ISSUES-RECONCILIATION.md:57)
也明确运行状态不得擅自把默认展开改成每次收起；所以“默认折叠以适配48px”
不是合法解法。展开层可高至420px且内部滚动，超出固定留白的部分向reading覆盖；这是当前fixed48简化方案的真实覆盖范围。
源码中的header收起按钮、展开按钮、任务控件与层内滚动是当前操作可达机制；本卡不把旧F21自动继续解释成一个新增的动态
resize/保锚硬门。

在用户明确选择fixed48简化后，本卡不再自行加入动态reserve、resize或保锚施工。当前可要求且不改变选择的最小一致性是：
保持默认展开；展开/收起和任务操作始终命中；用户收起后，48px reserve对应真实、稳定、无遮挡的正文边界。静态几何同时
证明，展开层超过48px时仍可能覆盖正文；因此若“展开时当前阅读也绝不被遮挡”仍是硬要求，它与“恒定48 + 保持现有默认
展开尺寸”不能由当前结构同时满足，必须由产品另行取舍一个约束，不能把审计意见伪装成已批准实现。

## 4. Submission：durable ledger、commit ports与view合流

### 唯一权威与生命周期

- `outbox-store.js`以`principalId + channelId/messageId`持有draft与submission；`acceptDraft`在一个IDB事务内写固定ID frames并
  条件消费exact editor revision。较新editor revision保留，临时blob/不可恢复附件不能伪装durable。
- 生命周期是`draft → queued → transmitting → accepted/delayed|uncertain|rejected → landed`。lease减少多tab并发；
  wire submit前再次读取当前access，receipt不写Replica，feed以相同message ID成为最终ledger事实后才清outbox。
- local agent request进入Waiting local seam；普通local echo进入Presentation；两者都在accepted feed后按同ID归一。
- AppShell的per-owner Composer port、useSubmissions的principal/wire ledger refs、Composer长寿命ProseMirror事件refs在当前源码
  都于layout commit原子发布并带identity cleanup；此前render-ref反例是历史，不再列当前缺口。
- App的accepted feed reconciliation与roster async共享一个layout-committed
  `committedFeedOwner = { principalId, generationFor, reconcile }`；这关闭了candidate render提前替换consumer port。App自己发起的
  `refreshRoster`也跨await复核同一owner对象。

### 当前跨层缺口

审核中发现的旧producer迟到入口也已在当前源补齐：principal变化会产生新的immutable producer token；`enqueue/checkpoint`把
token带入frame batch，每个accepted row继续把token带到submission facts和由该row触发的async roster callback；App consumer只在
token对象与当前committedFeedOwner完全相同时接收。因而P1 principal的迟到live batch不能由P2 consumer处理，A→B→A也不因
principal字符串相同而继承旧对象。该边界只证明principal owner交接；live attach generation的账本接纳仍由既有wire/Scheduler
generation fence负责，不能从这个token额外推导。

另一边界是`draftAttachmentsRef`：它在render镜像附件集合，上传任务跨await读取，用来选择当前频道附件名与合并结果。
被abandon的候选render可改变已提交上传任务的去重输入。该ref不是Outbox/Draft命令ledger，也不拥有服务器事实；这是附件展示/
合并的commit一致性P1，不能误报成durable submission ledger出现第二owner。

## 5. List、History Admission、latest role与Content identity

### 已形成的单链

- 当前生产只有Virtuoso 4.18.13薄adapter；`followOutput={false}`，应用源码只有一个连续几何写入口
  `root.scrollTo({top: root.scrollHeight})`。ReadingSession的activation/inputEpoch/mode/intent是授权，公开list/layout事件只触发
  当前授权复核；Content和Waiting没有主滚动写入口。
- current-entry候选由Presentation给出；ReadingSession把exact epoch/view/source/candidate与coverage(candidate→head)组合成
  authority；role finalizer再发布`roleRevision/roleChanges`。loaded tail或`bottomReady`自身不是latest权威。
- Markdown ContentPlan从最近已提交plan推导候选，只在layout commit发布；稳定contentKey/blockID、answer logical slot与
  append parser路径不持滚动权，也没有第二virtualizer。

### 当前提交边界问题

两层owner仍在React render中推进内部状态：

1. `createConversationPresentation.project`改rows/signatures/entries/indexes/revision/snapshot；abandoned候选会成为下一次diff base，
   令真实后续commit漏报或误报insert/update/prepend。
2. `createConversationRoleFinalizer.finalize`改latestID、roleRevision与cached snapshot；abandoned latest候选可产生未commit的
   role transition，下一次render再反转并制造phantom `roleChanges`/height admission。

另外，Timeline的`readingControlRef/editRuntimeRef`仍在render发布：已提交MessageLayoutStore点击可命中未提交viewport controller；
edit cleanup或迟到hold完成可用候选state/capability发unhold。adapter的`initialLocationRef`也在render消费一次性候选。
这些与`useReadingSession`ref问题共同说明“唯一writer”成立，但writer所读owner尚未全部commit-bound。

### 内容能力边界

当前ContentPlan能保持合法续写中未改块的DOM身份；匹配的最后stage:text→terminal复用同一answer slot，真正改写或结构化终稿
显式新slot。Content已有`blockID/textOffset/context`描述与resolver，而列表initial/restore只消费row identity与row offset。
这个“resolver未消费”现在只是未使用的能力，不是交付缺口：用户已明确取消任意历史消息/pixel恢复，刷新从底部开始；不得以
内部已有resolver为由重新扩充该需求。同一文档内的内存row/message恢复也不要求定位到原段落字符。

任意跨虚拟回收的原生Selection仍没有bounded pin；但它是独立选择/复制能力，只有用户另行要求跨回收保持Selection时才进入
交付范围，不能再借“阅读恢复”自动升级。已挂载块在合法续写中的DOM/Selection连续性仍是当前已有能力。

## 当前结构裁决

本卡两个source boundary都未发现“双Replica、双Scheduler、双Waiting terminal store”。以下1、4只保留页尾首轮manifest的
当时结论，未在本次三项续审重签；2、3才是本次需求重判后的裁决：

1. React候选render仍能推进Presentation、role以及Reading/Timeline事件owner；
2. Waiting completeness/同ActorID restart能力仍无对应事实；fixed48只属收起态，但这是用户明确接受的当前简化，不列动态reserve/resize阻断；
3. 前端root-turn unit边界已有；确定缺口是Gateway历史投影删除完成turn中已发送给参与者的早期`stage:text`正文；机械process历史省略不是缺口；
4. 附件上传仍从render mirror跨await读取合并输入。

semantic text-point无consumer已从阻断清单删除：这是用户明确取消的恢复范围，不是待施工项。

filtered read现已按exact/physical分权；arrival handoff、History Admission、foreground definitive forbidden、App feed/roster
producer-consumer token与Composer内部事件port也已有commit/epoch边界。
这些结论各自只绑定相应manifest，不应跨source boundary继承或继续沿用更早版本的反例。
反过来，本卡也不把任何定向测试或旧浏览器轨迹升级为整链行为验收。

### 三项续审源码 manifest

```text
src/model/turn-process.js f6aa8d7e9c9fdf6c9cc67afc312a6771ab9c773e
src/model/history-presentation-admission.js 161df4fda805895d983486423a5801b744e3b21e
src/model/timeline-projection.js 8aa0fc21b6cc506af8f8f23f7d422a5f77ca2681
src/model/fold.js 6128df1d2b0a1f2afb4d3772a90a6b293c876205
mock/server.mjs 83ae40566de731a0d2520de4939ec3eae283e955
src/ui/Timeline.jsx 2b7e0a0d7f11e1efed14aa7200a3400e7d16556b
src/ui/conversation/ConversationSurface.jsx 3736b25fd85633fd0bb68bd49cc5d3a36b5acfb5
src/ui/timeline/LegendMessageList.jsx 8ba4b51ccfee9746074dcacca0540e0178169658
src/styles/app-shell.css f3be48c936e4a196d9824a0ef6866289666a67d6
src/styles/timeline.css dffc67b4db0a2ab2076940795cc66b7f4d921b07
src/model/content-plan.js 2afd6ce9cee64911dd903caba30f0c693d67b85a
src/ui/ContentPlanBlocks.jsx 55d5667691b93c4a012a80a81d014b5f75221805
../atoll/platform/channelspec/history.go 55766fba78d11112d9adc5cdd96c9778625f539c
```

## 源码 manifest

以下顺序、路径与Git blob组成上面的整体指纹；任一项变化后，本卡状态必须重新静态核对，不能继承：

```text
src/app/hooks/useChannelFeed.js fd64dd34db6a5e7f3db280874828ddbdcddd0f02
src/model/fold.js 6128df1d2b0a1f2afb4d3772a90a6b293c876205
src/model/cursors.js 8a46a067e1c3f1bff8eb47993f3e78c583f877f0
src/model/history-demand.js 00a012f3eb563eeb9efefd5ed513adb19536086c
src/ui/timeline/useReadingSession.js 689b849804ccae65ac8edb2bb9d5f88e6669919a
src/ui/timeline/LegendMessageList.jsx 5edd27b3ec5df764fdd81ebf4410d609a3a3ecdf
src/model/history-scheduler.js f8f6243d4f1b9e4c51c3e29ec7d85c80be69b44b
src/model/sync-session.js c0158eb2c3a3b5c58a7e3e6f820a41e37f805075
src/model/history-presentation-admission.js 161df4fda805895d983486423a5801b744e3b21e
src/model/waiting-presentation.js 0abb496f9a59ba9fa08c5b8771652b7d8dc948e9
src/model/task-controls.js 260965896332b739729c301e95907fea0772de2a
src/ui/Timeline.jsx 9dc99931f5df1484ebd39eb1282ffdb16ef9c902
src/ui/conversation/ConversationSurface.jsx 3736b25fd85633fd0bb68bd49cc5d3a36b5acfb5
src/app/AppShell.jsx 337a6faa33291669893fe0f07cf2db1557855f56
src/app/hooks/useSubmissions.js c9d49c257c654a823d88490b49971800c724ad20
src/ui/Composer.jsx ac60e0347a29c29754cf3011fd06bc322996a486
src/model/outbox-store.js ff4b8271920d38997760142657b0e28081089789
src/model/conversation-presentation.js 421c96baac15b7d382ff2836e0aa9115d05e2022
src/model/content-plan.js 2afd6ce9cee64911dd903caba30f0c693d67b85a
src/ui/MarkdownContent.jsx 8771ef40d5612f071005828c11ef8592dd97860d
src/App.jsx a47e37f1d34bb095834a68bc2879235c5a952081
```
