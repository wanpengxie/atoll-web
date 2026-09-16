# 会话前端 R3 — 完整施工规格

日期：2026-09-16。性质：分支核验后的施工合同，不是已实现或运行验收声明。

## 0. 交付范围、来源与执行边界

用户要求不变：系统架构级替换，覆盖进入、持续同步、历史阅读、实时内容、导航、输入发送、任务展示、移动目录和环境变化；不得把困难场景改成永久未知、冻结正文或让用户不断反馈才补齐。

本规格与以下材料组成一个交付：

- [总设计](CONVERSATION-FRONTEND-REBUILD.md)：权威、行为模型与不变量。
- [分支核验及逐路径处置](CONVERSATION-BRANCH-IMPLEMENTATION-AUDIT.md)：144个前端路径、18个后端排除路径、Q01–Q20证据。Git默认rename统计为143文件，两者口径不同。
- [场景总账](CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md)：原42条、N01–N12及F01–F29追溯。
- [后端能力及架构复审](CONVERSATION-FULL-ARCHITECTURE-REVIEW.md)：既有能力证据和未闭合门槛。

发生冲突时，不默默选择较弱合同：本规格修正实现细节，总设计保留用户目标；涉及产品变化或后端变更须记录决策。本次只修改文档，没有启动下述代码施工、测试、构建或发布。

### 0.1 从哪里施工，不从零重写

1. 前端施工基线固定为 `master@28abef1a15e3d431e1593b1179bd0b52558cccd2`。实施时创建独立工作树及分支 `refactor/conversation-frontend-r3`；若名称已存在先核查，不覆盖。不得切走当前产品工作树。
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
| W0 准入与基线 | C1–C5组件能力记录；L1等待区布局裁决；固定设备/支持负载；迁移数据清单；施工追溯表 | 保留公共组件依赖，拒绝R2 vendor；不把未知能力写成已有API；以下§2证据齐全才冻结列表接入 |
| W1 身份、现有协议和副本 | Gateway适配、SyncSession、Replica及持久化；明确probe/fulfilled进度 | 修订复用sync-session/feed-cache/cursors/useChannelFeed；v5语义对齐；关闭Q01–Q04中的同步部分 |
| W2 持续历史需求 | Demand端口、范围任务、优先级/公平预算、取消/重试/完整批次提交 | 复用scheduler内核、重写v6 seam和head点命中逻辑；UI不自行循环分页 |
| W3 阅读与列表提交 | ReadingSession、导航生命周期、CommitCoordinator、成熟组件接入、激活保存恢复 | 修订复用reading-session/view-session；R2 MessageList控制机制整体替换；关闭Q05–Q09、Q20 |
| W4 稳定展示与内容 | 不可变Presentation、稳定根壳/块身份、Choices、局部解析及异步版本校验 | 复用快照脱离可变turn的方向，不复用可变Map、offset块ID和latest默认重算；关闭Q10–Q13 |
| W5 任务展示与操作 | 现有响应证据索引、已知任务补证、全集发现进度、能力驱动操作 | 替换control-projection，不存在channel_control；关闭Q17，证明J7推进与完整性边界 |
| W6 草稿与可靠提交 | revision草稿、原子acceptDraft、稳定帧Outbox、多tab租约、local echo/receipt/feed合流 | 修订复用outbox-store/useDrafts/useSubmissions；移除账号级replace和无条件clear；关闭Q14–Q15 |
| W7 页面与环境 | ConversationSurface、输入栈、状态槽、目录/Preview隔离、焦点/键盘及小视口可达性 | 重写R2全overlay测高与常驻128px默认；有权/无权/空/错路径共用合同；关闭Q16 |
| W8 接线、删除、审查与验收 | App→单一模型→Timeline薄组合；删除清单；全部测试/行为fuzz；产物/运行核对方案 | 迁移有效旧测试，不保留错误结构断言；关闭Q18–Q19；无第二控制器或v6生产依赖 |

依赖：W0先冻结公共边界；W1→W2/W5，W3与W4接口共同冻结，W1/W4→W6合流，W3/W6→W7接入，全部→W8。模型实现可在独立模块推进，不能在W0未解决时自创列表能力来填空。

施工顺序是“能力研究与决策 → 全部实现/接线/删除 → 集中review → 集中测试 → 按责任层纠错并重验”。允许W0隔离夹具核实候选能力，不允许每写一小块就部署产品试错。测试代码可随工作包编写，但完整运行验收在统一接线后进行。

## 2. W0：必须具体关闭的准入门槛

### 2.1 成熟组件能力，不在应用外层补偿

以下夹具使用锁定版本的真实候选组件与生产正文结构；结果保存API映射、最小复现、逐帧记录、版本及结论。先检查当前公共API的合法接入；不修改node_modules、fork或引入自写引擎。

| 门槛 | 具体实验输入 | 通过条件 |
|---|---|---|
| C1 导航接管 | 发出目标导航，尺寸未稳定时立即wheel/touch/键盘接管，随后触发媒体resize | 接管后没有旧目标重定位；应用取消和组件内部延迟动作都受约束，非仅token已删除 |
| C2 选择/焦点 | 跨三条已加载消息拖选、反向滚动、复制；行内编辑保持焦点；背景append/prepend | 选择范围与复制内容一致，活动编辑器不被回收；记录公开保留机制及资源上限 |
| C3 结构保位 | 冷长短行prepend；同时append；补洞中插；删除锚点前行；删除锚点本身 | 存活内容按当前运动保位；只有真正消失才按邻项规则替代；无外部scrollTop/scrollBy抵消 |
| C4 长文内部 | 读到超长消息中段，前段插字/改写，字体/图表晚到，横竖屏变化 | 未改写文本位置可追踪；段内连续性成立，不只测消息外框；不冻结全文或强制用户接受更新 |
| C5 快速物化 | 冷缓存、快速反向/连续触顶、预取完成与live/输入同时发生 | 已供给内容不出现整屏空窗；输入/解析/DOM/内存均在§12预算内；不在手势里flushSync预测量 |

选型记录必须区分“库公开保证”“接入实现保证”“本场景运行证据”。现有组件失败时先给最小复现，再比较受支持升级/上游修复/成熟替代，记录许可、维护和包尺寸。不默认所有库都能满足，也不默认必须fork；任何超出当前技术边界的方案重新做明确决策。C门槛是工程任务，不要求用户替工程师选API。

### 2.2 L1：等待区布局的产品冲突必须明示

三个条件不能在固定矩形阅读区里无条件同时成立：①空等待区不占位；②状态变化不能改变外部布局；③从空到非空的展开等待区既可见又不遮挡阅读区。R2擅设常驻128px不是已获批准的解决方案。

实施前记录主线默认外观、展开/收起/空态及实际尺寸，只测量不改产品。可裁决的方案：

- 固定且有界的等待槽：同一用户选择下状态不改尺寸；空槽也存在，因此需要批准空态外观变化及尺寸。
- 默认只保留紧凑入口，用户主动展开才分配空间：状态不改尺寸、展开可达，但改变默认展开交互，需要批准。
- 保留空态零占位且自动展开：必须允许该任务状态转换改变布局，和当前要求冲突，未经明确改约不能采用。

本规格不替用户批准任一变化，也不通过遮挡规避冲突。W7的输入增高、32px、移动隔离可按既有批准施工；等待区外框策略在L1定案前不得标完成或部署。状态证据W5与此布局决策独立。

### 2.3 既有能力和成本门槛

J7冷态全集恢复用既有查询的真实可见历史样本核算扫描页数、带宽与完成时间；没有固定成本活跃全集接口，不承诺O(1)。已确认的发送幂等不再申请后端新协议。服务端attach等待只在实际分段计时证明瓶颈后提出BE-01，不阻止其余前端模型施工。跨设备能力未有授权接口则如实保持该需求待决，不假称本地持久化覆盖了它。

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
  activate(view: ViewKey, target?: ExplicitTarget): Activation;
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
  // 实际提交及每次被延迟的动作执行前，读取ReadingPort最新授权。
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

### 4.3 调度与取消

DemandSpec包含key、view、anchor或range、intent、urgency、deadline、revision。 acquire返回的handle生命周期独立于某一网络请求；release降低/移除该消费者需求，其他消费者仍需要时不取消共享工作。

优先级为当前必需首屏/缺口与可见历史，其次用户导航解析，然后预热；同一层使用轮转，追新不能永久饿死上翻。初始预算采用全局2个历史请求、每频道1个历史请求；控制补证单独全局2/每频道1，合并同目标，过期预热先取消。这些是客户端调度默认，不新增wire字段；性能验收可在记录内调参，不能放开为无界并发。

页处理：校验request/generation/key → 累积完整批次 → 接到有效page_end → 原子安装可见消息及扫描证据 → 发布需求进度。scan过滤导致可见seq不连续不等于消息缺失；错误/缺page_end不写成功coverage。取消后迟到的合法事实可幂等合流，但不推进已经换identity的任务、不创建定位。

## 5. W3：阅读、导航、提交与恢复

| 事件 | ReadingSession转移 | 允许的副作用 |
|---|---|---|
| activate(view,target) | 新activation；显式target优先，其次saved mode；saved following即使带旧bookmark仍following | 仅本次一次初始授权；数据不足保留resolving，不重挂循环恢复 |
| 主列表用户接管 | 增inputEpoch/revision；browsing；旧导航cancelled | 立刻撤销旧执行权，包括issued，不重写旧导航携带的epoch |
| 同一次有效用户向尾运动到尾 | following | 后续append可跟随；无因果用户运动的atBottom不转mode |
| 回最新/明确目标 | 创建唯一id，resolving→issued | 当前activation/epoch授权后调用候选组件；目标不存在明确失败 |
| 导航结果 | 仅相同id、原epoch、当前activation且状态issued可completed | 过期完成/失败忽略；取消状态不能被回调复活 |
| history/live/cache/resize | mode不变 | 只提交内容或观测；没有构造导航的函数入口 |
| filter/channel变更 | 保存旧view有效版本，激活新view | A→B→A旧A回调无新A写权，不能只给列表换key |
| 列表不可见/0尺寸 | 暂停物理观测 | 不将无效bookmark覆盖原有效书签，不销毁输入草稿 |

主列表输入归属包括wheel、触摸、键盘、滚动条及辅助输入；嵌套代码块/输入框的输入先归实际容器。只能结合短生命周期输入证据与实际滚动观测恢复following，不能长期保留“曾向下”标记。选择期间暂停自动跟随，选择结束不暗发跳尾。

CommitCoordinator接收统一ViewUpdate；base过期就用当前事实重投影，不能丢弃其中合法新事实。数据与changes同一提交版本进入列表；旧follow策略不能随异步正文结果固化。后台普通变化只交付preserve/follow策略，**不能包装为navigate-preserve命令**。纯prepend同时提交真实新增量与数据，中插/删除/混合必须按候选组件已验证机制执行，不能伪造firstItemIndex或强制remount。

几何只有组件执行。应用不写scrollTop，不用scrollBy修正文偏差，不维护测高树/spacer/reservoir，不在history回调restore。组件自带底部策略也必须服从当前授权，不能另跑rAF尾随。浏览器原生锚定按组件支持配置，不能形成第二补偿源。

Bookmark含messageID、blockID、文本定位证据、块内偏移、viewport内偏移及layout/contentRevision。文本定位需实际字符范围或可验证语义位置，不恒写0。暂未加载仍解析目标；确认删除才按存活文本→块→消息→旧序列后继→前驱→已知空降级。缩短内容引起不可避免范围钳制不转换阅读模式。

## 6. W4：稳定展示和真实增量

实体身份来自消息/提交稳定ID，顺序来自事实；不能用数组下标、latest或父线程是否已加载决定同一条消息的外层身份。local echo落账后更新同一根组件和内容身份；重复ID去重用持久索引，不每token扫描全部landed IDs。序号落定引起位置变化如实提交changes，由列表保当前阅读。

PresentationSnapshot拥有不可变实体内容及拓扑版本、顺序索引版本；content-only更新保留未变化实体和顺序引用。依赖索引定位受影响行/块；纯顺序变化也要产生changes。允许分页索引有O(log n)/局部重建成本，禁止将复制整个Map/数组包装成“只有一个token变化所以O(1)”。

ContentRenderer的块匹配先用前版存活解析节点与局部编辑范围，再用明确邻接/类型/内容证据；startOffset是定位信息不是稳定ID。歧义时生成新节点并报告实际replacement，不能错误复用旧图表。流式未闭合语法可能使已显示前文失效，按解析依赖重算；不冻结正文、不默默延迟到用户停止阅读才提交。

worker/异步结果至少携带DataKey、contentRevision、解析配置版本；尺寸相关结果加layoutRevision。结果过期丢候选而非新事实。已完成稳定块可缓存复用，缓存有容量及失效策略。图片、字体、数学/图表、作者头、代码换行、反应和错误占位都属于几何来源，进入同一组件测量边界。

Choices初始化只在实体首次进入该用户展示域时发生，记录当时合法默认，随后只由用户选择改变。失去latest不收起，回收不丢展开；修复latest不能把全部长文一律改默认折叠。折叠/详情状态不掺任务queued。持久恢复晚到只补未更新记录，条件revision写拒绝旧视图覆盖。

## 7. W5：既有消息证据上的任务展示

TaskSnapshot分三项而非一个ready布尔值：`items（逐任务证据）, discovery（集合发现范围/游标/完成性）, freshness（当前校准状态/错误）`。Evidence记录来源消息ID、requestID、actor incarnation、实际status/terminal/controls、边界和查询关联。日志默认processing不是执行证据。

冷启动流程：

1. 本地索引只提供候选requestID和已持久终态，不恢复“当前queued”。安装当前身份和既有view后创建补证兴趣。
2. 对已知候选使用已存在的system.log.query related_to/raw读取实际关联响应，按next_read补齐所需payload。终态优先事实不会被迟到旧queued反转；不同边界/actor incarnation的非终态不能盲比时间。
3. 对未知任务另走现有可见request分页发现；按查询提供的snapshot/cursor续读，持久化已发现索引及扫描证据。空scan-limited页继续，不宣布全集空。查询自身和其响应不被再次当作待查业务任务递归触发。
4. Native按manifest支持的agent.status核对work或分页，作用域限定实际actor incarnation；Base不可调用并不存在的status，也不可用会入队的agent.queue查询。
5. 每项known-at与集合complete-at分开发布。只有完整合法范围/集合证据才显示“全部无等待”；已知若干项结束不能推出全集空。分页未完给出真实发现进度和可恢复错误，不展示假空或永远不再推进。
6. 新live继续更新证据；重连提升校准兴趣，不擦掉终态。获取有限H后有新H保留dirty，在既有预算内继续。

必须记录冷态扫描代价，不能为等待区把所有正文解析/挂DOM。若现有生命周期语义或权限视图无法证明当前活跃全集，明确哪项无法证明、已尝试的现有查询和可见结果；J7该部分不签通过。需要后端时提交BE-02最小提案，而非默认新增control projection。

操作按实际word schema/capabilities构造既有request；expected_hold_id只在实际合同要求/允许时传。多actor能力差异不是legacy。客户端pending-command与后端状态分离；错误/失效权限不会把本地命令假装执行完成，未知状态也不能启用未经授权的破坏操作。

## 8. W6：草稿、Outbox与确认

草稿key按principal/channel/编辑上下文，保存draftRevision和editorRevision。跨tab更新按IDB条件版本写，冲突保留双方内容；恢复时只补未修改字段/记录，不替换当前整份草稿map。IME和selection由编辑器局部持有，接收live不重挂编辑器。

目标事务入口 `acceptDraft({key, expectedDraftRevision, immutableFrames, recoverableAttachments})` 在同一个IDB事务中写入outbox记录，并消费**匹配版本**的草稿。多接收者一次接受要么全部可恢复记录入库，要么不清稿；之后每个接收者传输结果独立。附件必须有持久内容或稳定合法引用，不以object URL充数。

每条帧在接受时固定messageID、channel、kind/type、payload、audience、parent、visibility及显式expires_at，重试不重新计算。事务失败保留输入。事务成功后UI仅在editorRevision仍对应接受版本时清除对应内容；用户已继续输入则不clearContent。部分成功显示每个目标状态，不能失去失败目标的可恢复内容。

提交状态转移：durable-queued→transmitting→accepted→landed；连接中断可uncertain，拒绝rejected，未发取消cancelled。feed先于receipt可直接landed，迟到receipt不回退；两个来源按同ID只合出一个气泡。后端已有同ID同语义持久化去重，不新增协议；鉴权/过期拒绝不证明先前没落账，走现有view对账。

发送租约按记录CAS取得/续约/释放，跨tab崩溃接管仍用原帧；租约只是客户端并发控制，不宣传exactly-once。禁用账号级delete-all/replace持久提交，单记录状态条件更新。数据缓存清理不能删除未发送意图。

一次性迁移保存旧草稿、可识别待发记录和Choices；记录schema/owner/来源及导入版本，成功前不删来源，重复执行幂等。身份不明的旧数据隔离待用户确认，不错误分配给当前账号。不能为了“无legacy实现”丢用户文本，也不为了迁移保留旧运行控制器。

## 9. W7：页面布局与环境

ConversationSurface是唯一分配阅读区/输入栈尺寸的组件；Composer只报告可增长内容尺寸，不知道消息滚动坐标。状态栏固定占位；任务内容槽按L1裁决，计时、网络错误、数量只换内容/内部滚动，不反馈外框尺寸。不能把整个overlay的所有resize直接当作合法内容增高。

正常窗口：可用高度H扣除Header/安全区，输入栈分配O，间距G=32px，阅读区V=H-O-G且V不低于M。回复/附件/输入或用户展开可调整O，列表保持当前阅读策略。到预算上限输入栈内部滚动，发送/取消等必要按钮可达。极小窗口采用外层可达性滚动，不产生负高度或不可点的遮挡。

相同Surface合同用于正常、初始无数据、已知空、权限拒绝、错误页面；不能只有Timeline包Surface而private-empty仍在旧Grid。移动目录独立全屏Surface，隐藏工作区不得参与其布局、焦点或命中。Preview/Terminal各自限制溢出和尺寸，下载入口与返回焦点保留。

layoutRevision来自有效宽高/字体环境，0尺寸观测不重置bookmark。键盘visual viewport、安全区、缩放、横竖屏、地址栏折叠由Surface消化；内容模型和列表接收合法布局变化，不触发重建频道/重清缓存。focus恢复使用不滚动语义，禁止子正文自动scrollIntoView祖先。

## 10. W8：统一接线、删除和迁移边界

最终生产链只有 `App身份/路由 → 同步与语义需求 → Replica → Presentation → CommitCoordinator + ReadingSession → MessageList`。Composer/TaskView/Surface订阅各自数据，不经Timeline巨型effect互相驱动。Timeline只组合显示和转发意图，不拥有第二套history/follow/height状态。

在切换新入口的同一整体验收版本中：

- 删除旧conversation-viewport、history-interaction、measured-layout及旧VirtualTimelineAdapter/useConversationViewport控制机制；实际路径以逐路径表和主线调用图核实，不能靠命名猜删。
- 不引入R2的62个vendor文件、reservoir、preparePrependSizes、preserve导航、外部scrollBy、惯性/滚轮同步预测量。
- 删除v6/channel_control生产依赖、v6测试fixture和对应mock能力；保留现有v5及其真实失败合同。
- 删除重复following ref、加载完成restore、周期钉底、状态改变外框的观察链。保留真正能力发现逻辑，不能把它误叫兼容代码删除。
- 旧测试有效场景迁到新黑盒oracle；只断言旧实现存在的测试改写。记录每项删除测试的替代ID，禁止一删就宣称测试通过。

静态依赖审查检查所有滚动写入/API调用来源、Navigation构造来源、IDB事务边界、外部可变引用和生产import图。旧代码归档可留Git历史，不以未引用整份源码长期放src里。包依赖与项目维护的锁文件一致，最终组件版本及许可记录可追溯。

## 11. 集中review及行为测试施工

以下为待实现测试套件名/覆盖合同，不表示文件已经存在或运行通过。每个失败回到owner修正，不在相邻层加反向补偿。

| 套件 | 覆盖与独立oracle | 工作包 |
|---|---|---|
| sync-obligations | probe成功后catchup失败、重复兴趣、无下一push、有限H、存储失败、账号/world/generation交错 | W1/W2 |
| reading-authority | saved following+旧bookmark、A→B→A/筛选激活、issued取消后晚completed、同步输入授权、旧卸载条件写 | W3 |
| presentation-integrity | 输入快照被外部尝试修改、纯重排、混合insert/delete、正文前插块ID、echo合流根DOM、latest/回收选择 | W4 |
| task-evidence | 有request无reply、旧queued晚到、终态不在当前页、actor更替、scan-limited空页、集合未完、查询自反馈 | W5 |
| durable-submission | 接受事务每个失败点、晚恢复、发送中继续输入、多接收者部分失败、receipt/feed排列、重开/租约竞争 | W6 |
| surface-accessibility | 全页面状态、L1空/非空/未知同选择、输入增长、32px、末条真实点击、Android键盘/目录/Preview | W7 |
| architecture-boundaries | 单几何执行者、无后台导航出口、无v6依赖/修改后端、无旧运行控制器、有效旧测试映射 | W8 |
| behavior-model-fuzz | 用户目的reference model与U/B/E事件生成、异步顺序/故障、独立不变量和推进oracle | 全部 |
| behavior-browser-fuzz | 生产列表/正文/编辑器真实输入、网络/缓存/媒体/尺寸受控交错，内容位置/选择/可达性/消息与草稿oracle | 全部 |

必须具名执行原42条及N01–N12，不用随机总数替代。另增Q01–Q20对应回归，其中Q03/Q05/Q06/Q14/Q15列为必杀变异：故意恢复错误实现时应稳定失败。

模型fuzz由独立reference model描述可见事实、用户阅读意图、接受的草稿和未完成义务，不复制生产reducer。生成合法事件前置条件，并专门生成迟到/重复/失效输入。记录seed、调度顺序、身份版本、coverage证据及快照摘要；自动缩减失败轨迹。覆盖报告包括事件×状态、关键双事件交错、生命周期转移，不能拿950个随机参数谓词充当950条UX轨迹。

浏览器fuzz使用生产组件而非替身列表，真实wheel/键盘/pointer，移动惯性/IME另用真实Android补证。包含进入无缓存无push、快反向触顶历史注入同时live、任务跨端终结、输入时缓存恢复、切频道时晚页、媒体resize时接管导航。测试服务器只模拟现有协议；端到端再对未修改的实际后端核验。不发送真实业务破坏请求来做随机压测。

测试命令在W8落入现有package scripts，并在报告保存准确命令、版本、测试数量及失败种子；本规格不捏造尚未接入的脚本已可执行。模型/组件/端到端/设备证据分开报告。

## 12. 验收预算与判据

以下是施工验收目标，**不是已测成绩或候选库能力承诺**。W0记录参考设备、浏览器、刷新率、电源/节流、网络和恢复后基线；达不到不得静默调低合同，先归因与设计裁决。

支持负载至少包含：本地100,000条历史、当前展示模型2,000条异构消息、单条100,000字符长文、冷态50条历史页、持续每秒10条live和每秒20次流式内容更新；分别测压力再测组合。消息附件/图表规模和文本样本固定进fixture。桌面宽1100与移动390只是布局参数，不代替设备配置；再覆盖极小高度、横屏和分栏。

| 指标 | 通过条件 |
|---|---|
| 无输入阅读连续 | 仍存活且未改写内容的viewport相对坐标偏差≤1 CSS px，不累积；不只测最终位置 |
| 手势中连续 | 与相同输入对照轨迹/真实运动证据比较，保留用户运动；不把wheel.delta当实际位移 |
| 空窗 | 已具备可显示内容时不清空整个视窗；区分缺数据边界、解析未就绪与虚拟回收造成空白 |
| 输入延迟目标 | reference设备压力场景p95≤50ms、p99≤100ms；记录采样范围/输入到可见结果；IME不丢字 |
| 主线程工作 | 前端可拆分后台批次目标≤8ms；交互场景归因到本次处理的>50ms长任务须消除或形成明确未通过项 |
| 资源 | 常态DOM随视口/有界缓冲增长，不随100,000条历史增长；活动选择另记预算；内存无随往返次数单调泄漏 |
| 数据推进 | 在线、权限和所需接口可用前提下，有限需求满足或有明确可恢复错误；无push仍完成初始内容与校准 |
| 输入与任务正确 | 持久失败不清稿、晚成功不清新稿、同ID一个气泡；无证据不假queued/假空，补证不被静默丢弃 |
| 可达性 | 最后消息/按钮通过真实hit-test与点击；32px及状态几何合同、移动目录独立；键盘下必要操作可达 |

逐帧rAF记录与视频/真实设备互补，不声称观测到全部合成线程帧。库只能提供最终保位但中间闪动，不能以最终差≤1px签C3通过。网络永久断开不要求数据凭空到达，但已有内容和本地草稿必须可用、失败状态清楚。

## 13. 发布、回退及施工证据表

每个包维护一行：需求/场景ID、R2来源SHA和路径、目标实现入口、删除项、测试及artifact、review结果、未决风险。W8另出实际删除清单和后端零修改核对。无证据项不得标complete。

整体实现完成后集中review：先权限和协议边界，再状态/事务/并发，再组件几何与所有布局来源，最后性能及测试oracle质量。修正后运行集中套件及build。构建不等于授权复制dist或重启服务；本次文档任务不执行这些动作。

发布前独立核对四件事：源码提交、依赖与产物指纹、服务实际输出的入口/assets、浏览器实际加载版本与协议。保留上一可用产物及兼容用户数据的回退方案；不能回退源码后用旧新混合assets自称恢复。发布验证包括冷热缓存、无push首次进入、v5不匹配明确报错、阅读/发送/任务和移动目录冒烟。

F29“恢复后消息不见”仍是未诊断运行问题。若开始处理它，先只读定位连接→view/历史返回→Replica→Presentation→DOM哪一层缺失，不清账本、数据库或用户缓存试运气。此文档和分支核验不声称已修复F29。

## 14. 本次裁决

已完成的交付是：固定分支事实、逐路径移植/拒绝/删除清单、Q01–Q20代码核验、W0–W8完整施工与验收规格。不是从零重做，也不是整包恢复R2。

尚未关闭的准入证据为C1–C5、L1具体布局选择、J7冷态集合的实际成本及目标设备预算。C/成本/预算由工程工作举证，L1涉及产品表现需明确裁决；它们都有负责人、具体动作和通过条件，不能把“未决”藏在实现中补丁化。现有前端主体能力不要求先修改后端；若实证触发BE项，逐项提交具体后端范围获同意，绝不以本spec代替批准。
