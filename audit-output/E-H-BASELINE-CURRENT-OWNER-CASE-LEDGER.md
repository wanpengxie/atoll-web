# fae8b70 顶层 Vitest E–H 当前 owner case ledger

基线：`fae8b7010afd1b3a950bc455ba6a577b65378cda`。检查范围是
`tests/` 顶层、basename 以 E、F、G 或 H 开头的 `*.test.js` / `*.test.jsx`，
不含 `tests/browser/`。产品树检查点：`a8c91651315f9c2f225c11472f589e7cb605a772`，
共享工作树还包含其他 agent 的未提交当前 owner 替代测试。

## 计数和裁决口径

- 基线精确为 **26 个 suite / 256 个 it|test case（256）**；本报告逐条列出全部 case，26/26 suite 已读取，case 处置 **256/256**，未处理 **0**。
- HEAD 同名仍保留 6 套件 / 38 case；既有删改提交删除 20 套件 / 218 case。删除不是本轮“隐藏 import 失败”：每条旧 import、UX 能力和当前 owner 都在下表与 case ledger 中裁决；本轮不恢复旧 store/compat/vendor/package。
- 下表每个 suite 是一条可复查 contract record：C（用户能力）、I（架构不变量）、O（当前公开 owner）、S（原 setup/action/result 到当前 setup/action/result）、F（当前事实与处置证据）。case ledger 的每一行显式引用同 suite 的 C/I/O/S/F，因而不是只给 suite 级结论。
- 当前 owner 直接替代文件的新增证据：本 agent 的 `f6-accessibility` 2、`final-echo` 5、`foldable-body` 5、`history-demand` 5；共享树已有 f5/files/following/hook replacements。下表不把未提交他 agent 文件冒充本 agent 改动。
- 本 agent 只编辑 tests/report；未改 `src/`、`vendor/`、`package.json` 或旧模块。测试失败不以放宽断言、删 import 或产品补丁消除。

## Suite contract records（C/I/O/S/F）

| ID | 基线 suite | cases | C 用户能力 | I 架构不变量 | O 当前公开 owner / evidence | S setup → action → result | F 当前事实 / evidence | 处置 |
|---|---|---:|---|---|---|---|---|---|
| EH01 | `e2e.mock.test.js` | 12 | 登录/attach、历史、进度、场景控制和模型参数的可观察旅程 | attach 不带 body；历史 page 以 ref/seq/generation/correlation 配对；多频道/队列/FIFO 不串；since 不重复 | mock/domain.mjs + mock/server.mjs、src/net/{identity,wire}.js、src/model/channel-replica.js；证据 mock-phase-B/C/E、mock-protocol、mock-scenarios、wire、channel-replica | 旧 createMockServer/historyWindow/rawHistoryPage + fold；迁为当前 mock/wire fixture，动作仍为 attach/history/control/compute/resolve，结果由 receipt、Replica timeline 与 mock OBS 断言 | fold.js/turn-process.js 旧 import 已退出；12 条拆分到当前 mock/wire/Replica owner，未恢复 compat；完整旧单文件 e2e 不再是当前 public owner | 迁移/分拆；旧 helper 有意不恢复 |
| EH02 | `envelope.test.js` | 4 | 协议 envelope 状态与可见性解析 | FINAL 与 provisional 互斥；terminal 只由最终状态决定；correlation 缺失时稳定退回 id；未知 visibility fail-open 为 public 并留 warning | src/protocol/envelope.js；tests/envelope.test.js | 旧 envelope fixtures 直接调用 parser/status helpers；当前仍同一公开 module，逐条执行同一输入并断言 parser 输出 | 当前同名 4 条全绿，未发生 owner 迁移 | 保留/迁移完成 |
| EH03 | `f5-management.test.jsx` | 3 | 治理成员可见性、参与者/声明选择、搜索 SourceRef | 标准 system/peer 不得作为业务成员；genesis 声明不得重复候选；跨功能跳转只能携带规范 SourceRef | src/ui/features/governance/GovernanceFeature.jsx 的 ChannelAdministrationPanel、src/ui/features/search/SearchFeature.jsx；tests/f5-management.test.jsx、workspace-governance-features、feature-search、management-actors | 旧 ChannelGovernance/ActivityCenter/GlobalSearch；当前渲染治理成员 tab、SelectMenu、SearchFeature，动作是选候选/打开结果，结果为命令 payload/SourceRef | 搜索 SourceRef 已迁移；当前治理 panel 对原始 port.roster 和 genesis declarations 的过滤存在 2 条红证据，ActivityCenter/Operation Center 无公开 owner | 迁移/真实缺口 G1-G3；只交回归包，不补产品 |
| EH04 | `f6-accessibility.test.jsx` | 2 | 任务/搜索模态的焦点进入、Tab 困住、Escape 关闭、返回 opener | modal layer sibling 必须 inert/aria-hidden；关闭必须恢复 opener；操作未结束时不得逃逸/关闭 | src/ui/primitives/useModalFocus.js，经 TaskCreationDialog/SearchFeature；tests/f6-accessibility.test.jsx（当前迁移） | 旧 TaskCreateModal/GlobalSearch；当前点击 opener→渲染公开 dialog→键盘 Shift+Tab/Escape，结果检查 activeElement/inert/关闭 | 当前 owner 2/2 通过；未恢复旧 modal alias | 迁移完成 |
| EH05 | `f6-composer-isolation.test.jsx` | 11 | 发送起点/持久接收 correlation、Suspense 候选隔离、附件上传与编辑门 | 仅 committed command port 可写；send-start 单次；accept 只认稳定 message/correlation；旧 owner 晚到 settlement 不得覆盖新输入；编辑时禁止普通附件 | src/ui/composer/{Composer.jsx,command-port.js,useComposerSubmissionRuntime.js}、ConversationSurface/ReadingIntentContext；tests/offline-recovery、composer-model、composer-command-port、outbox-attachment-transaction | 旧 Composer + Timeline + Suspense/ProseMirror mock；当前通过 Composer model/command port/runtime harness 发送、持久化、上传，结果检查 durable outbox/intent/correlation | 旧 Timeline/Composer import 已拆；当前 owner 证据分散但覆盖稳定 owner、offline、attachment；11 条不再逐字复制旧 fixture | 迁移/分拆完成 |
| EH06 | `f6-performance.test.jsx` | 12 | 长列表预算、文件预览格式/字节上限、任务/源码窗口 | 工作集/DOM/字节有界；超限先拒绝或取消且不得建 URL；关闭/owner 替换取消晚到读；公开 UI 不依赖第二索引 | src/model/channel-replica.js、src/ui/features/{files,tasks}、src/app/hooks/useAttachmentTransactions.js；tests/memory-window、artifacts/artifact-preview-resolve、tasks-feature-restore、file-browser/right-panel-file-reference | 旧 list-window/artifacts/fold/TasksView/ArtifactContext；当前从 Replica/FilesFeature/ArtifactPreviewPanel/TasksFeature 公共 port 驱动长列表和 preview，结果检查窗口、ticket、Abort/URL | 旧私有 helper/list-window/ArtifactContext 已删；当前可测的是公开 feature port，内部 Prism/readBoundedText 不能私测；缺失项记录为 architecture decision，不造 export | 迁移/公开 owner 局部证据；旧私有性能 API 有意不恢复 |
| EH07 | `f6-tokens.test.js` | 2 | 浅色表面正文可读性和 token 单一声明 | 正文对比度 WCAG AA；颜色/阴影/视觉常量只在 tokens.css | src/styles/tokens.css；tests/f6-tokens.test.js | 旧 token CSS 读取与对比度计算；当前同文件同断言 | 当前同名 2 条全绿 | 保留/迁移完成 |
| EH08 | `feed-cache.test.js` | 19 | 频道缓存 owner、Meta/coverage、bounded read/resume 和 world 隔离 | 事务提交后才发布 Meta；owner/principal/world fence；cache 不能旁路 Replica；读取按 row/byte 界限，空洞不伪造 | src/model/channel-replica.js 的 createChannelReplicaCache/replicaResumeSnapshot；src/model/channel-feed-runtime.js；tests/memory-window、workspace-bootstrap-cache、channel-feed-runtime | 旧 createFeedCache + fake IndexedDB/MemoryStorage；当前 ensureOwner/saveRows/saveCoverage/readBefore/clear，通过 Replica/runtime 读写，结果检查 meta/rows/resume | feed-cache.js/localStorage v5 owner 已退出；当前公开 cache API 有证据，19 条旧事务细节由新 runtime/Replica 分拆承接，不恢复旧 store | 迁移/分拆；旧 API 有意删除 |
| EH09 | `file-browser.test.jsx` | 14 | 频道文件目录浏览、设备选择、预览/下载、分页和 owner 权限 | 目录操作走 attachment transaction owner；设备/频道切换隔离；读可用时写禁用；stale authority 不得落地 mutation | src/ui/features/files/FilesFeature.jsx + src/app/hooks/useAttachmentTransactions.js；tests/file-browser.test.jsx、channel-files、files-panel-lifecycle、right-panel-file-reference | 旧 ArtifactsView mock resource；当前用 attachment hook + FilesFeature harness，动作是 list/navigate/preview/download/create/delete/attach，结果检查 directory/selected/recent/wire | 当前替代文件已建立 14 行为条目，但共享工作树定向运行仍有目录选择/预览时机/分页 fixture 红和 timeout；不据此改产品，列 R1 待收敛 | 迁移/夹具待修 R1；未删 import、未加 compat |
| EH10 | `file-preview-stack.test.js` | 2 | 嵌套文件预览返回上层、重复打开去重 | preview stack 只有一个 owner；相同位置不造假层；有上一层时 close 等价 back | src/app/hooks/useAttachmentTransactions.js 的 previewStack；src/ui/features/files/ArtifactPreviewPanel.jsx；tests/file-preview-stack.test.jsx、right-panel-file-reference | 旧 pushFilePreview/popFilePreview 纯函数；当前通过 previewArtifact/backArtifactPreview 和 panel back/close，结果检查 selectedArtifact/canGoBack | 当前 2 条替代证据通过；旧 model/file-preview-stack.js 不恢复 | 迁移完成 |
| EH11 | `file-reading-history.test.js` | 2 | 最近阅读按频道/资源去重、有限持久化和 principal/world 隔离 | 只保留可恢复文件元数据；同频道资源去重且最近优先；不同 principal/world 不互读 | src/app/hooks/useAttachmentTransactions.js 的 recentFiles/readRecentFiles/writeRecentFiles；tests/file-reading-history.test.jsx、file-browser | 旧 file-reading-history pure helpers + localStorage；当前从 previewArtifact→port.recent 驱动，结果检查顺序/limit/无 secret/owner 隔离 | 当前 2 条替代证据通过；旧独立 history module 不恢复 | 迁移完成 |
| EH12 | `files-panel-lifecycle.test.jsx` | 2 | 文件 ticket/PUT/attach 的连续 owner 生命周期和编辑权限 | ticket+PUT 在同一 authority window；stale/revoked 不宣告成功；编辑/access 禁止 attach；不增补偿 round trip | src/app/hooks/useAttachmentTransactions.js + FilesFeature；tests/files-panel-lifecycle.test.jsx、channel-files/outbox-attachment-transaction | 旧 FilesPanel upload/read/attach；当前 mount attachment transactions 并 click FilesFeature，结果检查 create/PUT/authority error/attach disabled | 当前 2 条替代证据通过；旧 FilesPanel/ArtifactContext 不恢复 | 迁移完成 |
| EH13 | `final-echo.test.js` | 5 | Agent 过程文本与终态答案不重复，截断前缀仍去重 | 只检查最后一条 observation；终态前不制造答案；空终态保留一个 terminal slot | src/ui/timeline/TimelineRowRenderer.jsx 内 AgentAnswer/finalEchoObservation；tests/final-echo.test.js（当前迁移） | 旧 turn-process pure helpers；当前构造公开 row→useTimelineRowRenderer→renderRow，动作/结果检查 agent-progress-text 与 agent-final-text | 当前 5 条全绿；旧 turn-process.js/withoutFinalEcho export 不恢复 | 迁移完成 |
| EH14 | `fold-admission.test.js` | 6 | 阅读中自动折叠 lease 随 append/activation/following 正确收放 | lease 只绑定当前 activation/visualSlot；following 或 activation replacement 立即撤销；不靠 size ack 持有第二状态 | src/model/browsing-fold-lease.js；tests/browsing-fold-lease.test.js、foldable-body | 旧 fold-admission 的 geometry/MVCP choice/size ack；当前按浏览 lease 与纯 content folding 驱动，结果检查 visualSlotIDs/模式切换 | size admission token/MVCP primitive 已在当前架构有意退出；4 条 lease 证据通过 | 架构迁移；旧 size-admission 不是产品 gap |
| EH15 | `fold-phase-b.test.js` | 4 | 请求树以 request id 归属、乱序 response 回填 provisional/terminal | response 不从 correlation 猜 owner；late request 可重建父子；terminal 后不 reopen；root/thread 稳定 | src/model/channel-replica.js rebuildState/rootRequestId/buildTurn；tests/memory-window、channel-replica | 旧 fold(rows) 直接投影；当前 commit row 乱序/重复→state.timeline，结果检查 request/thread/terminal/provisional | 旧 fold.js 已删；current Replica 单一重建 owner 已覆盖主要树/乱序合同 | 迁移完成 |
| EH16 | `fold.test.js` | 5 | 混合 stream 折叠为 turn/narration/approval，嵌套和 late parent 不错挂 | 单一 canonical rows；nested child 只能挂真实 parent；未见 parent 的 exposed root 后续可收敛但不臆造 | src/model/channel-replica.js + src/model/conversation-presentation.js；tests/memory-window、conversation-presentation-scope/identity | 旧 fold/apply/orderedTimeline + turn-process；当前逐 row commit/Presentation evaluate，结果检查 timeline/thread/scope/coverage | old fold/turn-process/store 不恢复；current Replica/Presentation evidence exists | 迁移/分拆完成 |
| EH17 | `foldable-body.test.jsx` | 15 | 正文默认折叠/展开、latest exemption、CJK/长段落稳定阈值和焦点可达 | foldCandidate 纯内容判定；explicit override 优先；折叠只移出边界外 focusable，展开恢复属性 | src/ui/timeline/FoldableBody.jsx；tests/foldable-body.test.jsx（当前 5 条）及 browser fold/reading tests | 旧 Timeline + fold state fixture；当前直接渲染 FoldableBody/children，动作 click toggle/exempt/override，结果检查 class/aria/button | 当前直接 owner 5 条全绿；旧 15 条中的 viewport/Presentation 组合由 browser/reading owner 承接，未造旧 Fold store | 迁移/分层完成 |
| EH18 | `following-tail-list.test.jsx` | 14 | following/browsing 共用一个 list executor，focus/resize/history boundary/owner handoff 正确 | 只有 committed VendorListExecutor 写 DOM；candidate/suspended render 不接管；坐标以 presentation absolute index；stale wake 丢弃 | src/ui/timeline/VendorListExecutor.jsx + ReadingContainerHandoff.jsx；tests/following-tail-list、reading-container-handoff、browser reading specs | 旧 FollowingTailList/LegendMessageList Suspense mock；当前 mock react-virtuoso public props，动作 range/materialize/focus/handoff，结果检查 list/revision/receipt | 旧 list duo 已退出；当前替代 3 条直接证据加 handoff/browser 证据，未恢复 vendor fork/compat | 迁移/分层完成 |
| EH19 | `frame-batcher.test.js` | 5 | 旧一帧批处理的可见更新及时落地（历史内部机制） | 不能重复 flush；hidden/flushNow/version fence 不丢可见事实 | 当前无 frame-batcher public module；职责由 channel-feed-runtime/Replica + VendorListExecutor/reading owner 分摊；tests/history-scheduler-modules、channel-feed-runtime、reading | 旧 createFrameBatcher 注入 raf/timer/hidden；当前不再有该注入 seam，改测 runtime/list 的公开 receipt/commit | src/model/frame-batcher.js 已删且没有第二 owner；旧 5 条是内部实现测试，不能恢复 compat | 有意删除/架构替换；无产品 gap |
| EH20 | `frame-fields.test.js` | 5 | upstream frame 字段白名单、origin/submit opaque body、public catalog | 未知字段序列化前拒绝；正文 opaque；公开 type catalog 必须是生效那份 | src/protocol/frame.js；tests/frame-fields.test.js | 旧 frame builder/parser；当前同公开 module 同输入/输出 | 当前同名 5 条全绿 | 保留/迁移完成 |
| EH21 | `frame.test.js` | 5 | v5 envelope、generation history、版本 mismatch、resource payload | 版本不兼容 fail closed；未知 downstream ignore；directory create 只走 resource payload | src/protocol/frame.js；tests/frame.test.js | 旧 frame encode/decode；当前同公开 module 同 action/result | 当前同名 5 条全绿 | 保留/迁移完成 |
| EH22 | `history-demand.test.js` | 6 | history intent/urgency、冷历史 obligation、presentation admission 和 exact owner settle | visual 只声明语义 demand；source/supply/progress/activation/view/generation fence；不暴露 scheduler/page/ack controls | src/model/history-demand.js constants + src/ui/timeline/history-consumer-obligation.js/useHistoryConsumer；tests/history-demand.test.js（当前 5 条）、reading-session-ports | 旧 createHistoryDemandPort/physicalReadSeq/exactReadIdentities/notificationReadSeq；当前由 obligation/reveal/admission/owner tuple 公开 helpers 驱动 | 79b59c1 已移除旧 read/notification ack exports；当前 5 条 semantic replacement 全绿，未恢复兼容 API；旧 exact-ack 行为由 current reading/notification browser evidence 分拆 | 迁移/架构分拆；旧 API 有意删除 |
| EH23 | `history-presentation-admission-react.test.jsx` | 2 | Suspense/candidate render 不得改变 committed presentation admission | 只有 committed layout owner 可 publish/hold；suspended render 不发布 candidate | src/ui/timeline/presentation-admission.js + React adapter；tests/history-presentation-admission-react.test.jsx | 旧 React harness + suspended candidate；当前同 owner/actions/results | 当前同名 2 条全绿 | 保留/迁移完成 |
| EH24 | `history-presentation-admission.test.js` | 20 | history prefix publish/renew/cancel/epoch/view/coverage 原子边界 | exact committed Reading owner、ordered subsequence、source revision/generation fence；stale receipt 不能 settle | src/ui/timeline/presentation-admission.js；tests/history-presentation-admission.test.js | 旧 pure admission transaction fixture；当前同公开 module 同 action/result | 当前同名 20 条全绿 | 保留/迁移完成 |
| EH25 | `history-scheduler.test.jsx` | 78 | bounded history acquisition、cache/network lanes、foreground/background demand、cancel/retry/attach handoff | physical executor 与 semantic owner 分层；bounded concurrency/bytes; one operation can promote; stale generation/owner cannot publish; local/network fallback exact | src/model/history-bounded-executor.js + history-source-adapters.js + channel-feed-runtime.js + useHistoryConsumer；tests/history-scheduler-modules、channel-feed-runtime、reading-session-ports/browser | 旧 useChannelFeed/createHistoryScheduler injection harness；当前 runtime/service graph harness，动作 enqueue/loadHistory/pageEnd/focus/cancel, result snapshot/status/Replica | old history-scheduler.js/useChannelFeed.js 已拆；78 条按当前 runtime modules/owner contracts 分配，直接 replacement 4 条模块证据，跨测试继续覆盖；不恢复 scheduler compat | 迁移/分拆；旧 scheduler API 有意删除 |
| EH26 | `hook-order.test.js` | 1 | 启动/未登录→已认证切换不触发 React hook 数量变化 | IdentityBoundary 的 early returns 与 AuthenticatedWorkspace hook list 隔离；早返回后不新增 hook | src/app/WorkspaceApp.jsx IdentityBoundary + AuthenticatedWorkspace；tests/hook-order.test.js | 旧 App.jsx 静态扫描；当前分函数扫描两个 boundary，结果检查 early return 后无顶层 hook | 当前共享工作树 replacement 2 条通过；旧 App.jsx 不恢复 | 迁移完成 |

## 完整 case ledger（256 条；每行引用 C/I/O/S/F）

| case | baseline test title | 用户能力 | 架构不变量 | 当前公开 owner | setup/action/result | 当前事实/处置证据 |
|---|---|---|---|---|---|---|
| EH01-01 | keeps attach body-free and completes a correlated history batch after its rows | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-02 | mock history pages on root turns and projects intermediate progress | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-03 | scheduler history pages are exact raw cursor batches after attach | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-04 | selects, inspects and advances deterministic scenarios through the control plane | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-05 | manually advances long-running agent computation through progress, terminal, and FIFO resume | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-06 | keeps A, B and D progress isolated while preserving the Agent request tree | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-07 | resumes only the targeted message after editing and keeps later messages queued | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-08 | keeps receipt acceptance separate from delayed feed landing | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-09 | emits isolated live demo events in both member channels when explicitly enabled | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-10 | logs in, folds replay and live turns, resolves approval, and resumes from since without duplicates | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-11 | 模型参数协议全链：describe 值域、context 当前值、select 周期与 sticky、单收件人门 | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH01-12 | select 旁路独占槽：忙时挂起、新覆盖旧（superseded）、turn 收口后插队生效 | EH01.C | EH01.I | EH01.O | EH01.S | EH01.F |
| EH02-01 | keeps final and provisional status sets disjoint | EH02.C | EH02.I | EH02.O | EH02.S | EH02.F |
| EH02-02 | only treats final responses as terminal | EH02.C | EH02.I | EH02.O | EH02.S | EH02.F |
| EH02-03 | uses correlation_id and falls back to id | EH02.C | EH02.I | EH02.O | EH02.S | EH02.F |
| EH02-04 | shows unknown visibility as public with a warning | EH02.C | EH02.I | EH02.O | EH02.S | EH02.F |
| EH03-01 | Channel Context 默认成员优先并隐藏标准 Actor | EH03.C | EH03.I | EH03.O | EH03.S | EH03.F |
| EH03-02 | 添加流程先选参与者，再按对象类型显示配置 | EH03.C | EH03.I | EH03.O | EH03.S | EH03.F |
| EH03-03 | Activity 与搜索都返回规范 SourceRef | EH03.C | EH03.I | EH03.O | EH03.S | EH03.F |
| EH04-01 | 任务弹窗进入后聚焦首字段、Tab 不逃逸并在关闭后恢复来源 | EH04.C | EH04.I | EH04.O | EH04.S | EH04.F |
| EH04-02 | 全局搜索将背景设为 inert，Escape 关闭并恢复焦点 | EH04.C | EH04.I | EH04.O | EH04.S | EH04.F |
| EH05-01 | creates one bottom intent at send-start and acceptance only consumes its correlation token | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-02 | F6-PERF-06 逐字输入不重新渲染独立的 Timeline 表面 | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-03 | Composer send-start emits once and durable acceptance only correlates the stable id | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-04 | keeps deferred ProseMirror draft persistence on the last committed owner while a same-channel candidate render suspends | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-05 | keeps ProseMirror Enter authority on the committed send port when a same-channel candidate suspends | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-06 | captures send authority before deferred durable acceptance and never refreshes it on resolve | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-07 | does not emit an acceptance event when durable write fails after the one send-start | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-08 | releases the durable-accept mutex before transport settles and retains an older late rejection | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-09 | clears the accepted editor version without clearing newer input typed during durable acceptance | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-10 | does not send a text-only snapshot while a selected attachment is still uploading | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH05-11 | disables every normal-draft attachment entry while editing an existing message | EH05.C | EH05.I | EH05.O | EH05.S | EH05.F |
| EH06-01 | 固定窗口对一万项投影保持 120 项上限 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-02 | 同一账本版本复用动态排序和产物索引 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-03 | 任务集合不超过一个 DOM 窗口 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-04 | 文本文件定位并标记消息链接指定的行号 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-05 | Markdown 默认渲染文档并允许切换到高亮源码 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-06 | 文件面板只保留标题栏和阅读区，Markdown 切换放在关闭按钮左侧 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-07 | 源码使用 Prism 语法着色并显示行号 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-08 | 按文件名和媒体类型选择成熟预览格式 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-09 | 文本流超过 512 KiB 时立即取消 reader | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-10 | 已知超限文件在申请 ticket 前安全降级 | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-11 | 服务端声明大小或实际 Blob 超限时不创建 Object URL | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH06-12 | 关闭预览会取消 fetch，且不为晚到的 Blob 创建 Object URL | EH06.C | EH06.I | EH06.O | EH06.S | EH06.F |
| EH07-01 | 语义文本色在实际浅色表面达到 WCAG AA 正文对比度 | EH07.C | EH07.I | EH07.O | EH07.S | EH07.F |
| EH07-02 | 颜色、阴影与视觉常量只在 tokens.css 声明 | EH07.C | EH07.I | EH07.O | EH07.S | EH07.F |
| EH08-01 | cancels pre-transaction owner selection without letting delayed old-world encoding cross the new owner | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-02 | publishes in-memory Meta only after its IndexedDB transaction commits | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-03 | keeps the last committed Meta when global trimming rolls back | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-04 | does not publish zero-fact coverage when its transaction rolls back | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-05 | publishes quota-recovery trims and the retry only after each transaction commits | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-06 | does not publish a principal owner when its transaction rolls back | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-07 | publishes zero-byte row deletion and continues global trimming | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-08 | changes principal ownership in place instead of requiring a page reload | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-09 | does not assign ownerless legacy rows to whichever principal opens them first | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-10 | derives the resume cursor from lightweight channel metadata | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-11 | removes the unbounded localStorage v5 cache during IndexedDB migration | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-12 | redacts device keys and nested credentials before IndexedDB persistence | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-13 | reads rows by reverse cursor in bounded batches and never restores bodies wholesale | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-14 | keeps a transactional per-channel FIFO of the latest rows | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-15 | restores an unread suffix beyond one presentation batch with its older parent lifecycle | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-16 | keeps notification restoration unknown when a cached terminal has no parent request | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-17 | persists empty projected scan coverage and resets IndexedDB on boot change | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-18 | does not adopt unidentified cached rows into the first observed server world | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH08-19 | keeps a newer zero-fact checkpoint without claiming an unknown gap | EH08.C | EH08.I | EH08.O | EH08.S | EH08.F |
| EH09-01 | opens the configured storage device instead of the first daemon row | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-02 | opens a directory with one row click without previewing it | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-03 | previews a file from the row and reserves the trailing action for download | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-04 | reopens a recently viewed file without navigating back to its directory | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-05 | creates a directory through resource create and then refreshes | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-06 | loads the next backend cursor and merges the page | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-07 | creates inside a non-ASCII directory without double-encoding its parent | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-08 | does not let a completed mutation refresh overwrite a newer directory | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-09 | returns to the root when the active channel changes | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-10 | sorts loaded rows from the column headers | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-11 | keeps reads available while disabling every mutating row action | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-12 | routes directory reads through the file operation owner port | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-13 | does not issue a delete when the captured file owner is stale | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH09-14 | keeps a rejected durable attachment out of the composer projection | EH09.C | EH09.I | EH09.O | EH09.S | EH09.F |
| EH10-01 | 文件 A 内打开 B 后，关闭 B 回到 A | EH10.C | EH10.I | EH10.O | EH10.S | EH10.F |
| EH10-02 | 重复打开同一位置只更新当前项，不制造假的返回层 | EH10.C | EH10.I | EH10.O | EH10.S | EH10.F |
| EH11-01 | 按频道和资源去重，把最近打开的放在最前 | EH11.C | EH11.I | EH11.O | EH11.S | EH11.F |
| EH11-02 | 只持久化有限的文件元数据，并按 principal 隔离 | EH11.C | EH11.I | EH11.O | EH11.S | EH11.F |
| EH12-01 | keeps ticket, PUT and readable confirmation inside one owned operation | EH12.C | EH12.I | EH12.O | EH12.S | EH12.F |
| EH12-02 | does not call attach while edit/access policy disables the action | EH12.C | EH12.I | EH12.O | EH12.S | EH12.F |
| EH13-01 | 末条与答案相同 → 丢掉末条,中间那些一个不少 | EH13.C | EH13.I | EH13.O | EH13.S | EH13.F |
| EH13-02 | 末条是被截断的前缀 → 同样丢掉 | EH13.C | EH13.I | EH13.O | EH13.S | EH13.F |
| EH13-03 | 末条是真正的过程正文 → 一个都不能丢 | EH13.C | EH13.I | EH13.O | EH13.S | EH13.F |
| EH13-04 | 只看末条,中间的碰巧同文也不动 | EH13.C | EH13.I | EH13.O | EH13.S | EH13.F |
| EH13-05 | 还没有终态 / 没有过程文本 → 原样返回 | EH13.C | EH13.I | EH13.O | EH13.S | EH13.F |
| EH14-01 | disables size MVCP only for an expand commit and closes on its matching growth ack | EH14.C | EH14.I | EH14.O | EH14.S | EH14.F |
| EH14-02 | keeps collapse on normal size MVCP and records its shrink acknowledgement | EH14.C | EH14.I | EH14.O | EH14.S | EH14.F |
| EH14-03 | closes expand admission synchronously when a rapid inverse returns to acknowledged geometry | EH14.C | EH14.I | EH14.O | EH14.S | EH14.F |
| EH14-04 | does not create a revision or admission for the same visible choice | EH14.C | EH14.I | EH14.O | EH14.S | EH14.F |
| EH14-05 | cannot let a stale activation or superseded item ack consume the current token | EH14.C | EH14.I | EH14.O | EH14.S | EH14.F |
| EH14-06 | restores normal policy when the owning list unmounts | EH14.C | EH14.I | EH14.O | EH14.S | EH14.F |
| EH15-01 | uses request id as the key and allows multiple requests in one correlation | EH15.C | EH15.I | EH15.O | EH15.S | EH15.F |
| EH15-02 | reconciles state and process responses that arrive before their request | EH15.C | EH15.I | EH15.O | EH15.S | EH15.F |
| EH15-03 | preserves core and namespaced provisional and never reopens after the first terminal | EH15.C | EH15.I | EH15.O | EH15.S | EH15.F |
| EH15-04 | never guesses a response owner from correlation_id | EH15.C | EH15.I | EH15.O | EH15.S | EH15.F |
| EH16-01 | folds a 12-row mixed stream into turns, narration, and approvals | EH16.C | EH16.I | EH16.O | EH16.S | EH16.F |
| EH16-02 | hangs the calls a turn made under that turn instead of beside it | EH16.C | EH16.I | EH16.O | EH16.S | EH16.F |
| EH16-03 | keeps a call whose parent this channel never saw | EH16.C | EH16.I | EH16.O | EH16.S | EH16.F |
| EH16-04 | does not reparent an exposed root when an older history page reveals its parent | EH16.C | EH16.I | EH16.O | EH16.S | EH16.F |
| EH16-05 | keeps publishing an exposed child root after a late parent arrives | EH16.C | EH16.I | EH16.O | EH16.S | EH16.F |
| EH17-01 | 短文本不折，长文本折，按行数或字符数二者取一 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-02 | 无换行的中英文长段落也按稳定的显示宽度估算 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-03 | 长正文默认折起，带"展开全文"；点开后展开，再点收起 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-04 | 短正文没有按钮 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-05 | 折叠资格不读 scrollHeight；只有实际折叠后才观察焦点边界 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-06 | 只把裁剪边界外的控件移出 Tab 序列，展开时精确恢复属性 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-07 | 例外位置（最新一轮）默认展开但仍可手动收起 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-08 | 历史长正文默认折起，当前 Presentation 的最后一条答案默认展开 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-09 | append 后无 override 的旧 latest 转为历史折叠，新 latest 默认展开 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-10 | 读者显式展开的正文不因 append 或重渲被默认推翻 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-11 | 忽略旧 tail 默认展开缓存，但保留读者跨重挂的显式 foldOverrides | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-12 | 用户手动收起 latest 后，流式追加和 terminal 都不推翻 override | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-13 | 未操作的 processing latest 在 terminal 后仍保持默认展开 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-14 | 中间正文与最终答复共用整段对话的展开和收起范围 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH17-15 | 同一 processing 阶段追加正文时不重建全量投影但仍更新可见内容 | EH17.C | EH17.I | EH17.O | EH17.S | EH17.F |
| EH18-01 | uses the presentation absolute coordinate for tail row revisions and materialization | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-02 | renders the authoritative history start before the oldest row only when the tail window contains it | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-03 | removes the outgoing scroll subscription when the following adapter is dormant | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-04 | drops a queued following observation after the adapter becomes outgoing | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-05 | keeps committed reading and snapshot ownership when a candidate render suspends | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-06 | preserves descendant focus when a presentation rerender requests following focus | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-07 | focuses following when a real handoff requests focus from outside the adapter | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-08 | reopens one short-list demand when supply advances without a Presentation revision | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-09 | remeasures the committed DOM before replaying a supply-progressed wake | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-10 | retires a queued supply wake when the committed DOM fills before settlement | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-11 | remeasures a resize-only filled-to-underfilled transition without polling | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-12 | grows only exact live back inserts in the existing row DOM and settles before navigation | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-13 | does not animate progress, history prepend, or a row owned by Waiting handoff | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH18-14 | installs directly when an existing row owns focus or a text selection | EH18.C | EH18.I | EH18.O | EH18.S | EH18.F |
| EH19-01 | 同一帧里的行合成一批,顺序不变 | EH19.C | EH19.I | EH19.O | EH19.S | EH19.F |
| EH19-02 | 下一帧重新开一批,恒不把上一批再落一次 | EH19.C | EH19.I | EH19.O | EH19.S | EH19.F |
| EH19-03 | 页面不可见时改走定时器 | EH19.C | EH19.I | EH19.O | EH19.S | EH19.F |
| EH19-04 | flushNow 立刻落地 | EH19.C | EH19.I | EH19.O | EH19.S | EH19.F |
| EH19-05 | 版本不兼容时丢弃尚未落地的一帧 | EH19.C | EH19.I | EH19.O | EH19.S | EH19.F |
| EH20-01 | attach 带着这条连接的自称 | EH20.C | EH20.I | EH20.O | EH20.S | EH20.F |
| EH20-02 | resolve 同时容得下人给的答复和客户端给的结果 | EH20.C | EH20.I | EH20.O | EH20.S | EH20.F |
| EH20-03 | submit 的 body 是不透明的一块,盖在里面的 origin 不受白名单管 | EH20.C | EH20.I | EH20.O | EH20.S | EH20.F |
| EH20-04 | 仍然拒绝真正未知的字段 | EH20.C | EH20.I | EH20.O | EH20.S | EH20.F |
| EH20-05 | 对外暴露的清单就是生效的那一份 | EH20.C | EH20.I | EH20.O | EH20.S | EH20.F |
| EH21-01 | builds the exact v5 envelope and requires generation-tagged history | EH21.C | EH21.I | EH21.O | EH21.S | EH21.F |
| EH21-02 | rejects version mismatch and must-ignore unknown downstream types | EH21.C | EH21.I | EH21.O | EH21.S | EH21.F |
| EH21-03 | parses known downstream frames | EH21.C | EH21.I | EH21.O | EH21.S | EH21.F |
| EH21-04 | blocks unknown upstream fields before serialization | EH21.C | EH21.I | EH21.O | EH21.S | EH21.F |
| EH21-05 | keeps directory creation inside the resource payload contract | EH21.C | EH21.I | EH21.O | EH21.S | EH21.F |
| EH22-01 | adds semantic defaults without exposing scheduler controls | EH22.C | EH22.I | EH22.O | EH22.S | EH22.F |
| EH22-02 | preserves an explicitly stated user intent and urgency | EH22.C | EH22.I | EH22.O | EH22.S | EH22.F |
| EH22-03 | keeps filtered exact-identity acknowledgement separate from the physical channel cursor | EH22.C | EH22.I | EH22.O | EH22.S | EH22.F |
| EH22-04 | rejects stale view, activation-less, generation, revision, and numeric-only receipts | EH22.C | EH22.I | EH22.O | EH22.S | EH22.F |
| EH22-05 | validates a frozen backlog boundary without resampling a newer Meta head | EH22.C | EH22.I | EH22.O | EH22.S | EH22.F |
| EH22-06 | accepts a presentation-bounded follow event only after current body presentation | EH22.C | EH22.I | EH22.O | EH22.S | EH22.F |
| EH23-01 | does not move a pending owner to holding from a suspended render | EH23.C | EH23.I | EH23.O | EH23.S | EH23.F |
| EH23-02 | does not publish a candidate from a suspended render | EH23.C | EH23.I | EH23.O | EH23.S | EH23.F |
| EH24-01 | keeps incremental prefixes out of the visible snapshot and publishes them once | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-02 | withholds every candidate for an empty baseline until semantic demand is fulfilled | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-03 | atomically acknowledges an exact first publish from an empty baseline | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-04 | rejects a polluted release atomically instead of binding an impossible revision | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-05 | lets no stale layout receipt complete or reject a renewed transaction | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-06 | grants publication only to the exact committed Reading viewport owner | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-07 | keeps cancelled facts staged and lets the next same-view intent inherit them | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-08 | does not inherit held facts across a new reading activation in the same view | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-09 | fails closed and rebases when the baseline stops being an ordered subsequence | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-10 | does not release a committed prefix into a different view or epoch | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-11 | rejects a committed render candidate after the owner revision advances | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-12 | renews only the same operation for exact current older input | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-13 | commits an existing-row revision before releasing an exact pure prepend | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-14 | keeps live append and baseline revise after the exact prefix release commit | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-15 | releases only the exact settled prefix and defers later older facts | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-16 | keeps deferred prefix held when newer input cancels an already published commit | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-17 | ignores a late old-operation observation after a new-view token begins | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-18 | uses a durable feed baseline without hiding a UI-only local echo tail | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-19 | remains addressable for renewal and cancellation after its request has settled | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH24-20 | keeps a local-only UI baseline visible while durable history is staged | EH24.C | EH24.I | EH24.O | EH24.S | EH24.F |
| EH25-01 | keeps presentation supply open until an origin page reservoir is drained | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-02 | explains a cold focus blocked behind the two physical lanes without mutating scheduling | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-03 | keeps physical warm batches silent and exposes one stable foreground edge-demand lifecycle | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-04 | keeps anticipatory runway and under-fill operations out of foreground presentation | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-05 | keeps a blocking initial-view restore attributable after the initialization shell degrades | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-06 | promotes one anticipatory operation to interactive presentation without opening a second operation or page | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-07 | keeps one demand revision pending across filtered physical pages and settles only at the semantic boundary | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-08 | settles an authoritative EOF without reopening a physical page | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-09 | keeps a user-owned failure actionable without exposing background failures | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-10 | transfers an exact background source failure to the first visible owner and Retry opens it once | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-11 | preserves the same blocked failure when an anticipatory owner is promoted to presentation | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-12 | lets a replacement source authority run without clearing the old block by Retry | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-13 | aggregates a page trace without losing arrival order or flooding the ring | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-14 | 同一 source authority 失败后停止自动重派，仅显式 Retry 重开一次 | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-15 | 无 candidate 的前台义务有界失败，不与已派发 batch 的阶段超时争权 | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-16 | 网络 receipt 永挂后发布精确阶段错误并停止自动重派，Retry 只重开一次 | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-17 | 本地 cache 永挂时同一 waiter 有界切换到已授权 network，不先发布失败 | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-18 | commit decode yield 取消后立即释放 lane，迟到页不能推进 cursor | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-19 | does not mistake an unpresentable live head for an installed tail | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-20 | hydrates the focused channel from IndexedDB before any remote attach | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-21 | keeps focused network available while a complete cache selection defers off-screen work | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-22 | preempts one off-screen hydration batch when a cold channel becomes focused | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-23 | does not cancel a second batch while an abandoned initial tail is already releasing capacity | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-24 | keeps warm batches when the focused channel has no currently schedulable candidate | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-25 | never preempts an off-screen current-tail refresh as ordinary hydration | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-26 | adopts an exact durable cold tail and cancels only its redundant remote fallback | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-27 | does not revive durable rows above an authoritative empty remote head | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-28 | keeps the local cursor when remote attach confirms the same cached head | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-29 | removes absent durable coverage when a complete local Meta snapshot is replaced | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-30 | revokes a pending IndexedDB source lease when its complete Meta snapshot is replaced | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-31 | does not admit a cache-only channel omitted from the established remote grant set | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-32 | keeps a silent background reservoir when attach confirms its cache coverage | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-33 | lets a compatible IndexedDB pull finish across remote attach | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-34 | gates first paint, then fills the frontend P0/P1/P2 working set under bounded concurrency | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-35 | keeps background pages silent and reveals the warm reservoir on focus | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-36 | adopts an in-flight background batch when its channel becomes the focus | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-37 | settles an offline history request at the local frontier instead of waiting forever | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-38 | disconnect releases network receipt waits before local cache work executes | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-39 | never runs two batches for one channel and re-scores after completion | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-40 | fills and refills a P0 resident target instead of stopping on a lifetime page count | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-41 | threads a bounded raw-record and byte budget through an operation release | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-42 | promotes a newly related live channel into P1 without routing live through history | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-43 | adapts the next network row limit from observed small-batch time | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-44 | restores a mobile materialization gap before continuing the deep-history frontier | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-45 | treats a stale local coverage claim as a local miss instead of blocking startup | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-46 | routes concurrent rows by ref instead of guessing from seq | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-47 | keeps one foreground operation attached to an already-running empty batch | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-48 | keeps a foreground operation that arrives before attach metadata | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-49 | carries visual intent and urgency into the scheduler-owned batch | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-50 | settles pending foreground work when the local replica epoch is reset | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-51 | cancels an unowned foreground batch and releases its operation | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-52 | cancels an abandoned initial tail when focus moves to another channel | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-53 | does not expose a partial current-tail page when focus lands during cooperative ingestion | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-54 | publishes page rows, cursor and coverage only under one current generation lease | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-55 | does not duplicate an in-flight head page when a complete local Meta snapshot lands during staging | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-56 | continues an adopted in-flight head page from its new cursor until the visible seam | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-57 | rejects a cooperative page after same-generation state replacement | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-58 | settles foreground operations and current waiters when attach revokes their channel | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-59 | does not release a warmed reservoir after a replacement attach revokes the channel | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-60 | does not publish an old execution rejection into a replacement state | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-61 | does not make the new focus wait for cancellation of the old focus | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-62 | uses an overlapping IndexedDB tail as the same bounded batch type | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-63 | loads the current network tail before a lagged cache and switches only at exact coverage | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-64 | rejects a non-atomic page terminal without advancing the cursor | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-65 | accepts the legal first row above request byte budget when it fits absolute reservoir bounds | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-66 | does not advance across a page that cannot fit the absolute channel reservoir | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-67 | retains reservoir ownership when the synchronous Replica handoff throws | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-68 | does not reopen authoritative exhaustion when a newer cache checkpoint arrives | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-69 | falls back to network at the same frontier when a stale cache claim misses | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-70 | ignores stale-generation terminals without closing the current batch | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-71 | uses a focused Meta refresh to catch up the latest tail without moving the deep-history cursor | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-72 | lets current-generation realtime coverage close a Meta tail gap after frame batching | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-73 | treats attach Meta as an immediate tail fence before exposing cached controls | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-74 | bridges a remote head that arrives before the local cache frontier is ready | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-75 | bridges a remote head that advances while the initial page is in flight | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-76 | exposes the one scheduler operation so a coalesced visual demand can promote it in place | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-77 | applies live rows on the next frame while a history batch is in flight | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH25-78 | does not let physical reading acknowledge notification state | EH25.C | EH25.I | EH25.O | EH25.S | EH25.F |
| EH26-01 | 早返回之后,组件体里恒不再调 hook | EH26.C | EH26.I | EH26.O | EH26.S | EH26.F |

## 真实产品缺口与未决项

- **G1 — Governance roster filter（EH03-01）**：当前 `ChannelAdministrationPanel` 直接渲染传入 `port.roster`，不会在 panel owner 再过滤 system/registrar/svcactor；共享 replacement 的原始 UX 断言实际红。不得在测试里把 roster 预过滤来掩盖；产品 owner 应决定 roster authority 的过滤边界。
- **G2 — Genesis declaration candidate filter（EH03-02）**：当前引入成员 SelectMenu 会展示 `svcactor` 等 genesis declaration；共享 replacement 实际红。不得恢复旧 `ChannelGovernance` 或在测试 fixture 偷删候选；治理 owner 需要明确 declaration eligibility。
- **G3 — Activity/Operation Center owner（EH03-03）**：旧 ActivityCenter 的跨频道 operation/source projection 在当前 src 没有公开 owner；搜索 SourceRef 已迁移，但操作中心能力没有事实来源。不得重建第二 index/store；产品需指定 owner 后再补测试。
- **R1 — Files fixture/owner seam（EH09 全套）**：当前共享 file-browser replacement 的定向合跑仍见 directory click selectedArtifact、preview timing、pagination 和 stale async fixture 红/timeout。它们不是本报告擅自判定的产品缺口；保留原始断言，待 FilesFeature/attachment harness owner 收敛后重跑。
- **R2 — 旧 E2E 全旅程证据分散（EH01）**：mock/wire/Replica 当前证据已覆盖公开 seam，但旧单文件 12 条跨 transport/compute 旅程没有同名一体 runner；标为迁移/分拆，不伪造 server 兼容。
- **R3 — scheduler 深矩阵（EH25）**：78 条旧 scheduler 断言按 runtime/executor/adapters/consumer owner 分配，当前直接模块替代为 4 条加既有 runtime/browser 证据；旧 `history-scheduler.js` import 失败不恢复。
- **R4 — frame-batcher 私有机制（EH19）**：无当前公开 owner，属已删除内部 seam；不是产品缺口，不能恢复第二 frame store。
- **R5 — F6 私有性能 helper（EH06）**：list-window/ArtifactContext/readBoundedText/Prism 私有 exports 已退出；当前只测 public feature port，不能为旧断言加私有导出。

汇总：真实产品缺口 **3 个（G1–G3，涉及 3 个 baseline case）**；fixture/证据待收敛 **5 项（R1–R5，均已逐 case 处置，未处理 0）**。产品红项只作为回归包交回，不在本分区改产品。

## 本 agent 定向验证

```text
npx vitest run tests/final-echo.test.js tests/foldable-body.test.jsx tests/f6-accessibility.test.jsx tests/history-demand.test.js tests/hook-order.test.js --reporter=dot
Test Files  6 passed (6)
Tests       24 passed (24)
```

实际改动（本 agent）：`tests/f6-accessibility.test.jsx`（2）、`tests/final-echo.test.js`（5）、
`tests/foldable-body.test.jsx`（5）、`tests/history-demand.test.js`（5）、
本报告。共享未提交文件、`src/app/hooks/useWireSession.js`、`tests/channel-feed-runtime.test.jsx`
以及 browser/audit 产物均未纳入本次提交。

## G1/G2 product-owner follow-up

本节记录 parent 允许的治理过滤修复，不改变上述 baseline ledger 的逐 case 计数，也不处理 G3 Activity/Operation Center。

- 根因：旧 `ChannelMembersPanel` 使用 `isProtectedActor`/`usableDeclarations`；当前 `GovernanceFeature` 直接消费 raw `port.roster`/`port.declarations`，而 `WorkspaceApp` 又维护另一份手写声明排除规则，导致治理面与公开 owner 的事实不一致。
- 最小 owner diff：现有 `src/model/actor-visibility.js` 统一标准 actor、`atoll-internal:`/`peer:` genesis declaration 和显式非 present 状态判定；`WorkspaceApp` 的治理 port 与 `ChannelAdministrationPanel` 共同消费该 predicate。未新增 store、compat、第二 owner、vendor 或 package，未改测试。
- 标准 actor 证据：`npx vitest run tests/f5-management.test.jsx tests/management-actors.test.js src/model/actor-visibility.test.js --reporter=verbose` → **3 files / 9 tests passed**；system/registrar/svcactor 不再出现在成员面板。
- 可管理 actor 证据：同一 9 条中保留 Root/普通业务 Agent；纯 predicate probe 输出 `visibleActors=[root,agent:steward:1]`、`manageableDeclarations=[demo:agent]`，genesis/peer/retired 候选均被排除。
- 治理 port 回归：`npx vitest run tests/workspace-governance-features.test.jsx --reporter=verbose` → **1 file / 2 tests passed**；命令仍经原 port 且 refresh 语义未改变。`npm run build` 通过。
- 权限变化未决：当前 `tests/channel-access.test.js` 试图从 `src/app/hooks/useWireSession.js` 导入 `createSessionAccess/accessMode`，但当前公开模块不导出 `createSessionAccess`（运行结果 `TypeError: createSessionAccess is not a function`，7 cases）；按合同不为旧测试补私有 export，保留为 access-owner interface gap。治理 port 仍由既有 `disabled: !canWrite` 接线控制写操作。
