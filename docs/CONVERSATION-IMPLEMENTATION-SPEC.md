# 会话前端 R3.3 — 单一组件接入设计与系统施工合同

日期：2026-09-17。性质：现有r3系统施工合同及正在执行的前端整合基线。ReadingSession只拥有阅读意图与会话记录，ListAdapter只映射当前单一成熟组件的公开接口，成熟组件独占几何。用户确认现有产品没有“跳到某条消息”、引用定位或搜索结果定位，唯一显式滚动命令是回到底部；此前把任意目标导航及通用取消当作准入硬门属于误建模，Legend源码fork结论撤回。Legend 3.3.11迁移曾进入唯一生产链，但P0-4/C1真实轨迹0/3失败，现已安全回退React Virtuoso 4.18.13单一生产实现；误名`LegendMessageList.jsx`内部实际import/render Virtuoso，`@legendapp/list`只剩依赖/测试/证据残留。**回退是风险控制，不是Virtuoso准入或完整交付。** 自有ListEngine撤出当前方向，历史保留执行账§8；施工与验证事实见执行账§9.10及§0总表。当前授权只覆盖本前端整合与测试，不覆盖后端、部署或依赖源码修改。

## 0. 交付范围、来源与执行边界

用户要求不变：系统架构级替换，覆盖进入/返回/真实频道切换、持续同步、历史阅读、实时内容、回到底部、输入发送、任务展示、移动目录和环境变化；不得把困难场景改成永久未知、冻结正文或让用户不断反馈才补齐，也不得凭历史场景表新增产品导航。

本规格与以下材料组成一个交付：

- [总设计](CONVERSATION-FRONTEND-REBUILD.md)：权威、行为模型与不变量。
- [分支核验及逐路径处置](CONVERSATION-BRANCH-IMPLEMENTATION-AUDIT.md)：144个前端路径、18个后端排除路径、Q01–Q20证据。Git默认rename统计为143文件，两者口径不同。
- [场景总账](CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md)：原42条、N01–N12及F01–F29追溯。
- [UX当前索引](CONVERSATION-UX-MODEL-AUDIT.md)：前台缺陷的当前实现/定向/失败状态；历史UX-01–05不覆盖顶部索引。
- [UX数据审计](CONVERSATION-UX-DATA-AUDIT.md)：同步、离线恢复与数据活性证据边界。
- [后端能力及架构复审](CONVERSATION-FULL-ARCHITECTURE-REVIEW.md)：既有能力证据和未闭合门槛。

发生冲突时，不默默选择较弱合同：本规格保留W1–W8系统义务，总设计保留用户目标；涉及产品变化或后端变更须记录决策。前端施工已获准并正在当前脏树执行；完成范围、已跑证据与未决项必须回写执行账，不能把分组通过冒充完整验收或发布授权。本稿W3由成熟组件独占几何，ListAdapter只映射一次初始化、真实prepend及当前回底/follow策略；不能在组件之外保留像素补偿、guard、通用滚动任务或另一个跟随循环。

### 0.1 从哪里施工，不从零重写

1. 前端历史对照基线为 `master@28abef1a15e3d431e1593b1179bd0b52558cccd2`。r3分支与未提交实现已经存在；继续前记录HEAD、diff及用户改动边界，在现有成果上处置，不重新创建同名分支、不reset、不覆盖、不切走产品工作树。本文不声称脏树代码全部归本任务所有。
2. 设计基线取当前文档分支的提交；在施工记录保存该完整SHA。移植源固定为 `refactor/conversation-architecture-r2@1cadf76`，不跟随可移动分支名。
3. R2只有一个混合大提交。**不整提交cherry-pick、不merge整个分支、不把其vendor或协议依赖先带入再补救。** 按逐路径清单挑选模型、测试和入口代码，移植当次就去除无效依赖，并修复相应Q项。
4. 保留当前主线正常能力与用户数据。旧运行控制器在新入口完整接好后删除；一次性数据导入不是长期运行兼容层。旧分支仅留作历史证据。
5. 后端能力审核基线 `8441c2fa5ade6c343f55c8e9ac1ebae40c3a0953` 只读；审核期间main已前进到用户TUI提交`125bf517`，不得回退。该提交没有修改本次核验的Gateway/Store协议源码。`3eba8fc4`的18路径均不移植，不修改后端代码、测试、协议、schema和产物。用户TUI及其他工作不在工作包内；未来集成验证记录当时实际服务版本，不能把固定审核SHA误当部署指令。
6. 现有v5的attach、history、channel_meta、view与request可以使用；“不新增协议”不等于擅自删除已经存在的接口。任何发现需要的后端修改均走总设计BE审批表，单独明确获批才可施工。

### 0.2 完成定义

交付须同时具备：唯一生产调用链、旧控制器删除、有效本地数据保留、全部行为合同实现、集中review、模型与浏览器行为fuzz、真实设备证据、构建与可回退版本。工作包可以分提交，不能按提交数量宣称完成。

组件能力或产品决策未关闭时，列出具体未完成工作及证据；不能以“符合分层”替代可用性。发布不由“文档通过”或“build通过”自动授权。

## 1. 施工包及依赖

| 包 | 输入与具体产物 | R2处置与退出条件 |
|---|---|---|
| W0 准入与基线 | 固定Virtuoso版本/许可/公开接入、C1–C5证据；L1；设备/负载及追溯 | 停止轮转；按4.18.13公共API接入并验证真实风险卡；不fork、不改库源码、不带R2 vendor/自有Engine/并列补偿 |
| W1 身份、现有协议和副本 | Gateway适配、SyncSession、Replica及持久化；明确probe/fulfilled进度 | 修订复用sync-session/feed-cache/cursors/useChannelFeed；v5语义对齐；关闭Q01–Q04中的同步部分 |
| W2 持续历史需求 | Demand端口、范围任务、优先级/公平预算、取消/重试/完整批次提交 | 复用scheduler内核、重写v6 seam和head点命中逻辑；UI不自行循环分页 |
| W3 阅读与列表提交 | ReadingSession、CommitCoordinator、唯一ListAdapter、组件公开接入、激活保存恢复 | 修订复用reading-session/view-session；R2及当前MessageList双控制机制替换；关闭Q05–Q09、Q20 |
| W4 稳定展示与内容 | 不可变Presentation、稳定根壳/块身份、Choices、局部解析及异步版本校验 | 复用快照脱离可变turn的方向，不复用可变Map、offset块ID和latest默认重算；关闭Q10–Q13 |
| W5 任务展示与操作 | 现有响应证据索引、已知任务补证、全集发现进度、能力驱动操作 | 替换control-projection，不存在channel_control；关闭Q17，证明J7推进与完整性边界 |
| W6 草稿与可靠提交 | revision草稿、原子acceptDraft、稳定帧Outbox、多tab租约、local echo/receipt/feed合流 | 修订复用outbox-store/useDrafts/useSubmissions；移除账号级replace和无条件clear；关闭Q14–Q15 |
| W7 页面与环境 | ConversationSurface、输入栈、状态槽、目录/Preview隔离、焦点/键盘及小视口可达性 | 重写R2全overlay测高与常驻128px默认；有权/无权/空/错路径共用合同；关闭Q16 |
| W8 接线、删除、审查与验收 | App→单一模型→Timeline薄组合；删除清单；全部测试/行为fuzz；产物/运行核对方案 | 迁移有效旧测试，不保留错误结构断言；关闭Q18–Q19；无第二控制器或v6生产依赖 |

依赖：W0先冻结公共边界；W1→W2/W5，W3与W4接口共同冻结，W1/W4→W6合流，W3/W6→W7接入，全部→W8。模型实现可在独立模块推进，不能在W0未解决时自创列表能力来填空。

施工顺序是“能力研究与决策 → 全部实现/接线/删除 → 集中review → 集中测试 → 按责任层纠错并重验”。W0使用项目现有测试设施与正常候选接入核实能力，不另建独立demo项目，不允许每写一小块就部署产品试错。测试代码可随工作包编写，但完整运行验收在统一接线后进行。

## 2. W0：必须具体关闭的准入门槛

### 2.1 单一组件执行的具体能力门

固定候选 React Virtuoso 4.18.13 的公开配置：不可变 `data` 与稳定 `computeItemKey`；真实prepend时 `firstItemIndex` 与新data同一次React提交；首次进入/返回/频道激活只用一次 `initialTopMostItemIndex`；内建`followOutput`自挂载恒为`false`。显式回底与following下data/layout/viewport变化共用一个Adapter即时issuer，执行前核验已提交activation/inputEpoch/mode，再调用公开绝对`scrollTo`；不维护尺寸树、锚点差值或重试。`increaseViewportBy`/`overscan`有界，组件key仅用于真正activation/不连续世代。类型/源码/release是静态证据，不等于本项目运行通过。

| 门 | 必须核验的输入 | 通过条件与责任 |
|---|---|---|
| C1 真实阅读交接 | append/follow或用户点击回底→立即wheel/touch/键盘/拖条向上→晚媒体resize；A→B→A；真正频道切换 | 上滑后ReadingSession立即为browsing、后续 `followOutput=false`；旧频道无写权；组件不能在实际可达轨迹中晚拉回。只测这一真实交接，不要求所有内部工作接应用epoch |
| C2 选择/焦点 | 跨三条选择后反向、复制、行内编辑、背景mixed | 稳定Content身份与组件回收协作，复制/activeElement正确，资源单列；不假设某个pin API存在或仅凭DOMRange瞬时存活签署 |
| C3 结构保位 | 冷异构prepend+live+中插/删前项/删锚项 | 指定存活阅读点保持；真删除才语义fallback；无外部offset恢复或重挂 |
| C4 段内内容 | 长文中段、前方新块/块内编辑、字体/图表、宽度变化 | 块间不只测整消息顶；块内reflow按总设计§6.1区分未改写锚点与语义连续，不冻结正文 |
| C5 供给/资源 | 冷缓存连续触顶/快反向，预取和live/IME并发 | 已供给内容不整屏空白，DOM/CPU/输入/内存按§12，不全量挂载或手势flushSync测量 |

§9.7/§9.8保留三库源码事实：Virtuoso的auto/smooth定位可等待list refresh，`followOutput=false`也不是一个清理所有既有内部handle/rAF的通用取消接口。这是已知机制边界，不能伪装成“测试未知”；但产品没有任意目标导航，故它也不能继续被推导为必须fork。当前真实可达重叠只剩“append尾随或点击回底后立即向上，再遇晚resize”，由C1止损卡判断公共接入是否满足UX。通过不证明存在通用cancel，失败也先限定到该真实路径，不自动升级为自研引擎或源码修改。

#### 2.1.1 历史实验与当前issue校准（非当前通过记录）

2026-09-16历史react-virtuoso@4.18.12阶段报告114文件/640模型功能测试；其1100/390、400异构消息夹具中，用户向上接管后冷prepend30使row-395变为row-362/364。保留该接入失败事实，但不能推断所有公开接入或后续版本必败，更不能将历史部分成绩继承到现在。后来TanStack及guard实验见执行账§7，有限实验不是整个生态结论。

主Agent2026-09-17独立核验纠正：
- Virtuoso #1373（4.18.3 prepend闪动）已closed，维护者建议skipAnimationFrameInResizeObserver；#1405 open限定首次用户滚动前且含Header LoadMore，不与本地历史反例合并因果。4.18.13 #1493已发布：prepend deviation由renderer layout effect确认后同paint补偿，未确认则下一帧fallback；这纠正“4.18.13无相关修复”，但只改善该C3主路径，不关闭全部C3或C1。
- Legend README仍偏Native/roadmap滞后，但3.3.11 package确有./react。#537的3.3.10 Electron padding问题在3.3.11源码及release有修正，属已修风险；#448 Web刷新空白未有精确新版repro，#525旧版尾随与新release修复重合，均不是新版必现证据。
- Virtua #636已closed且维护者称可能0.51.0修复，#968 imperative取消仍open；TanStack #1258已closed但修复版本未查明。不能用旧搜索状态宣判当前失败。
- Stream官方VirtualizedMessageList是Virtuoso真实聊天接入证据，不是采用整个Stream SDK或改Atoll后端的理由。

当前全部C门仍未取得本项目完整运行证据。限定比较已经停止；不继续换库，也不默认自写/fork/商业评估。React Virtuoso 4.18.13 是按公开API进入施工的固定候选，Stream接入证明这种聊天职责划分是生产可行先例，但不替Atoll签署版本与场景通过。一般失败先归因到应用职责、合法接入或具体组件路径，不能越层加补偿。链接、源码边界与撤回理由统一见执行账§9。

### 2.2 L1：等待区采用独立有界浮层

用户已经明确：等待区贴在Composer上方，是悬浮层；任务、断线和校准状态不得改变Composer位置，也不得改变消息视窗几何。因此施工选择已经冻结：

- 空、未知或证据不足时不渲染等待区；不能恢复缓存中的旧queued。
- 有经当前后端view与连续coverage证明的等待项时，在Composer实际顶部显示；它不进入Surface输入高度测量。
- 展开高度有上限，数量增加改为内部滚动；用户可以收起，交互控件保持可达。
- 浮层可以覆盖它所在区域的消息内容，这是独立悬浮层的产品语义；不能为了避免覆盖又把其高度反馈给MessageList或推高Composer。
- Composer输入、回复和附件的自然增高仍是唯一可调整阅读区高度的底部因素，消息区与输入栈保持32px。

状态证据W5与布局仍正交：布局选择不授权前端推断任务事实。

### 2.3 既有能力和成本门槛

J7冷态全集恢复用既有查询的真实可见历史样本核算扫描页数、带宽与完成时间；没有固定成本活跃全集接口，不承诺O(1)。已确认的发送幂等不再申请后端新协议。服务端attach等待只在实际分段计时证明瓶颈后提出BE-01，不阻止其余前端模型施工。跨设备能力未有授权接口则如实保持该需求待决，不假称本地持久化覆盖了它。

### 2.4 固定候选的决定性回归计划

本节替代自有ListEngine样机/商业试用及继续轮转候选的指令。固定 React Virtuoso 4.18.13，已按执行账§9.9的公开职责分工在**现有项目、生产调用链及已有浏览器测试设施**接入并开始核验。不另立demo项目，不安装商业试用，不修改组件源码、后端协议/能力、服务或产品部署；测试mock只模拟既有协议。当前运行事实与待授权依赖范围见执行账§9.10。

最早止损卡使用真实ReadingSession、Presentation、Content及候选Adapter，独立oracle从原始编辑脚本/DOMRange/真实输入读取，不复制组件锚定算法。400异构消息、冷50条、100k字符和高节点内容/媒体字体；最终负载仍按§12。不得只用容易的单TextNode样本。

| 卡 | 同一轨迹 | oracle与归属 |
|---|---|---|
| V1/G1/C3+C5 | 长文中段上滑→触顶→快反向→冷prepend+live+中插/删项同批 | 指定未改写文本点、实际运动、内容覆盖及首个可观测paint；无应用scroll写。合法接入失败归组件/接入，不新增补偿 |
| V2/G2/C1 | append尾随或点击回底（保留当前产品动画）→立即wheel/键盘/拖条/touch向上→晚媒体resize；A→B→A/hidden0size | reference model记录真实阅读意图；上滑后不被晚拉回，旧activation不写新会话。记录Virtuoso无通用cancel这一已知边界与实际是否触发，二者不混写 |
| V3/G3/C2+C4 | 长文中段→前方新块/块内插字→字体/变宽→跨三项选择并反向→焦点回收边界 | 块间像素点、块内reflow语义、DOMRange复制/activeElement分开；不得用消息顶或宽泛reflow豁免 |
| V4/C5 | 长短混合、快速反向/拖条、持续live与IME，达到支持负载 | 数据未到/解析未到/已供给未物化分开；DOM/内存/长任务/输入延迟及真实Android惯性 |

≤1px仅用于指定未改写锚点且物理可行场景，不要求任意重排中全部字符同时不动；D01/B08及正常流式保留。夹具版本、工作树、浏览器、事件/数据时序、可观测帧和视频保存；rAF不冒充所有合成帧。两种桌面宽度不代替Android。

G门仅分组C门，不宣称三卡替代原42+N/F/Q或W1–W8。无下一push A01/E08/N01/N06/N11继续独立同步回归；Task全集、Outbox、Surface另验。只能用公开合法接入；若需私有任务、behavior guard、反向scroll、history/resize完成后再imperative滚动、冻结正文、全量DOM或删真实场景才能通过，则当前接入不准入。先回责任层提出最小修正/能力缺口，不直接轮转库、自写引擎或fork。

## 3. 前端内部端口与唯一写入者

下列为**目标内部接口**，不是已存在导出，也不是新增后端帧。最终文件名可调整，职责和调用权限不可变；在施工追溯表记录实际实现位置。

```ts
type DataKey = { principal: string; channel: string; world: string };
type ViewKey = DataKey & { filterKey: string };
type Activation = { view: ViewKey; id: string };
type Coverage = ReadonlyArray<{ from: number; through: number }>;
type Evidence = { generation: number; boundary: number; scope: string };

interface SyncPort {
  expressInterest(key: DataKey, reason: 'enter'|'reselect'|'resume'|'refresh'|'latest'): void;
  subscribe(key: DataKey, listener: () => void): () => void;
  getSnapshot(key: DataKey): SyncSnapshot;
}
interface DemandPort {
  acquire(spec: DemandSpec): { update(next: DemandSpec): void; release(): void };
}
interface ReplicaPort {
  install(batch: ValidatedBatch): InstallResult;
  getSnapshot(key: DataKey): ImmutableReplica;
  subscribe(key: DataKey, listener: () => void): () => void;
}
interface ReadingPort {
  activate(view: ViewKey): Activation;
  dispatch(activation: Activation, event: ReadingEvent): void;
  getSnapshot(activation: Activation): ReadingSnapshot;
  saveBookmark(activation: Activation, observation: VisibleContent): void;
}
interface PresentationPort {
  project(input: ProjectionInput): ViewUpdate;
  getSnapshot(view: ViewKey): ImmutablePresentation;
}
interface CommitPort {
  accept(update: ViewUpdate): void;
  // 应用提交、映射follow策略或发出唯一回底命令前读取当前意图。
  // 不介入组件内部测量、range、adjust或滚动生命周期。
  currentGrant(activation: Activation): ReadingGrant;
}
interface TaskPort {
  expressInterest(key: DataKey): void;
  getSnapshot(key: DataKey): TaskSnapshot;
  requestAction(intent: ExistingActorRequest): Promise<CommandResult>;
}
interface SubmissionPort {
  acceptDraft(intent: DraftAcceptance): Promise<DurableAcceptance>;
  retry(submissionId: string): void;
  cancelUnsent(submissionId: string): Promise<void>;
}
```

Replica.install只接收通过身份/来源校验的批次，不接受带DOM定位的事件。不可变快照通过只读数组/只读查询门面暴露；TypeScript Readonly或freeze(Map)不足以阻止其set/delete。所有外部store的getSnapshot在版本不变时返回同一对象，订阅不全频道广播每个token。

Reading dispatch先同步提交输入授权版本，再通知React渲染；不能等下一次render才更新ref。reducer不执行持久化、网络或DOM。持久化订阅携带activation/revision条件写；旧卸载回调无法覆盖新会话。Choices以principal/channel/message为基本域，视图独有选择才含filterKey；阅读状态始终含filterKey，二者不混用。

### 3.1 ListAdapter内部接口（应用端口，不是新增库API）

```ts
type ListBinding = {
  activation: Activation;
  componentKey: string; // 只随真实频道/筛选activation或不连续数据世代变化
  firstItemIndex: number; // 只与真实prepend后的不可变data同批提交
  presentation: ImmutablePresentation;
  grant: ReadingGrant;
};
interface ListAdapterPort {
  // React中同次发布data/firstItemIndex/key；followOutput恒false
  bind(input: ListBinding): ComponentProps;
  // 所有自动尾随与显式回底共用；事件只提示重新评估，执行时重读当前owner
  issueBottomIfCurrent(reason: FollowReason, intentID?: string): boolean;
  // 只同步记录ReadingSession输入意图；不镜像following
  observeInput(input: OwnedInput): void;
  observeVisible(input: CommittedContentObservation): void;
  dispose(activation: Activation): void;
}
```

bind映射总设计§6的公开props，不建尺寸索引、范围、spacer或自己的锚点目标。初次进入、返回或真正频道切换在挂载输入中一次性给出初始位置；prepend不重放初始化。公开、forwardRef的自定义List只在layout commit发纯提示；同一JS turn用一个microtask合并提示，等公开handle与owner layout effect发布后调用`issueBottomIfCurrent`。data/layout/viewport通知也只调用该入口重新核验当前已提交owner；同activation/inputEpoch仍following且非零geometry时才用公开`scrollTo({top: 当刻scrollHeight, behavior:'auto'})`。显式intentID参与去重，0size不消费；普通通知以实际revision/scrollHeight/clientHeight去重。Adapter不持有保存旧授权/目标的跨提交Promise、RAF/定时循环retry、index retry、取消控制器或库任务镜像；该same-turn microtask不循环、不保留目标或授权。

Content提供稳定message/block身份、局部编辑映射及只读DOM→语义位置查询，Choices外存；这些支持书签、选择与oracle，不计算前后像素差反馈滚动。选择/焦点通过稳定 `computeItemKey`、稳定Content子树和明确的选择生命周期与Virtuoso回收协作，仍须C2实测；不虚构Virtuoso没有的pin/alwaysRender合同。

公开ref不得被拼成恢复/取消/锚点补偿链：initial/prepend仍走声明式组件输入；history完成无滚动出口。following下data/layout/viewport提示可进入同一即时issuer，但没有getSnapshotBeforeUpdate→测行高→spacer→scroll事务，也没有scrollBy差值。React render及可丢弃候选不发布owner或产生DOM副作用。

### 3.2 生命周期与保存边界

| 记录 | 唯一写者/有效版本 | 保存、退出与迟到结果 |
|---|---|---|
| Replica事实/扫描覆盖 | Replica，DataKey/world/generation和现有证据 | 合法迟到页可幂等入对应事实；无UI定位权；持久失败不假推进 |
| 同步/历史/Task义务 | 各Scheduler，interest/demand/evidence revision | 消费者离开降优先级/释放兴趣；共享事实和其他消费者需求不被销毁 |
| 阅读mode/bookmark/回底意图 | ReadingSession，activation/input revision | 按view保存mode/语义书签；旧卸载条件写失败；不保存通用导航任务 |
| 展示/Content候选 | Presentation/Content，base/content/解析/layout revision | 过期重算/丢候选不丢事实；挂载回收不删除Choices |
| 组件几何/Adapter公开接入 | 组件拥有测量/range/回收及公开scroll执行；Adapter映射data/firstItemIndex/key并唯一仲裁即时回底；builtin follow恒false | 不存尺寸树/差值；0size不消费显式意图；key只随真实activation/不连续世代变化；C1实测 |
| Choices | ChoicesStore，principal/channel/message+choice revision | 用户选择持久；晚恢复只补未修改记录，latest无写权 |
| 草稿/Outbox | Composer与Submission，editor/draft/record revision | 接受版本CAS、附件耐久、租约；离开/缓存清理不能丢未发送意图 |
| Surface分配 | Surface提供CSS可用宽高，组件测量；内容结果校验layout revision | 状态不改外框；键盘/窗口只改分配，旧尺寸结果无新布局写权 |

全局优先级与总设计一致：权限/身份→activation→当前阅读意图→内容版本→布局版本。普通断网不重置阅读；普通服务重启不等于Boot变更。用户点击回底只触发一次命令；随后真实向上输入立即把业务意图改为browsing，自动数据更新不会取得新的回底权。

## 4. W1/W2：启动、同步与历史推进

### 4.1 启动和合流

页面激活同时启动现有连接、身份安全的缓存读取和同步兴趣。关键attach先同步安装principal/world/generation及既有history_meta；安装失败不能发布attached。IDB写入/恢复失败不阻止合法live。未确认缓存owner不展示其内容、不提供resume，确认失败不被伪装成ready。

原始事件不直达UI。cache/live/history以ID和现有顺序证据合流，终态不被旧版本覆写；重复页新增0条不触发prepend。内存coverage、持久coverage、已读边界不同字段；持久消息批次与对应coverage同IDB事务，事务失败不推进可恢复游标。权限缩减立即移除不可见数据；普通断网只改变可用性，不清空已合法显示内容。

### 4.2 不能丢失的同步义务

每频道保存 `interestRevision, probedRevision, fulfilledRevision, targetH, requiredRanges, attempt, retryAt`。Q03必须按以下规则修复：

1. 表达兴趣增加interestRevision，不创建导航。正在请求则标dirty，合并多次输入但不丢最后版本。
2. probe成功只推进probedRevision，生成有限H及该轮requiredRanges，**不推进fulfilledRevision**。
3. Scheduler安装所需区间的有效批次后，满足完整性条件才推进fulfilledRevision。
4. catchup失败，即使probe已完成仍保留requiredRanges并重试；不能靠probedRevision判断“没活了”。
5. H继续增长时先完成已有有限目标，再处理dirty，避免永远追逐移动目标。新的用户兴趣可提升优先级，不删除既有缺口。

初次无缓存的“显示最新可读窗口”和“本地全部历史齐全”是不同目标。前者由有效tail页及其扫描范围/页终态证明；不得为了首屏遍历全历史，也不得拿tail可读宣称所有旧任务/所有区间完整。续接目标按既有frontier/coverage计算，最高seq或head单点存在都不是区间证据。

瞬时网络失败采用有抖动有上限退避；离线挂起计时、恢复立即推进；权限拒绝为显式终态；协议不匹配为可见错误，不能空白假装无消息。前台无push也有合并的新鲜度复核，计时器归SyncSession一个owner；收到自己补证请求的reply不形成无限自触发刷新循环。

**当前实施边界：** connectionEpoch已拒绝旧连接迟到probe/catchup；真实新attach generation在既有义务已fulfilled时新增一次interest，pending只resume，同generation Meta去重；`hidden→visible`只在真实边沿为当前频道建立一次既有Meta兴趣，不引入轮询。空目标只在同代权威Meta `head=0`且control current时fulfilled。已读恢复必须绑定当前activation、可见消息Surface与同一次已物化high-water；隐藏Surface、旧activation或仅有远端head均无权清unseen。当前定向sync/startup 16/16、cursors+reading 26/26、UX-A09生产Chromium 3/3；feed transport的source/generation provenance只保留在内存row，cache仍归一化账本字段，activity tracker 20/20且UX-A06生产Chromium 1/1。它们不是完整App/真实服务验收。

### 4.3 调度与取消

DemandSpec包含key、view、anchor或range、intent、urgency、deadline、revision。 acquire返回的handle生命周期独立于某一网络请求；release降低/移除该消费者需求，其他消费者仍需要时不取消共享工作。

优先级为当前必需首屏/缺口与可见历史，其次用户点击回底所需的latest数据，然后预热；同一层使用轮转，追新不能永久饿死上翻。初始预算采用全局2个历史请求、每频道1个历史请求；控制补证单独全局2/每频道1，合并同目标，过期预热先取消。这些是客户端调度默认，不新增wire字段；性能验收可在记录内调参，不能放开为无界并发。

页处理：校验request/generation/key → 累积完整批次 → 接到有效page_end → 原子安装可见消息及扫描证据 → 发布需求进度。scan过滤导致可见seq不连续不等于消息缺失；错误/缺page_end不写成功coverage。取消后迟到的合法事实可幂等合流，但不推进已经换identity的任务、不创建定位。

**当前跨物理批实现：** `historyDemand`发布`{revision, phase: idle|pending|error}`；一次语义`loadHistory`跨warm/initial-tail的多个物理batch保持revision不变，物理批只更新`loading/backgroundLoading`，不重启前台loading条或动画。zero-projection semantic supply edge在anticipatory阶段静默，按当前viewSpec/filter继续到first matching或authoritative EOF；切换filter会Abort旧view obligation，只有EOF能definitive empty。MessageList DOM key按channel稳定，presentation/reading semantic key独立。最新loading/filter Chromium3/3、unit64/64及build通过；此前cross-physical Chromium1/1仍是具名证据。这不新增请求类型、第二poller或UI分页循环，也不是完整W2/W3验收。

foreground loading→可读历史的连续过渡尚未签署。实现只能做不改布局的展示淡入，并保持同一逻辑消息身份、操作权和读屏唯一性；重复事实、快速完成、切频道与`prefers-reduced-motion`都须有确定终态。禁止移动已有正文、动画主滚动坐标、复制可交互DOM或冻结用户滚动来制造“连续”。

**当前语义单元P0：** 历史呈现仍由raw record reservoir/release满足；`loadHistory`虽然循环到`projectTimeline`产生可见seq或EOF，terminal turn仍会把其全部provisional记录保留，不能把物理record数、8条或256KiB当成conversation语义单元。已批准但尚未实现`ConversationHistoryProjection`，由它把可交付conversation unit与控制/临时记录分层，HistoryDemand按unit满足。实现必须继续复用同一Scheduler与既有`history_before`，不得增加UI分页循环、第二poller或协议字段。

## 5. W3：阅读、回底、提交与恢复

| 事件 | ReadingSession转移 | 允许的副作用 |
|---|---|---|
| activate(view) | 新activation；读取该view已保存的mode/bookmark；saved following即使带旧bookmark仍从latest初始化 | 所需数据准备后只给本次挂载一次初始位置；browsing恢复书签，following初始化底部；不在挂载后循环恢复 |
| 主列表用户向上阅读 | 增inputRevision；browsing | 同步改变业务意图，下一提交 `followOutput=false`；不调用或伪造组件通用cancel |
| 同一次有效用户向尾运动到尾 | following | 后续append可跟随；无因果用户运动的atBottom不转mode |
| 点击回到底部/普通消息接受 | 当前activation只创建一个回底意图；按钮的latest数据不足时只提升数据需求；Composer在发送发起且尚未await时捕获ReadingSession语义token，durable Outbox接受并返回稳定ID后仅在token仍匹配时创建一次同类意图 | 当前数据可执行时由唯一issuer公开`scrollTo({top: 当刻scrollHeight, behavior:'auto'})`并转following；该意图仍current时，后续新的已提交data/layout/viewport revision可由同一issuer继续执行，每个证据revision不得重复。接纳等待期间的用户输入或activation替换立即使token/intent失效，receipt/feed/retry/slash/edit/控制请求无入口，无目标队列、完成回调或后台自动重发 |
| history/live/cache/resize | mode不变 | 只提交内容或观测；没有构造导航的函数入口 |
| filter/channel变更 | 保存旧view有效版本，激活新view | A→B→A旧A回调无新A写权；新activation可换组件key，普通同频道data更新不能换key |
| 列表不可见/0尺寸 | 暂停物理观测 | 不将无效bookmark覆盖原有效书签，不销毁输入草稿 |

主列表输入归属包括wheel、触摸、键盘、滚动条及辅助输入；嵌套代码块/输入框的输入先归实际容器。只能结合短生命周期输入证据与实际滚动观测恢复following，不能长期保留“曾向下”标记。选择期间暂停自动跟随，选择结束不暗发跳尾。

CommitCoordinator接收统一ViewUpdate；base过期就用当前事实重投影，不能丢弃其中合法新事实。数据与changes同一提交版本进入列表；旧follow策略不能随异步正文结果固化。后台普通变化只交付preserve/follow策略，**不能包装为navigate-preserve命令**。纯prepend同时提交真实新增量与数据，中插/删除/混合按总设计§6候选公开机制接入并取得C3证据后准入，不能伪造firstItemIndex或强制remount。

几何由组件独占；Adapter不做restore/scrollBy、rAF尾随、尺寸树或临时extent。正文和Surface只更新内容/合法尺寸，交公开测量；主列表不启用snap，原生anchoring避免与组件机制竞争，程序focus用preventScroll。自动clamp不改变browsing，也不能将所有scroll事件当用户运动。

Bookmark含messageID/blockID、文本语义定位证据、viewport内偏移及content/layout版本；只用于下一次进入/返回该view的一次初始化，不是产品中的“跳到消息”，也不在每次数据更新回放。暂未加载时先由Demand取得恢复窗口，再挂载初始化；确认删除按存活文本→块→消息→后继→前驱→已知空降级。普通数据删除由组件保位处理，语义fallback不允许在挂载后自动生成另一滚动命令。具体执行能力以C3/C4而非接口名字签署。

同一轨迹的唯一链：Replica事实→稳定不可变Content单元→配对当前授权→Adapter同次公开props→组件范围/测量/保位→有效观测。组件内部时序不被宣称静态已证明；冷首次paint、原生惯性、段内/选择分别C门回归。没有host手动prepaint滚动或晚RAF反向修正。

**当前架构缺口：** `useReadingSession`的session/snapshot/history/markRead owner refs、Timeline的`readingControlRef`以及initialLocation首次render仍在render期发布候选；已提交事件可能因此命中未提交controller。initial ready也尚未由current activation+snapshot的nonempty public viewability，再经document/Surface visible的next-rAF token证明。当前44项即时单元另有3红：explicit latest错误等待不会发生的新height通知而0 writer；ordinary following height同样0 writer；latest在真实visible-tail ack前提前清unseen。以上都属于W3 P0，不能由cold三态、单writer静态或旧A09 3/3代替。静止prepend的3/3因果反例已明确为：未知高项测量后先执行坐标修正，新可见range/DOM尚未作为同一呈现过程提交，于是出现一帧空白；这不是网络、缺数据或应用第二writer。fold大跳虽已定位到按总高度差补偿的路径，但与每次失败的逐项对应仍待证明。

### 5.1 提交与激活的时序约束（历史场景保留，不继承通过记录）

- 消息提交保位依据是 DOM mutation 前的实际可见位置。浏览器可以先改变 scrollTop、后派发 scroll 事件，因此不能回放上次 scroll/rAF 采样的旧书签。保位由组件依据实际几何执行；应用不回放上次观测或另建段落/keyed prepend补偿器。
- 初次恢复所需数据尚未就绪时不挂载一个会随后被imperative纠正的错误位置；挂载后真实用户观测才按activation/revision条件更新书签。点击回底期间的瞬时观测不覆盖旧browsing书签；用户向上后立即恢复记录新的browsing位置。
- 频道卸载前，仍连接的 DOM 在原 activation 内完成最后一次有效观测，不能因取消待执行 rAF 丢掉用户最后一段滚动。
- following 的授权只来自当前 ReadingSession；不能再附加 700ms 等时间门槛，导致首次进入或用户回到底部后无人重新开启尾随。
- 既有 `tests/browser/reading-lifecycle.spec.js` 的真实场景继续迁移到唯一Adapter/组件链，不能继承旧列表运行结果。验收须使用真实ReadingSession/ViewSessionStore/MessageList，覆盖scroll事件派发前live、A→B→A、末次滚动后立即离开、following切换、点击回底后立即向上与连续增长；同时核验意图及逐帧位置，假reading port不足以验收。历史“跳到某条消息”断言标为误建模撤回，不为保测试而新增产品能力。
- **当前冷频道定向边界：** following且已有缓存行时已解除presentation initialization遮挡，同时`bottomReady`继续独立守住follow授权；empty-known只在attached、同generation、message current、local replica ready及权威`headSeq=0`共同成立。production-browser三态3/3：缓存首paint约385.6ms、无缓存约109ms稳定反馈且known>0/body pending不假空、known0约126.4ms权威空；关联unit 3 files/33 tests与build通过，协议/过滤batch不再误报空态。未新增request/poller或协议。该focused结果不签署bookmark successor/predecessor/seq fallback、权限/错误、hidden paint-ready或完整初始化套。

## 6. W4：稳定展示和真实增量

实体身份来自消息/提交稳定ID，顺序来自事实；不能用数组下标、latest或父线程是否已加载决定同一条消息的外层身份。local echo落账后更新同一根组件和内容身份；重复ID去重用持久索引，不每token扫描全部landed IDs。序号落定引起位置变化如实提交changes，由列表保当前阅读。

PresentationSnapshot拥有不可变实体内容及拓扑版本、顺序索引版本；content-only更新保留未变化实体和顺序引用。依赖索引定位受影响行/块；纯顺序变化也要产生changes。允许分页索引有O(log n)/局部重建成本，禁止将复制整个Map/数组包装成“只有一个token变化所以O(1)”。

ContentRenderer的块匹配先用前版存活解析节点与局部编辑范围，再用明确邻接/类型/内容证据；startOffset是定位信息不是稳定ID。歧义时生成新节点并报告实际replacement，不能错误复用旧图表。流式未闭合语法可能使已显示前文失效，按解析依赖重算；不冻结正文、不默默延迟到用户停止阅读才提交。

worker/异步结果至少携带DataKey、contentRevision、解析配置版本；尺寸相关结果加layoutRevision。结果过期丢候选而非新事实。已完成稳定块可缓存复用，缓存有容量及失效策略。图片、字体、数学/图表、作者头、代码换行、反应和错误占位都属于几何来源，进入同一组件测量边界。

Choices初始化只在实体首次进入该用户展示域时发生，记录当时合法默认；显式用户override随后跨回收和角色变化持久。没有override时，权威current-entry默认展开，失去该角色才按稳定判据折叠；不能把全部长文（尤其latest）一律默认折叠。折叠/详情状态不掺任务queued。持久恢复晚到只补未更新记录，条件revision写拒绝旧视图覆盖。

**当前实施边界（2026-09-17）：** Markdown生产链已接入ContentPlan：显式业务`contentKey`、唯一稳定top-level block ID、单义局部编辑及纯格式变化续用身份、重复歧义replacement、有界plan store、sealed/unchanged sibling DOM，以及layout commit后发布plan。bookmark已能从DOM/纯文本`describe + resolve`，并显式区分exact/context/block-offset；它先用保存文本否决cache淘汰后的ordinal假ID，跨ID只在fingerprint唯一时匹配，重复则返回null。它保留whole-message列表项和组件唯一几何owner，不做尺寸树、内部虚拟化或滚动补偿；`unified@11.0.5`与`remark-parse@11.0.0`为直接依赖。**定向6 files/42 tests、build及真实Chromium 2/2通过**：未回收块在流式尾续写/前插时Selection endpoint/text/block节点保持相同且connected，Control+C clipboard精确为`sealed`，卸载/away编辑/宽度reflow后resolver回目标passage。它们不是任意跨虚拟行/回收或几何验收。active tail自身文字改变仍可能折叠Range；列表卸载/回收后无公开bounded pin仍是UX-A04，A07 semantic point尚未被列表初始定位消费，只能保证row/block进入初始可读窗口，禁止晚`scrollTop`纠偏。coarse超长展示单元、Choices revision/CAS、parser真正局部增量及fold真实browser继续未闭。128,888 chars/2,500 blocks纯Node样本首次约426ms、尾append约276ms，仍是全量remark parse，不能签过长文CPU门。

**当前latest/fold边界：** latest候选由Presentation分类，ReadingSession只接受绑定exact epoch/view/source/candidate且证明`coverage(candidate.seqHigh→head)`的authority；Timeline `findLast`、loaded rows或`bottomReady`均不是权威。生产latest request入口已接，模型37/37及完整App1/1定向通过；`roleRevision + adapter public height ack`事务仍在集成，role false→true高度、cache-first following/wheel未准入。另须修复streaming→terminal切换正文key导致Selection/实例连续性丢失；不能用角色模型绿覆盖Content身份红门。

## 7. W5：既有消息证据上的任务展示

Waiting不是独立生命周期账本。queued/processing/terminal及乱序合并只由canonical Replica fold持有；stateless WaitingPresentation从当前已物化turn、权威roster和content/controls完整性派生展示。集合partial/freshness可以作为派生元数据，但不得重新引入持久TaskSnapshot、独立discovery游标或第二个终态裁决器。日志默认processing不是执行证据。

**当前事故门：W5生产自动查询已移除。** 隔离实现曾把Scheduler物理`headSeq`直接作为Task round boundary；而普通`system.log.query`本身向账本写request和terminal，两行又推进head，使hook换round、清verified、重置游标并立即再查。真实页面已出现连续system操作/结构化结果，因此App调用入口以及`useChannelFeed`中无人消费的`queryLog`端口、waiter、timeout和terminal settle链均已删除。禁止重新接`system.log.query`、新增`queryTaskStatus`式request或以限速冷扫替代闭环；普通request只承载真实用户操作。Waiting只消费现有`history_before/live/checkpoint → canonical Replica fold`已验证事实，不拥有请求、第二游标或retry loop。不得用UI过滤隐藏既有账本、删除消息或在真实频道调试。

生产激活前置是闭集：网络OBS roster authority必须绑定当前`principalId + channelId + generation`，缓存seed不算current；不完整OBS保持calibrating，注销/world重置/换代撤权。WaitingLayer必须保留集合partial和逐项content/controls完整性，不完整项只读且禁用缺失编辑/控制。旧TaskEvidence阶段的证据不继承；当前canonical链只按下面具名证据计入。

**当前动作门与审定链：** edit及附件编辑必须同时满足`contentComplete && controlsComplete`；insert/cancel等只依赖控制证据的动作只要求`controlsComplete`，缺正文继续由既有HistoryScheduler materialization补齐，不能新增fetch/query owner。唯一产品链为`Gateway → canonical Replica fold → stateless WaitingPresentation → WaitingLayer`：HistoryScheduler只输送通用validated rows/coverage，对Waiting没有专用输出；WaitingPresentation不拥有生命周期、缓存、discovery、request或retry。TaskEvidence projection/snapshot/hook、ControlDiscovery及migration/preparing已按root裁决从生产删除。

当前具名防僵尸链已定向通过：focused5 files/78 tests、build/diff-check及production browser1/1覆盖terminal-first→连续history→mobile trim→older request+queued，不产生Waiting复活。consumer重复注册/释放泄漏修复另有StrictMode、A→B→A、卸载与closure40/40及build/diff-check。上述结论不扩大为全部任务/操作通过；compact只保lifecycle closure，不保terminal正文/错误摘要，HMR/cache与其余内容保真仍开。不得以刷新修复；history过滤、深历史、容量和roster边界必须明确为partial。

冷启动流程：

1. 普通频道同步按既有身份、generation和view恢复cache/history/live；Waiting不创建候选索引、补证兴趣或专用请求。
2. HistoryScheduler校验的普通history页与accepted live都进入同一canonical Replica fold；response-before-request、终态吸收和open-turn保留由该fold处理，不复制tombstone或生命周期状态。
3. WaitingPresentation每次只从当前Replica turn、权威roster与content/controls完整性无状态派生；卸载/HMR后重新计算，不恢复独立queued snapshot。
4. Native的`agent.status`能力不作为Waiting自动发现入口；Base也不得调用不存在的status或会入队的`agent.queue`查询。
5. 只有Replica现有事实与覆盖足以证明时才显示集合complete；未到origin、coverage有洞或服务端view过滤生命周期时保持partial，空页或几个已知项不能推出全集空。
6. 新live、重连与history继续走普通同步→Replica链；Waiting没有dirty round、固定head、timer或retry owner。

必须记录普通冷态同步及派生成本，不能为等待区把所有正文解析/挂DOM。若现有生命周期语义或权限view无法证明当前活跃全集，明确能力缺口；J7该部分不签通过。需要后端时提交BE-02最小提案，而非默认新增control projection。

操作按实际word schema/capabilities构造既有request；expected_hold_id只在实际合同要求/允许时传。多actor能力差异不是legacy。客户端pending-command与后端状态分离；错误/失效权限不会把本地命令假装执行完成，未知状态也不能启用未经授权的破坏操作。

## 8. W6：草稿、Outbox与确认

草稿key按principal/channel/编辑上下文，保存draftRevision和editorRevision。跨tab更新按IDB条件版本写，冲突保留双方内容；恢复时只补未修改字段/记录，不替换当前整份草稿map。IME和selection由编辑器局部持有，接收live不重挂编辑器。

目标事务入口 `acceptDraft({key, expectedDraftRevision, immutableFrames, recoverableAttachments})` 在同一个IDB事务中写入outbox记录，并消费**匹配版本**的草稿。多接收者一次接受要么全部可恢复记录入库，要么不清稿；之后每个接收者传输结果独立。附件必须有持久内容或稳定合法引用，不以object URL充数。

每条帧在接受时固定messageID、channel、kind/type、payload、audience、parent、visibility及显式expires_at，重试不重新计算。事务失败保留输入。事务成功后UI仅在editorRevision仍对应接受版本时清除对应内容；用户已继续输入则不clearContent。部分成功显示每个目标状态，不能失去失败目标的可恢复内容。

普通Composer消息在提交发起、第一次await之前从当前Timeline的ReadingSession捕获`activationID + inputEpoch + intentRevision + mode`语义token；durable接受后只有token仍与已提交且started的同一owner匹配，才提交一次显式回底意图。这是用户发送动作的一部分，不是receipt/feed成功的副作用。多收件人批次只提交一次，以最后一个稳定ID区分本次intent；表单校验失败、草稿CAS拒绝或接受结果为空不回底。接纳等待期间主列表原生上滑会推进inputEpoch/intentRevision，显式阅读选择推进intentRevision，频道/view activation替换同步suspend旧owner；旧callback不能经`update`重新activate。迟到receipt、feed echo、Outbox重试或后台控制不能重建该意图。Composer/Timeline只传语义信号，仍由唯一MessageList issuer读取当刻几何并执行公开`scrollTo`。

提交状态转移：durable-queued→transmitting→accepted→landed；连接中断可uncertain，拒绝rejected，未发取消cancelled。feed先于receipt可直接landed，迟到receipt不回退；两个来源按同ID只合出一个气泡。后端已有同ID同语义持久化去重，不新增协议；鉴权/过期拒绝不证明先前没落账，走现有view对账。

**当前实施边界：** send-start在首await前创建唯一bottom intent，durable accept只校验/消费token；receipt、feed、retry无滚动入口。final四hash采用pure transaction exact target + snapshot list revision/rowIDs/height双序join，waiting只记exact inserted，A/B并存，takeover/activation清；无timer/rAF补偿/private patch。production CDP repeat2为2/2：每条1 intent/1 writer，outbox/transmit/receipt/feed各1；trusted wheel后18/19 ordinary-stream issuer均not-authorized、0二写。数据focused25/25。W6数据/窄发送轨迹通过，但完整浏览态仍有intent1/write0；慢receipt阻塞连续发送、旧批次错误反馈丢失、durable失败残留bottom intent三项仍施工，不能称W6整体闭合。

发送租约按记录CAS取得/续约/释放，跨tab崩溃接管仍用原帧；租约只是客户端并发控制，不宣传exactly-once。禁用账号级delete-all/replace持久提交，单记录状态条件更新。数据缓存清理不能删除未发送意图。

一次性迁移保存旧草稿、可识别待发记录和Choices；记录schema/owner/来源及导入版本，成功前不删来源，重复执行幂等。身份不明的旧数据隔离待用户确认，不错误分配给当前账号。不能为了“无legacy实现”丢用户文本，也不为了迁移保留旧运行控制器。

## 9. W7：页面布局与环境

ConversationSurface是唯一分配阅读区/输入栈尺寸的组件；Composer只报告可增长内容尺寸，不知道消息滚动坐标。状态栏固定占位；任务内容槽按L1裁决，计时、网络错误、数量只换内容/内部滚动，不反馈外框尺寸。不能把整个overlay的所有resize直接当作合法内容增高。

正常窗口：可用高度H扣除Header/安全区，输入栈分配O，间距G=32px，阅读区V=H-O-G且V不低于M。回复/附件/输入或用户展开可调整O，列表保持当前阅读策略。到预算上限输入栈内部滚动，发送/取消等必要按钮可达。极小窗口采用外层可达性滚动，不产生负高度或不可点的遮挡。

相同Surface合同用于正常、初始无数据、已知空、权限拒绝、错误页面；不能只有Timeline包Surface而private-empty仍在旧Grid。移动目录独立全屏Surface，隐藏工作区不得参与其布局、焦点或命中。Preview/Terminal各自限制溢出和尺寸，下载入口与返回焦点保留。

**当前实施边界：** `ConversationSurface`及CSS已将Observer/naturalHeight、overflow和padding限定到`conversation-input-slot`；absolute WaitingLayer不参与测量、滚动或裁切。final四hash的CDP发送证据确认Waiting mount与唯一writer同帧，promote/completed后browsing gap2135；历史FINAL6旧SHA2/2只保留为外框零漂移证据。当前旧waiting轨迹1/2红，仍须在现树重签完整following/browsing几何。Waiting queued→正文running连续过渡也未闭：浮层可淡出、正文可淡入，但共享逻辑身份且任一时刻只有一个可操作/聚焦/读屏实例；须覆盖重复事实、快速完成、切频道、屏外和reduced-motion。禁止复制正文portal、移动已有正文、动画scrollTop或用过渡掩盖跳位；Android键盘、rotation/safe-area、视觉/hit-test也未签。

layoutRevision来自有效宽高/字体环境，0尺寸观测不重置bookmark。键盘visual viewport、安全区、缩放、横竖屏、地址栏折叠由Surface消化；内容模型和列表接收合法布局变化，不触发重建频道/重清缓存。focus恢复使用不滚动语义，禁止子正文自动scrollIntoView祖先。

## 10. W8：统一接线、删除和迁移边界

最终生产链只允许 `App身份/路由 → 同步与语义需求 → Replica → Presentation → 当前ReadingSession授权配对 → ListAdapter → 单一组件 → Content节点`。Legend迁移C1失败后，当前工作树已回退为Virtuoso 4.18.13唯一生产实现；“回退已接线”不等于行为门或完整验收通过。`@legendapp/list`只剩依赖/测试/证据残留，没有第二条生产import；旧组件、自有Engine与并行几何writer不得并存。Composer/TaskView/Surface各订阅自己的事实；Timeline只组合显示和转发意图，没有第二套history/follow/height状态。

在切换新入口的同一整体验收版本中：

- 删除旧conversation-viewport、history-interaction、measured-layout及旧VirtualTimelineAdapter/useConversationViewport控制机制；实际路径以逐路径表和主线调用图核实，不能靠命名猜删。
- 不引入R2的62个vendor文件、reservoir、preparePrependSizes、preserve导航、叠加主动库的scrollBy、惯性/滚轮同步隐藏预测量。不再实现自有Engine索引/DOM补偿事务，不能把旧机制换名复制。
- 删除v6/channel_control生产依赖、v6测试fixture和对应mock能力；保留现有v5及其真实失败合同。
- 删除重复following ref、加载完成restore、周期钉底、状态改变外框的观察链。保留真正能力发现逻辑，不能把它误叫兼容代码删除。
- 旧测试有效场景迁到新黑盒oracle；只断言旧实现存在的测试改写。记录每项删除测试的替代ID，禁止一删就宣称测试通过。

静态依赖审查检查所有滚动写入/API调用来源、唯一回底命令来源、IDB事务边界、外部可变引用和生产import图。旧代码归档可留Git历史，不以未引用整份源码长期放src里。包依赖与项目维护的锁文件一致，最终组件版本及许可记录可追溯。

### 10.1 当前r3文件的复用/替换计划与执行对照

以下路径来自施工前目录核验并已进入当前实施对照；历史R2逐路径表仍用于来源核对，不假称历史路径全在当前树。每项保留现有用户改动，实际删除/新增与测试状态统一记录在执行账§9.10及最终W8清单。

| 当前入口 | 处置及唯一职责 | 必须退出的机制/替代证据 |
|---|---|---|
| src/model/reading-session.js、view-session.js | 修订复用W3；正交意图、activation、条件书签与一次回底意图 | 重复mode/follow refs、数据完成后暗跳；reading-authority及A/B/N10 |
| src/model/conversation-presentation.js、message-presentation.js、turn-presentation.js | 复用事实到展示方向，补不可变变化与稳定Content单元 | 可变快照、offset当ID、latest/父补齐重归属；presentation-integrity |
| src/ui/MarkdownContent.jsx、timeline/MessageLayoutState.jsx | 复用渲染与Choices，建立稳定块/文本映射、选择keys及成本描述 | 整段无条件重挂、回收丢Choices、正文私有滚祖先；C2/C4 |
| src/ui/timeline/LegendMessageList.jsx（误名；内部当前为Virtuoso）及Timeline唯一import | Legend迁移0/3失败后已恢复Virtuoso 4.18.13公开接入，保留错误隔离、稳定业务row和内容入口 | 文件名与实现不符、`@legendapp/list`依赖/测试残留必须收敛；pendingContentAnchor/commitBookmark外补偿、多轮settle及双writer不得恢复；回退后重跑C1–C5，不继承旧成绩 |
| src/ui/timeline/scroll-authority.js | 实验归档证据不进生产依赖；切换时退出生产控制路径 | behavior放行guard、通用导航task/epoch及晚RAF恢复；真实回底交接由V2验证 |
| src/model/sync-session.js、history-demand.js、history-scheduler.js；src/app/hooks/useChannelFeed.js | 修订复用W1/W2，明确probed/fulfilled、coverage、持续需求 | 请求完成后imperative滚动、v6 seam、UI分页循环；sync-obligations及A01/E08/N06 |
| src/model/task-evidence.js、task-controls.js、control-actions.js | 修订复用证据过滤/合法请求；补发现与新鲜度责任 | 已知turn过滤冒充全集、永远unknown、缓存queued current；task-evidence |
| src/model/outbox-store.js、submissions.js；src/app/hooks/useSubmissions.js | 修订复用W6，原子acceptDraft、版本清稿、lease/确认合流 | 整账号replace、无条件清草稿、重试换ID；durable-submission |
| src/ui/conversation/ConversationSurface.jsx、Composer.jsx及App/AppShell接线 | 修订复用W7与输入分离，组件观察合法分配尺寸；草稿独立订阅 | 等待浮层计入输入测高、状态推动外框、隐藏workspace污染目录；surface-accessibility |

新增/替换的是薄职责ListAdapter（公开配置、当前回底/follow和观测），不是新尺寸索引/spacer/自有引擎。当前Timeline只import一个误名`LegendMessageList.jsx`，该文件内部只import/render Virtuoso；不得在其中保留Legend/TanStack并行运行路径。`@legendapp/list`包、Legend特有测试/证据及误导性文件名是回退后的显式清理/裁决项；若要保留作隔离研究须与生产import分开标识。`firstItemIndex`/origin当前重新成为Virtuoso运行字段，不再列为未消费残留，但任何未来迁移仍须成批删除。旧分支正确模型、真实场景与样式继续复用，不重造后端。

### 10.2 当前施工工作包：在现有r3上完成迁移、删除与验收

这是主Agent已批准、正在当前脏树执行的**整合包**。它沿现有W1–W8修订，不另造项目；表中顺序仍是最终review核对表，不因部分生产入口已经接通而预填整个工作包完成。列表切换不能漏掉同步、任务、发送或Surface，也不能删旧链后留下半接线页面。

| 顺序/工作包 | 精确复用与修改入口 | 同批退出/生产接线完成条件 |
|---|---|---|
| 1. W0/W3依赖与阅读模型 | 当前生产固定`react-virtuoso@4.18.13`；`@legendapp/list@3.3.11`是失败迁移残留，是否移除/保留隔离证据须在W8明确；继续修订`reading-session`、`view-session`与`useReadingSession` | 保留following/browsing、activation和条件书签；删除`explicitTarget`、通用navigation状态/Promise/token与数据完成后定位。Legend 0/3失败记录不得删除，Virtuoso回退不得冒充准入；最终只保留一个生产import |
| 2. W3/W4唯一列表入口 | `src/ui/Timeline.jsx`唯一导入误名`src/ui/timeline/LegendMessageList.jsx`，其内部当前是Virtuoso Adapter；修订`MessageLayoutState`、`MarkdownContent`及presentation模块 | `data + firstItemIndex + computeItemKey`、一次initial、`followOutput=false`与单issuer/CommitAwareList当前同链；须关闭回退后的C1/C3并裁决文件重命名、Legend测试/依赖残留。无应用锚差/RAF retry/私有库API |
| 3. W8删除虚构产品入口 | 修订`src/App.jsx`、`src/app/AppShell.jsx`、`src/ui/Timeline.jsx`、`src/ui/timeline/useReadingSession.js` | 删除`timelineTarget`/`issueTimelineTarget`/`onNavigationTargetConsumed`到列表的整条任意消息定位链；保留真正的频道/视图切换、右侧turn详情与任务来源展示，它们不再暗发消息定位。回底按钮直接调用当前activation的唯一Adapter入口 |
| 4. W1/W2同步与历史同批校正 | 修订复用`src/model/sync-session.js`、`src/model/history-demand.js`、`src/model/history-scheduler.js`、`src/app/hooks/useChannelFeed.js` | history只供不可变事实/coverage，触顶持续需求；历史完成、cache恢复、live或resize都没有滚动出口。latest数据需求仅为用户回底准备数据，满足后由UI一次调用Adapter |
| 5. W5/W6/W7其余系统义务 | W5复用canonical `fold.js`/`memory-window.js`与`waiting-presentation.js`，删除TaskEvidence/discovery/hook第二权威；W6复用`outbox-store.js`、`submissions.js`、`useSubmissions.js`；W7复用ConversationSurface、ReadingIntentContext、Composer及App/AppShell组合 | canonical Waiting、原子草稿接受与同ID合流、L1浮层/32px/移动Surface分别按owner闭合；仅普通Composer send-start可经窄意图端口触发一次回底。receipt/feed/retry/任务状态无滚动入口；后端协议/服务零修改 |
| 6. W8迁移、删除与证据 | 迁移`tests/browser/reading-lifecycle.spec.js`及fixture、`tests/timeline-channel-switch.test.jsx`、view/history/presentation/task/submission/surface相关现有测试；新增C1–C5及行为fuzz入口 | 先用V2真实止损卡检查回底/append→立即向上+resize，再跑完整42+N/F/Q与W1–W8。结构测试删除时记录替代ID；U09任意定位断言标误建模，不替换成新功能。集中review确认生产import只剩一套几何链后才运行全套/build |

当前生产接线为：`App/AppShell → Feed/Sync/HistoryDemand → Replica/Presentation → useReadingSession → 单Virtuoso Adapter → Content`，Waiting从canonical Replica无状态派生；Outbox、Composer和Surface是并列owner，不插入滚动链。最近完整unit边界289/289 suites、843/843 tests及integrity4/4早于当前改动，不能称现树完整unit绿；六hashfuzz v3为1/7。当前新红包括explicit latest/ordinary-follow 0writer、提前清unseen、完整浏览send intent1/write0、W4高度事务及stream→terminal正文key。没有完整同一freeze的unit/browser/fuzz/build总账，不签W8或交付。

## 11. 集中review及行为测试施工

以下既是测试套件覆盖合同，也是最终集中验收清单；部分文件和分组结果已经存在，准确状态以执行账§9.10和最终冻结运行输出为准。每个失败回到owner修正，不在相邻层加反向补偿。

| 套件 | 覆盖与独立oracle | 工作包 |
|---|---|---|
| sync-obligations | probe成功后catchup失败、重复兴趣、无下一push、有限H、存储失败、账号/world/generation交错 | W1/W2 |
| reading-authority | saved following+旧bookmark、一次初始化、A→B→A/筛选激活、回底后向上、同步输入意图、旧卸载条件写 | W3 |
| presentation-integrity | 输入快照被外部尝试修改、纯重排、混合insert/delete、正文前插块ID、echo合流根DOM、latest/回收选择 | W4 |
| task-evidence | 有request无reply、旧queued晚到、终态不在当前页、actor更替、scan-limited空页、集合未完、查询自反馈 | W5 |
| durable-submission | 接受事务每个失败点、晚恢复、发送中继续输入、多接收者部分失败、receipt/feed排列、重开/租约竞争 | W6 |
| surface-accessibility | 全页面状态、L1空/非空/未知同选择、输入增长、32px、末条真实点击、Android键盘/目录/Preview | W7 |
| architecture-boundaries | 单几何执行者、无后台回底出口、无v6依赖/修改后端、无旧运行控制器、有效旧测试映射 | W8 |
| behavior-model-fuzz | 用户目的reference model与U/B/E事件生成、异步顺序/故障、独立不变量和推进oracle | 全部 |
| behavior-browser-fuzz | 生产列表/正文/编辑器真实输入、网络/缓存/媒体/尺寸受控交错，内容位置/选择/可达性/消息与草稿oracle | 全部 |

必须具名执行原42条及N01–N12，不用随机总数替代。另增Q01–Q20对应回归，其中Q03/Q05/Q06/Q14/Q15列为必杀变异：故意恢复错误实现时应稳定失败。

模型fuzz由独立reference model描述可见事实、用户阅读意图、接受的草稿和未完成义务，不复制生产reducer。生成合法事件前置条件，并专门生成迟到/重复/失效输入。记录seed、调度顺序、身份版本、coverage证据及快照摘要；自动缩减失败轨迹。覆盖报告包括事件×状态、关键双事件交错、生命周期转移，不能拿950个随机参数谓词充当950条UX轨迹。

浏览器fuzz使用生产组件而非替身列表，真实wheel/键盘/pointer，移动惯性/IME另用真实Android补证。包含进入无缓存无push、冷prepend后的快反向、触顶历史注入同时live、任务跨端终结、输入时缓存恢复、切频道时晚页、append尾随/点击回底后立即向上并遇媒体resize。测试服务器只模拟现有协议；端到端再对未修改的实际后端核验。不发送真实业务破坏请求来做随机压测。

测试命令在W8落入现有package scripts，并在报告保存准确命令、版本、测试数量及失败种子；本规格不捏造尚未接入的脚本已可执行。模型/组件/端到端/设备证据分开报告。

### 11.2 Opt-in阅读诊断合同

复用`src/model/diagnostics.js`和`__ATOLL_DIAGNOSTICS__.reading`，默认关闭，只保留有界内存ring并由人工/测试显式导出；不逐事件写console/sessionStorage，不上传后端。诊断detail必须延迟求值：关闭且没有测试sink时不得执行专用geometry getter；唯一issuer本身为决策所需的几何读取不属于诊断开销。导出包含单调时间、事件序号、版本/参数、`limit/dropped`及元数据白名单；严禁正文、输入草稿、凭据、token、协议envelope/payload。history逐行到达在一个batch内聚合为count、到达首末及min/max seq、首末时间和duration，避免一页大数据冲掉输入与请求起点。

机器oracle至少关联真实input→history request/到达→prepend/List/RO/range commit→issuer决策→语义锚screen Y与scroll几何，区分组件合法的`scrollTop`锚定、用户实际运动和无输入语义跳位。诊断不是滚动writer，不持有阅读授权，不采样时强制layout；它不能替代真实浏览器输入、视频/逐帧证据或宣称捕获了paint。

### 11.1 原需求与施工/验证的完整映射

下表是实施/验收索引，不是通过记录。ID沿用场景总账；其中轨迹B/C/E与总设计事件族B/E是不同命名空间，不得混统计。每一ID都建立独立具名回归，表内合组只共享责任，不合并掉场景。

| 原42轨迹ID | 负责工作包/套件 | 特别门槛 |
|---|---|---|
| A01、A06 | W1/W2/W3；sync-obligations、reading-authority | 无缓存/无下一push、Boot/generation、G1 |
| A02、A03、A04、A05 | W3/W7；reading-authority、surface-accessibility | 晚书签、A→B→A、following恢复、返回focus；G2 |
| B01、B09 | W2/W3；behavior-browser-fuzz | 真实反向、短列表触顶；G1 |
| B02、B03、B04、B05、B10 | W3；reading-authority及真实输入 | 旧follow、过期atBottom证据、回底后向上、append/resize晚交接、旧activation不复活；G2。历史“连续目标/任意消息定位”部分属误建模并撤回，不删同ID其余真实阅读行为 |
| B06、B07、B08 | W3/W4/W6；surface/输入/选择 | 嵌套链式输入、编辑器按键/IME、选择回收；G2/G3 |
| C01、C02、C07、C08 | W1/W2/W4；sync-obligations、presentation-integrity | 乱序/重复/撤权/补洞；G1及身份隔离 |
| C03 | W5；task-evidence | terminal先到，不由后补request复活 |
| C04、C05 | W3/W4/W6；presentation-integrity、durable-submission | mixed与echo确认同身份；G1 |
| C06 | W1/W3；reading-authority | 筛选视图的已读证据不冒充频道累计已读 |
| D01、D02、D03、D07 | W3/W4；presentation-integrity及Content浏览器 | 段内/Choices/删除同fallback/单项错误；G1/G3 |
| D04、D08 | W6/W7；surface-accessibility、durable-submission | 内容增长/32px/键盘，存储拒绝仍保草稿 |
| D05、D06 | W2/W4；behavior-browser-fuzz | 已有数据快滚与无网络边界区别；G1/C5 |
| E01、E06 | W6/W7；durable-submission、surface-accessibility | Android真实IME、本地接受、状态几何 |
| E02、E03、E07 | W7/W3；surface-accessibility | 目录隔离、超宽Preview/下载、返回focus |
| E04、E05、E10 | W2/W3/W4；Content/behavior-browser-fuzz | 折叠回收、触顶公平供给、静止无关更新；G1/G3/C5 |
| E08、E09 | W1/W2/W5；sync-obligations、task-evidence | 无push进/重选追新；旧queued校准与全集发现 |

| 新增ID | 工作包与oracle |
|---|---|
| N01 | W1/W8；源码/产物/浏览器事实分层，冷热缓存无push可见；F29不被文档宣称已修复 |
| N02、N03、N04 | W0/W8；后端零越界、需求不缩水、准确消费基线已有能力 |
| N05、N06 | W5/W1/W2；全集证据与同步interest/fulfilled持续推进 |
| N07、N08 | W6；版本清稿、跨tab接管及同ID对账 |
| N09、N10 | W3/W4；content/layout过期拒绝、回底/尾随与向上阅读交接；G2/G3 |
| N11、N12 | W1/W7；普通重启非换世界、等待浮层不改输入几何 |

用户模型逐项入口：U01/U02/U03→W1/W3激活与同步；U04/U05/U06→W2/W3真实阅读/需求；U07→W3/W4选择；U08→W3回到底部；U09原“跳到某条消息”属未证实产品能力，明确撤回而非实现；U10/U11→W3/W4视图/Choices；U12→W5/W6现有请求；U13/U14→W6/W7输入发送；U15→W3/W7嵌套/Preview；U16→对应失败义务owner。J1/J2→W1/W2，J3→W2/W3/W4，J4→W3/W4，J5→W6/W7，J6→W3/W7，J7→W5。列表组件不替代任何业务权威。

后台事件族B01历史→W1/W2，B02 live/补洞→W1/W2/W4，B03编辑/token/终态→W4/W5，B04缓存/持久→W1/W6，B05 attach/权限/world→W1，B06 receipt/任务响应→W5/W6。环境E01尺寸→W3/W7，E02键盘/焦点→W3/W6/W7，E03媒体/字体→W4/组件，E04 React/回收→W3/W4，E05生命周期→W1/W3/W6，E06存储/网络/解析故障→对应owner和推进oracle。所有组合继续进入独立行为fuzz，而非只测这些单事件。

最近一次完整7-case browser fuzz边界是六hashv3，运行前后adapter/useReading/Timeline/Composer/useSubmissions/test指纹一致，结果1/7：3 fixture following append gap519；2 integration同一row connected但fold top 2185/2318→451.656；browsing send有intent1但writer0、gap1764。following send唯一通过，满足单intent、≤1 writer、mount后0 writer、gap0及四submission phases。artifact在`docs/evidence/conversation-ux-fuzz/final-four-9e85d822-v3/`。它早于当前W4/W5施工，仍是有效失败证据而非现树重签；canonical CDP deep-history send2/2只关闭窄轨迹，不得覆盖这6个失败。

原故障F01–F29通过场景总账§3保持逐项索引：F01/F10→E01/B07/N07/N08；F02/F03/F28→E02/E03；F04→E10/C01/N09；F05/F07→B01/D05/E04/E05；F06→E04/D02；F08/F09/F17→B01/B05/D06/E05；F11/F27→E08/A01/N06；F12/F13→A01/A06/B01/N11；F14/F15→B02/C04/D01/D02；F16→D05/D06/E10；F18→A03/A04/A05；F19/F20→E06/N12；F21/F22/F23/F24→D04/E06；F25→E02/E07；F26→C03/E09/N05；F29→N01/A01/N11。全部保留，不以V1–V3替代。

Q01–Q20仍按分支核验§3与W表关闭；旧测试若只断言机制名称可改写，但其映射的真实用户行为必须有新oracle。机制变异至少恢复旧follow、历史完成后自动回底、maxSeq当coverage、旧queued当current、旧清稿覆盖新输入时，相关具名/随机测试应失败；任意消息定位的旧断言直接标误建模，不移植。文档映射完整不代表已写测试或有任何运行通过。

## 12. 验收预算与判据

以下是施工验收目标，**不是已测成绩或候选库能力承诺**。W0记录参考设备、浏览器、刷新率、电源/节流、网络和恢复后基线；达不到不得静默调低合同，先归因与设计裁决。

支持负载至少包含：本地100,000条历史、当前展示模型2,000条异构消息、单条100,000字符长文、冷态50条历史页、持续每秒10条live和每秒20次流式内容更新；分别测压力再测组合。消息附件/图表规模和文本样本固定进fixture。桌面宽1100与移动390只是布局参数，不代替设备配置；再覆盖极小高度、横屏和分栏。

| 指标 | 通过条件 |
|---|---|
| 无输入阅读连续 | 总设计§6.1指定的单个未改写、存活且物理可行阅读锚点，逐可观测帧偏差≤1 CSS px、不累积；重流语义另验，不能豁免普通prepend/live |
| 手势中连续 | 与相同输入对照轨迹/真实运动证据比较，保留用户运动；不把wheel.delta当实际位移 |
| 空窗 | 已具备可显示内容时不清空整个视窗；区分缺数据边界、解析未就绪与虚拟回收造成空白 |
| 输入延迟目标 | reference设备压力场景p95≤50ms、p99≤100ms；记录采样范围/输入到可见结果；IME不丢字 |
| 主线程工作 | 前端可拆分后台批次目标≤8ms；交互场景归因到本次处理的>50ms长任务须消除或形成明确未通过项 |
| 资源 | 常态DOM随视口/有界缓冲增长，不随100,000条历史增长；活动选择另记预算；内存无随往返次数单调泄漏 |
| 数据推进 | 在线、权限和所需接口可用前提下，有限需求满足或有明确可恢复错误；无push仍完成初始内容与校准 |
| 输入与任务正确 | 持久失败不清稿、晚成功不清新稿、同ID一个气泡；无证据不假queued/假空，补证不被静默丢弃 |
| 可达性 | 最后消息/按钮通过真实hit-test与点击；32px及状态几何合同、移动目录独立；键盘下必要操作可达 |

当前Virtuoso定向性能只提供风险定位：20:08 freeze后100k exact row50000已真实物化/paint/hit/selection通过，物化41→62 rows、509 elements、heap+26.7MiB，但max long task114ms；waiting active+8/collapse/expand也通过，275 elements、max long task143ms。100k chars/320 blocks长文最大long task911ms；cold/warm与移动长任务也仍高。灾难安全/功能P0窄门可记绿，50ms响应门仍红；不得用功能绿替代发布性能预算。

逐帧rAF记录与视频/真实设备互补，不声称观测到全部合成线程帧。库只能提供最终保位但中间闪动，不能以最终差≤1px签C3通过。网络永久断开不要求数据凭空到达，但已有内容和本地草稿必须可用、失败状态清楚。

## 13. 发布、回退及施工证据表

每个包维护一行：需求/场景ID、R2来源SHA和路径、目标实现入口、删除项、测试及artifact、review结果、未决风险。W8另出实际删除清单和后端零修改核对。无证据项不得标complete。

整体实现完成后集中review：先权限和协议边界，再状态/事务/并发，再组件几何与所有布局来源，最后性能及测试oracle质量。修正后运行集中套件及build。构建不等于授权复制dist或重启服务；本次文档任务不执行这些动作。

发布前独立核对四件事：源码提交、依赖与产物指纹、服务实际输出的入口/assets、浏览器实际加载版本与协议。保留上一可用产物及兼容用户数据的回退方案；不能回退源码后用旧新混合assets自称恢复。发布验证包括冷热缓存、无push首次进入、v5不匹配明确报错、阅读/发送/任务和移动目录冒烟。

F29“恢复后消息不见”仍是未诊断运行问题。若开始处理它，先只读定位连接→view/历史返回→Replica→Presentation→DOM哪一层缺失，不清账本、数据库或用户缓存试运气。此文档和分支核验不声称已修复F29。

## 14. 本次裁决

本节按发生顺序保留阶段裁决；其中“最新完整冻结”“+28仍未闭”等旧句只描述当时工作树。页末“当前列表准入覆盖”与执行账§0优先，禁止把阶段记录读成现树状态。

保留分支/逐路径/Q核验、W1–W8及原42+N/F/U/B/E/J全部映射。当前修订不是从零重做：重用正确事实/阅读/展示/输入模型，删除双控制和实验guard；撤回自有引擎作为当前方向，历史算法不再是施工命令。

限定三库比较已经关闭，不再另开选型。React Virtuoso 4.18.13当前接入为：首次进入/真实频道切换只初始化一次，真实prepend令`firstItemIndex`与不可变data同批；builtin follow恒false，ReadingSession唯一意图经单Adapter即时issuer仲裁append/内容/viewport/显式回底。执行账§9.10.9中的旧50ms捕获样本定位到DOM commit至默认RO通知之间的JS可观测瞬态，但未证明跨paint，也不作跨环境泛化；现在由公开、forwardRef的自定义List在layout commit发纯通知，同turn合并一次后进入同一issuer。该通知不读行尺寸、不算差值、不持滚动ref或授权；执行仍复核当前owner。严格append 10/10、C1/nested 6/6、初始化/恢复/prepend 8/8和生命周期定向回归通过，但最新完整冻结仍以§9.10.11为准。§9.10.10的矩阵把tail下方行增长时的+28定位为组件内部upward-size补偿；公共Adapter没有写入，不能靠调buffer或外部反补偿掩盖。§9.10.12又证明fold大跳共享该内部补偿边界；公开fractional `itemSize`与CSS linebox对齐均未闭合并已撤回。冷prepend及有限fixed-seed内容连续性fixture通过但未复现用户反馈的回弹/闪烁，因此只说明这些轨迹，没有把坐标稳定冒充paint连续或宣称问题不存在。已知库initial retry、独立upward-size补偿仍是分离风险；不修改依赖源码、不以新offset伪取消。后端/服务/部署仍零修改。

§9.10.13现以真实CDP compositor帧确认未知高度prepend轨迹中出现一帧全白；同一trace里，第二次实测补偿先移动旧range，替换range/rows/List随后才commit。这是需要继续对照的组件提交顺序事实，不再写成该白帧的唯一frame-level因果；4.18.13 #1493只为beforeUnshift初始估算阶段加入layout-effect确认，当前main的same-totalCount measured deviation/upward-size路径仍立即`scrollByWith`。这与tail +28和fold大跳属于同一内部子系统的不同触发边界，不与fold亚像素或initial retry混并。现有data+firstItemIndex合同、稳定key和应用单writer均通过反证，不能靠停补偿、固定高度、提高overscan或外部反向写掩盖。下一步先用当前Virtuoso静止对照分离组件提交与环境paint；若仍指向组件责任，再裁决公开接入、上游修正或其他有限选项，不预设fork。官方路径核验未找到已发布后续修复，但不能表述为绝无其他公共接入可能。

§9.10.14新增到达语义：Replica只在accepted live commit记录稳定arrival。固定1024热journal用于正常增量；如果同一消费间隔溢出，只为尚未ack的稳定身份保存精确overflow集合，ReadingSession按当前activation之后的revision和当前Presentation可见身份接收后即ack释放，后台频道无viewport义务而直接基线ack。当前未读的稳定key集合随ViewSession持久化，不再以256静默截断，并在回底/已读时释放；其资源上界是本次尚未读的不同身份而非频道终身事件数。history/cache发布、processing、metadata、同ID内容修订及本地echo不制造“新动态”，真实live独立动态仍累计。频道rail的显示与markRead清除统一复用`unreadCounts`；浏览器/OS层没有另一套“新消息toast”入口，既有channel notice只报告Submission状态，不参与新消息计数。普通Composer的发送起点token与durable接受回底仍和上述通知语义分离。

Composer accept端口不把缺失token解释成普通explicit bottom；它必须验证activation、inputEpoch、intentRevision与mode的完整形状。只有用户点击回底的显式端口可以无token。Arrival consumer的layout注册与卸载注销是内存边界：无Timeline时viewport journal立即ack，频道真正未读仍由durable rail/read cursor保留；已挂载Timeline只在一次消费前保留信息论上必需的未ack身份集合。

最新完整冻结验证仍是unit **118 files / 682 tests passed**；consumer生命周期修订后F7发送回底、history/progress不伪通知、channel notification baseline、B-BR-08切频道迟到确认共**4/4 passed**；build通过。其后同一冻结源码重签两条历史轨迹：生产runway **1/1 passed**，原+30未知高prepend压力oracle **1/1 failed**，seed4101/4103/4105各捕获一帧全白compositor ROI而DOM coverage为0失败。因而提前供给链通过不等于白屏验收，未知高prepend、tail下方增高+28、fold大跳/亚像素波动、initial retry风险及真实Android继续未闭。本轮没有用参数、阈值或视觉遮罩改写失败。三库demo v1只证明共享fixture下的现象分布，其`contain: strict`、高频全量几何探针、`flushSync` prepend与显式高度DOM是共享干扰因素，不是库内部机制或换库决策证据。

极端fast-wheel证据的准入级别再降一级：v2排除了Legend的root strict-contain与重探针这两个充分解释，但已发布TanStack 3.14.9/core 3.17.7的有界卡发现同速no-prepend也白，且Headless Chrome 151/SwiftShader中静态400行、无virtualizer/无React update的DOM同样有一帧全白。因而fast轨迹受运行环境compositor/raster混杂，不能作为“某库不满足”或“换库无意义”的一票否决。TanStack的`missing_tile_count:1`只在白图前后9–17ms相邻，没有frame token连接，只能记时间相关，不能记为精确因果。

几何责任继续分层：①生产Virtuoso静止prepend的二次实测correction先scroll、range/List后commit是组件路径事实，但对白帧的frame-level唯一因果尚未证；②下方行增高+28已有Virtuoso内部`scrollBy`直接证据，不随环境混杂撤回；③#1493、TanStack #1176/#1237/#1239是已发布的相邻提交顺序修复，证明这类组件问题真实存在，却不替当前环境完成因果归属。下一步只审当前Virtuoso静止prepend 3 trace+静止no-prepend 1 control，并要求paint/cc-viz证据与组件commit分层；不快轮、不加候选、不预设fork。v1临时artifact已被默认Playwright根清理且无备份，只保留审记数字；当前可复核证据在`docs/evidence/list-demo-comparison-v2/`与`docs/evidence/list-demo-tanstack-released-fixes/`。以后Playwright必须显式指定独占子目录，不得再共用默认`test-results`根。

最新生产runway补证不改变上述未闭门：单条180行、低于256KiB的raw terminal经既有Presentation折叠成507.09375px项，在连续3个真实frontier中每次只release 8条raw；95 DOM帧零空、32 compositor ROI帧均非空，最多15个物化项、issuer写0。实施合同因此是：后台history页只准备到reservoir/IDB，真实向上意图按frontier允许有界释放，进入时只在稳定Presentation上方增加older身份，不替换当前视图。它不承诺用户展开、非文本异构内容或initial/focus较大释放的像素上界，不撤回原+30直接prepend白帧失败。背景尺寸确认不得在新range coverage尚未提交时把原可见row移出屏幕；数值`scrollTop`补偿可存在，但可见内容身份必须连续。证据与限定见执行账§9.10.19。

执行账§9.10.20的候选A已否决且未实施：`root-complete prepare → 单根admit → 首次List/range/height ack → 下一根`把公开进展事件误当成完成信号。原子30项首次通知的`scrollHeight=65771`随后在同revision继续修订到`70392`；单个180行已展开root首次`61943`随后才到`70447`。所以不能新增逐根admission gate，也不能用settle次数、timeout或“最终尺寸”补出不存在的公开原子边界。

仍有效的合同是：后台page complete只改reservoir/coverage；真实向上frontier才授权有界release；用户滚动决定自然物化，稳定key和当前可见身份不能被背景回调替换；ReadingSession与MessageList继续是唯一意图/几何owner。严禁外部`scrollBy`抵消、双scroll容器、截图遮罩、等停滚、近全量overscan或第二补偿writer。原+30直接prepend硬oracle及生产runway用例均保留；迟到媒体的`#ddd`可见块不因暗像素阈值计为白。B方案尚未完成准入，不迁库、不fork。

**当前列表准入覆盖：** final四hash为Timeline`9e85d822…`、useReading`c42567eb…`、adapter`4f44e25e…`、txn`ac6dea2b…`。focused67/67与build绿；filter first-frame2/2、C1/takeover4/4、CDP immediate-send repeat2 2/2及tail下方+28轨迹1/1绿。prepend compositor仍红（DOM coverage零violation，4101–03各一白帧）；bookmark红为target unmaterialized/Infinity；fold红为collapse control absent；旧waiting轨迹1/2红（未立即takeover，后续ordinary follow+Virtuoso scrollBy）。final六hashfuzz v3前后指纹一致但仅1/7：following-send通过，三条append、两条fold及browsing-send失败。历史+28 trace只解释旧失败。
