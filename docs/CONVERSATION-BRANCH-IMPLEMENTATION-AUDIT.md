# R2 分支核验与逐文件施工处置表

日期：2026-09-16。性质：只读源码/差异审查，不是构建、测试或线上故障复现结果。

## 1. 精确基线与保全

- 前端恢复基线 master@28abef1a15e3；重构分支 refactor/conversation-architecture-r2@1cadf76，父提交就是28abef1。R2只有一个整体提交，不能用按提交cherry-pick隔离正确/错误机制。
- 文档分支 docs/conversation-architecture-r3@e442079（本轮修订前），由28abef1分出；两个文档提交，没有R2运行实现。两个前端工作树审查前均干净。
- 后端审核起点main@8441c2fa5ade；错误分支refactor/conversation-architecture-r2@3eba8fc4。审核期间用户将README、README.zh-CN、cmd/atoll/main.go、go.mod、go.sum及cmd/internal/tui提交为125bf517（feat(tui): add local Bubble Tea channel client with conversation history）；最终复核main@125bf517工作区干净。该15路径提交不改本次已核验的Gateway/Store协议源码；所有用户工作原样保留，不回退main。
- 其他后端worktree/workbuddy和detached重试工作树不是本工程，不切换、不清理。前端已有旧fix-feed-cache stash不是本次重构备份，不pop、不删。
- Git证明已提交部分保存，不证明先前所有未提交/未跟踪文件都可恢复；本轮没有声称找回Git未记录的数据。
- 未检查运行进程实际加载的产物，不能用分支状态证明产品已恢复。F29“消息不见”仍独立未诊断。

## 2. 审查覆盖及证据等级

默认Git rename统计143文件：应用39、vendor62、测试29、文档8、mock2、依赖3；新增14262行中9401行为复制的vendor源码。
本表关闭rename识别，v5→v6 fixture记为删/增两个路径，因此为144路径，不是额外改动。

核验方法：全量name-status/numstat对账；按应用入口、状态owner、协议调用、布局执行、存储和测试依赖追踪R2差异及关键函数；vendor检查ORIGIN、接入API与本地导航/尺寸改动，不将9401行上游来源代码冒充逐行安全审计；后端全部18路径排除，并核对协议/attach/schema投影改动的来源。不运行测试的静态反例不等于线上复现；潜在问题明确作为验收义务。

## 3. 确认的实现缺口与设计纠正

| ID | R2证据（均在1cadf76） | 裁决/施工归属 |
|---|---|---|
| Q01 | frame.js=6，wire.channelControl，mock-v6；useChannelFeed调用channelControl | 撤掉新协议依赖；W1消费v5既有attach/history_meta |
| Q02 | history-scheduler.beginSession忽略原attach的频道frontier；primeMemberships为v6另建seam | 复用任务调度内核但恢复v5实际合同，不能混搭版本 |
| Q03 | sync-session.run在catchup前赋probedRevision；retry只检查probedRevision<interestRevision | probe成功catchup失败可能不再推进；增加fulfilledRevision/未完成range义务 |
| Q04 | history-scheduler.confirmCoverage取highSeq最大值；refreshRemoteMeta以coverage包含head一点判断 | 点命中不能证明所需区间完整；用明确目标区间与已安装批次证据；空首屏用initial-tail证据单列 |
| Q05 | reading-session.takeReadingControl重写已取消navigation.inputEpoch为当前值；finish未检查issued | 迟到同ID completed可再次被接受；该文件自己的取消测试已有相反期待，不能称分支测试已绿 |
| Q06 | createReadingSession以存在bookmark优先于saved following；hook activation只初始化一次 | following优先；viewKey变化应激活新阅读会话，不能仅key重挂MessageList |
| Q07 | useReadingSession在setState updater内persist；输入后sessionRef等下一次render才更新 | reducer纯；动作先同步发布最新授权，持久化订阅按revision执行，避免旧follow窗口 |
| Q08 | MessageList执行preserve导航、手工follow，隐藏reservoir，preparePrependSizes，完成后scrollBy | 整个接入控制机制不复用；W0明确组件能力，再W3接入单执行者 |
| Q09 | 滚动中暂存几何更新；runway 2/5/8屏；选择仅保护anchor所属一行 | 延迟提交/扩大overscan不证明推进性或选择连续性；C2/C5独立准入 |
| Q10 | conversation-presentation快照entities是可变Map；内容路径复制Map及全orderedIDs；结构变化全扫描 | 不可变读端口、受影响依赖更新；区分局部解析与全序列成本，不宣称O(1) |
| Q11 | projectTimeline每次构造landedIDs全集；local echo standalone→落账turn | 去重用已有索引；稳定根壳/内容身份，不能只凭相同key证明DOM未重挂 |
| Q12 | MarkdownContent块ID=kind:startOffset；visibleBookmark.textOffset恒0 | 前方插字会改ID；稳定块匹配/文本书签，不以数据属性冒充段内保位 |
| Q13 | FoldableBody删除exempt后默认全折；Timeline原foldDefaults不再保留 | 去除latest动态控制不等于擅改默认行为；显式初始化Choices并保持 |
| Q14 | outbox put与draft put分开；replace按principal删除整集合再写 | 没有原子接受/草稿消费或跨tab记录CAS；W6改事务入口，不全量覆盖 |
| Q15 | useDrafts恢复整批替换draftsRef；Composer await后无条件clearContent | 晚到恢复/发送可覆盖新输入；按draftRevision和editorRevision合并/清理 |
| Q16 | Surface测整个overlay；CSS默认240px与常驻128px等待槽；无权页面没接Surface | 不照搬尺寸/默认外观；状态文案与可增长内容区分，无权/错误路径统一Surface |
| Q17 | withExpectedHold不再查看schema、无条件添加字段 | 能力发现是多actor合同，不是legacy；按现有word schema发送，不能为删兼容而破坏合法actor |
| Q18 | sync-data-fuzz有同步轨迹；reading-session.test另有500-run布局/用户观测property；browser夹具有真实wheel | 更正“只有同步fuzz”的简化说法；两种模型性质测试均复用，但不等于完整生产UX状态机fuzz |
| Q19 | conversation-architecture.test强制reservoir/preparePrependSizes；outbox-store两项仅草稿CRUD | 迁移有效行为oracle，错误结构断言撤换；不可拿存在测试文件证明完整性 |
| Q20 | view-session.updateChoices无activation条件，Timeline按conversation保存Choices而阅读用复合viewKey | 定义Choices与Reading不同key域并各自条件写；所有入口有owner，不仅save有保护 |

R3设计仍有两个不能隐藏的决策门槛：C1–C5组件能力尚无完整运行证据；等待区原空态不占位、非空展开不遮挡、状态不改变布局三者与固定矩形阅读区不能无条件并存。施工spec规定W0闭合能力/布局决策，不能复活R2 fork或128px作为默认批准。完整原42场景、N01–N12、F01–F29继续保留。

## 4. 全部前端路径处置

“复用”指从固定R2版本移植并按合同修正，不表示未测即合格。W编号见CONVERSATION-IMPLEMENTATION-SPEC.md。D路径只继承删除意图，不在当前产品提前删除。

| Git | 路径 | 处置 | 必须满足 |
|---|---|---|---|
| A | `docs/CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| A | `docs/CONVERSATION-FRONTEND-REBUILD.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| A | `docs/CONVERSATION-FULL-ARCHITECTURE-REVIEW.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| M | `docs/IM-INTERACTION-RUNTIME-ARCHITECTURE.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| D | `docs/READING-VIEWPORT-REFACTOR.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| M | `docs/SYNC-DATA-ARCHITECTURE.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| A | `docs/USER-REPORTED-ISSUES-RECONCILIATION.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| D | `docs/VISUAL-INTERACTION-COMPLETION-SPEC.md` | 归档/对账 W0 | 保留历史证据；当前R3及施工spec为施工裁决，不继承旧完成声明 |
| M | `mock/protocol.mjs` | 保留基线并扩故障夹具 W8 | 撤销v6/channel_control；仅模拟现有v5/view/request及真实失败语义 |
| M | `mock/server.mjs` | 保留基线并扩故障夹具 W8 | 撤销v6/channel_control；仅模拟现有v5/view/request及真实失败语义 |
| M | `package-lock.json` | 不照搬 W0 | 保留包依赖；候选组件准入后固定版本、统一更新现有锁文件 |
| M | `package.json` | 不照搬 W0 | 保留包依赖；候选组件准入后固定版本、统一更新现有锁文件 |
| M | `pnpm-lock.yaml` | 不照搬 W0 | 保留包依赖；候选组件准入后固定版本、统一更新现有锁文件 |
| M | `src/App.jsx` | 改接 W1/W2/W6 | 复用事件入口；删除逐成员v6 seam与control探测；草稿/附件唯一owner；周期兴趣归Sync |
| M | `src/app/AppShell.jsx` | 改接 W3/W6/W7 | 复用principal隔离；统一有权/无权Surface；频道/视图激活与编辑器生命周期分开 |
| M | `src/app/hooks/useChannelFeed.js` | 改接 W1/W2/W5 | 保留live/cache并行、命名persistence；恢复v5 history_meta消费；删除channelControl/primeMemberships |
| A | `src/app/hooks/useDrafts.js` | 修订复用 W6 | 保留独立草稿订阅；增加revision、恢复合并、跨tab冲突；不整批覆盖新输入 |
| M | `src/app/hooks/useSubmissions.js` | 修订复用 W6 | 保留先持久后传输；删除账号级replace；按记录条件提交、原子接受、发送租约 |
| M | `src/model/control-actions.js` | 修订复用 W5/W6 | 本地命令结果与后端任务状态分开；未决命令不因删localStorage函数而丢失 |
| A | `src/model/control-projection.js` | 替换 W5 | activeRequestIDs权威快照依赖无效；用现有消息证据和actor能力适配 |
| M | `src/model/conversation-presentation.js` | 修订复用 W4 | 保留脱离可变turn的快照；修epoch/顺序/正文版本、只读索引和增量边界 |
| D | `src/model/conversation-viewport.js` | 删除意图保留 W8 | 新入口整体接好后移除旧控制器；删除前迁移对应有效回归 |
| M | `src/model/cursors.js` | 修订复用 W1 | 保留principal命名空间；补世界隔离、旧数据安全导入与读区间合同 |
| M | `src/model/feed-cache.js` | 保留基线并选取 W1 | 不整体导入删除旧owner识别；覆盖与消息原子域保留，迁移独立 |
| M | `src/model/fold.js` | 修订复用 W4/W5 | 复用有界change log；覆盖补父关系/终态/驱逐等失效，任务不从缺回复推导 |
| M | `src/model/history-demand.js` | 修订复用 W2 | 复用语义边界；request一次性Promise升级成可更新/释放的持续需求 |
| D | `src/model/history-interaction.js` | 删除意图保留 W8 | 新入口整体接好后移除旧控制器；删除前迁移对应有效回归 |
| M | `src/model/history-scheduler.js` | 改接 W2 | 复用page_end批次与需求满足循环；还原v5 attach；移除Control所有权；补区间证明、公平及重试 |
| D | `src/model/measured-layout.js` | 删除意图保留 W8 | 新入口整体接好后移除旧控制器；删除前迁移对应有效回归 |
| M | `src/model/memory-window.js` | 修订复用 W2/W4 | 保留驱逐失效日志；增加当前阅读/选择/编辑引用保护，不能驱逐眼前事实 |
| A | `src/model/outbox-store.js` | 修订复用 W6 | 复用IDB事务域；acceptDraft/recordCAS/lease替换全量replace |
| A | `src/model/reading-session.js` | 修订复用 W3 | 保留正交阅读/导航；修取消终态、恢复优先级及输入证据 |
| M | `src/model/server-boot.js` | 修订复用 W1/W6 | 区分世界与连接；未发送意图不随缓存删，避免跨世界自动重试 |
| M | `src/model/submissions.js` | 修订复用 W6 | 复用状态转换；新事实优先、ID不变、迁移未决记录 |
| M | `src/model/sync-session.js` | 修订复用 W1 | 保留持久fence和兴趣版本；probe与fulfilled分离，catchup失败仍有义务 |
| M | `src/model/timeline-projection.js` | 修订复用 W4 | 复用筛选及local echo输入；避免全量ID重建、确认后换根组件、隐式搬组 |
| M | `src/model/view-session.js` | 修订复用 W3 | 复用activate/save；统一viewKey与choices所有权，条件写覆盖所有入口 |
| M | `src/net/wire.js` | 选择性复用 W1 | 保留关键attach安装失败处理；保留基线v5 history_meta，移除channelControl |
| M | `src/protocol/frame.js` | 保留基线 W1 | 保持v5及既有channel_meta；拒绝R2 v6/channel_control |
| M | `src/styles/app-shell.css` | 改接 W7 | Surface局部样式；不搬R2 240px默认及无权路径破坏 |
| M | `src/styles/responsive.css` | 改接 W7 | 移动导航保持独立；适配同一Surface，非按任务状态变高 |
| M | `src/styles/timeline.css` | 选择性复用 W7 | 保留行错误/local echo样式意图；删除reservoir样式，128px等待槽须先裁决 |
| M | `src/ui/Composer.jsx` | 修订复用 W6 | await接受保留；清稿需匹配提交版本，IME/附件/多收件人失败可恢复 |
| M | `src/ui/MarkdownContent.jsx` | 替换身份机制 W4 | 块标记思路保留；字符offset不是稳定blockID，建立节点匹配与解析revision |
| M | `src/ui/Timeline.jsx` | 改接 W3/W4/W5/W7 | 复用既有消息展示；移出调度/权限混合，移除snapshot控制依赖及取消能力发现 |
| A | `src/ui/conversation/ConversationSurface.jsx` | 修订复用 W7 | 唯一布局边界保留；测量原因/有限高度/空槽决策补齐 |
| M | `src/ui/timeline/FoldableBody.jsx` | 修订复用 W4 | 去latest动态判定保留；默认展开一次初始化Choices，不擅自全部改默认折叠 |
| M | `src/ui/timeline/MessageLayoutState.jsx` | 修订复用 W3/W4 | 复用独立选择store；仅用户操作接管，持久恢复不能发用户输入事件 |
| A | `src/ui/timeline/MessageList.jsx` | 重做接入 W0/W3 | 保留错误隔离和观测意图；不导入reservoir/库私有API/preserve导航/手工follow |
| D | `src/ui/timeline/VirtualTimelineAdapter.jsx` | 删除意图保留 W8 | 新入口整体接好后移除旧控制器；删除前迁移对应有效回归 |
| D | `src/ui/timeline/useConversationViewport.js` | 删除意图保留 W8 | 新入口整体接好后移除旧控制器；删除前迁移对应有效回归 |
| A | `src/ui/timeline/useReadingSession.js` | 修订复用 W3 | 修view激活、同步输入epoch、取消回调、已读证据；不靠setState延后取得滚动权 |
| A | `src/vendor/react-virtuoso/AATree.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/LICENSE` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/ORIGIN.md` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/TableVirtuoso.tsx` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/Virtuoso.tsx` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/VirtuosoGrid.tsx` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/alignToBottomSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/comparators.tsx` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/component-interfaces/TableVirtuoso.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/component-interfaces/Virtuoso.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/component-interfaces/VirtuosoGrid.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/contextSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/domIOSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/followOutputSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/gridSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/groupedListSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/__mocks__/useChangedChildSizes.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/__mocks__/useScrollTop.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/__mocks__/useSize.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/useChangedChildSizes.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/useIsomorphicLayoutEffect.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/useScrollTop.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/useSize.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/hooks/useWindowViewportRect.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/index.tsx` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/initialItemCountSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/initialScrollTopSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/initialTopMostItemIndexSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/interfaces.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/listStateSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/listSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/loggerSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/propsReadySystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/react-urx/index.tsx` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/recalcSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/scrollIntoViewSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/scrollSeekSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/scrollToIndexSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/sizeRangeSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/sizeSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/stateFlagsSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/stateLoadSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/topItemCountSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/totalListHeightSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/upwardScrollFixSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/actions.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/constants.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/index.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/pipe.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/streams.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/system.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/transformers.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/urx/utils.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/approximatelyEqual.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/binaryArraySearch.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/context.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/correctItemSize.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/horizontalScroll.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/positionStickyCssValue.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/simpleMemoize.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/utils/skipFrames.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| A | `src/vendor/react-virtuoso/windowScrollerSystem.ts` | 不纳入当前方案 W0 | R2复制/扩展的Virtuoso源码；原分支保留，不自动批准fork或移植 |
| M | `tests/browser/f7-history-cache.spec.js` | 改接并扩展 W8 | 保留滚轮/几何夹具和原场景；接生产组件并扩UX随机轨迹，不称已通过 |
| M | `tests/browser/fixtures/reading-viewport.jsx` | 改接并扩展 W8 | 保留滚轮/几何夹具和原场景；接生产组件并扩UX随机轨迹，不称已通过 |
| M | `tests/browser/reading-viewport-check.mjs` | 改接并扩展 W8 | 保留滚轮/几何夹具和原场景；接生产组件并扩UX随机轨迹，不称已通过 |
| M | `tests/contract-fixtures.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/control-actions.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| A | `tests/conversation-architecture.test.js` | 改写断言 W8 | 保留单权威检查；撤掉必须有reservoir/preparePrependSizes的断言 |
| D | `tests/conversation-viewport.test.js` | 场景迁移后删除 W8 | 不恢复错误内部API；每项有效用户合同迁入具名回归后才删 |
| M | `tests/e2e.mock.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/feed-cache.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| D | `tests/fixtures/atoll-contract-v5.json` | 保留v5事实 W8 | R2 v6 fixture不进入生产合同；v5原文件保留 |
| A | `tests/fixtures/atoll-contract-v6.json` | 保留v5事实 W8 | R2 v6 fixture不进入生产合同；v5原文件保留 |
| M | `tests/frame-fields.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/frame.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/history-demand.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| D | `tests/history-interaction.test.js` | 场景迁移后删除 W8 | 不恢复错误内部API；每项有效用户合同迁入具名回归后才删 |
| M | `tests/history-scheduler.test.jsx` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| D | `tests/measured-layout.test.js` | 场景迁移后删除 W8 | 不恢复错误内部API；每项有效用户合同迁入具名回归后才删 |
| D | `tests/measured-timeline.test.jsx` | 场景迁移后删除 W8 | 不恢复错误内部API；每项有效用户合同迁入具名回归后才删 |
| M | `tests/message-layout-state.test.jsx` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/mock-phase-c.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/mock-protocol.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| A | `tests/outbox-store.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| A | `tests/reading-session.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/setup.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/submissions.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/sync-data-fuzz.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/timeline-presentation-identity.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| M | `tests/view-session.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |
| D | `tests/visual-interaction-contract.test.jsx` | 场景迁移后删除 W8 | 不恢复错误内部API；每项有效用户合同迁入具名回归后才删 |
| M | `tests/wire.test.js` | 审断言后复用 W8 | 回退v6假设，补失败/取消/并发分支；模型测试不替代浏览器行为验收 |

## 5. 后端排除清单

以下全部仅保留于错误分支作为证据；施工不应用、反向改写、删除线上schema或迁移数据。需要后端改动另走具体审批。主线已经存在的channel_meta可以消费，不因排除R2而删掉。

- `cmd/internal/engineboot/engineboot.go`
- `drivers/gateway/connector/web/web.go`
- `drivers/gateway/cursor.go`
- `drivers/gateway/gateway_pump_test.go`
- `drivers/gateway/session.go`
- `e2e/harness_test.go`
- `lib/behavior/death_test.go`
- `platform/home/view.go`
- `platform/internal/tap/pump_test.go`
- `platform/subjectgate/frame.go`
- `platform/subjectgate/frame_test.go`
- `runtime/actorcaps/view.go`
- `runtime/internal/store/messages.go`
- `runtime/internal/store/messages_test.go`
- `runtime/internal/store/schema.go`
- `runtime/internal/store/schema_test.go`
- `runtime/ledgerview/minter.go`
- `runtime/storespec/log.go`

## 6. 下游使用规则

施工以恢复基线为工作树底座、R2为代码来源、R3为合同；不是整分支merge，不是从零重写。完成一个工作包记下来源路径/修改理由/替代路径/测试归属；整个系统接通后统一review和测试。未经验证不把本表的“复用”转成“已验收”。
