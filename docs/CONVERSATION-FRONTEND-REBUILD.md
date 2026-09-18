# 会话前端系统架构重构 — R3.3 单一组件执行接入设计

日期：2026-09-17。状态：系统职责与前端施工已获准在当前工作树实施；用户确认产品只有回到底部，没有任意消息/引用/search定位。Legend迁移C1 0/3后已安全回退**React Virtuoso 4.18.13单一生产实现**；误名`LegendMessageList.jsx`内部实际为Virtuoso，`@legendapp/list`只剩残留。六hashfuzz v3仍为1/7；当前W3另有explicit latest与ordinary-follow高度各0 writer、latest提前清unseen三条红门，完整浏览态send仍有intent1/write0。W4 latest入口已有模型37/37与完整App1/1，但高度事务及stream→terminal正文key连续性未闭。W5第二权威已删除，canonical Replica waiting链focused78/78、build/diff-check与真实browser1/1定向通过；compact只保lifecycle closure，不保terminal正文/错误摘要。最近完整unit843/843早于这些改动，现树没有同freeze完整unit/browser/fuzz/build总账。W2 semantic unit等结构P0仍开。继续只用既有Gateway/Scheduler，无后端或协议改动；当前不能冒称全部验收、交付或部署，事实以[执行与反证检查单](CONVERSATION-EXECUTION-REVIEW-LEDGER.md)§0为准。

施工入口：[完整施工规格](CONVERSATION-IMPLEMENTATION-SPEC.md)。来源与取舍：[R2逐路径核验](CONVERSATION-BRANCH-IMPLEMENTATION-AUDIT.md)。本稿定义系统合同；spec定义W0–W8的移植、接口、接线、删除和验收，不再以架构原则代替施工计划。

状态口径统一见执行账§0：已实现/已接线、定向通过、完整验收通过、失败/未闭、历史候选五类不得互换。UX当前状态以[UX索引](CONVERSATION-UX-MODEL-AUDIT.md)顶部表为准；原42条、N01–N12、F01–F29与Q01–Q20是追溯集合，不是通过计数。

## 1. 本次审核的基线与目标

用户需求没有缩小。交付对象仍是完整会话前端架构：进入及持续同步、历史阅读、内容变化、阅读恢复与回底、输入发送、等待区与相邻页面。要替换错误状态模型和控制路径，删除旧实现；不能通过拆文件、隐藏消息、关闭历史读取、永久 unknown 或降低测试标准交付。

唯一范围修订：**尽量使用现有后端；任何后端变更都必须先提交具体方案，取得用户对该范围的明确同意。** 整体前端施工授权不包含后端变更授权。后端能力不足是需举证的依赖，不能以需要“权威状态”为由自行设计新协议、数据库投影、trigger 或 Gateway 分支。

前端是 human actor 的 Gateway 界面。它消费已有 view，将用户意图按既有能力发送 request message；不成为任务调度权威、账本权威或拥有额外权限的 BFF。既有传输控制按现有合同使用，不赋予浏览器新的业务权力。

历史审核读取的源码基线：前端 `master@28abef1a15e3`、后端 `8441c2fa5ade`；当时后端用户TUI已提交为`125bf517`，不属于本次施工，不得以旧审核SHA回退它。历史R2来自 `refactor/conversation-architecture-r2@1cadf76`，全文保存于 `archive/`。此前回复中的纯前端稿未出现在该分支提交，不能以回复冒充文件。本次继续修订现有r3三份文档，不切分支，不重新创建或清空工作树。

本文取代 R2 和 R3 的列表执行权决策；§7–10的同步、任务、输入及布局义务不缩减。旧同步/视觉规格与审核文件仍是历史要求与证据；其完成结论、后端方案或“组件必然独占几何”的决定不能自动继承。需求追溯见 `USER-REPORTED-ISSUES-RECONCILIATION.md`；全部场景仍见 `CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md`；旧审核证据见 `CONVERSATION-FULL-ARCHITECTURE-REVIEW.md`。当前三份主文档以本稿、施工spec、执行账为准，历史文件不是另一个可选实施方案。

### 1.0 当前方向：阅读模型授权，单一成熟组件执行几何

撤回“已有候选不满足，所以必须自研ListEngine”的推论。被动TanStack、商业MessageList与自有引擎均为历史提案；有限失败/未知不能推出整个React生态不可用。自有尺寸树、spacer、prepaint补偿算法退出当前施工指令；执行账§7/8仅保留历史，不作为并行fallback。

当前推荐边界为 **ReadingSession → 唯一ListAdapter → 成熟列表组件几何**。应用拥有阅读意图、事实和内容身份；组件拥有测量、虚拟范围、回收、保位及当前回底/follow执行。Adapter只映射公开props/API，不持第二份尺寸/offset目标，不计算像素差或发保位命令。

有界生态初筛及三库取消源码核验仍作为事实保留，但它们研究了超出产品的任意Index/Item导航。缺通用cancel不等于不能完成真实聊天。当前只沿React Virtuoso 4.18.13与Stream官方VirtualizedMessageList核对实际路径：initialTopMostItemIndex初始化、真正不连续消息集key、firstItemIndex prepend、followOutput append、组件ResizeObserver及一次回底。Stream的自己发送强制回尾、focus回尾及highlight消息定位不是Atoll产品，不照搬。

Virtuoso 4.18.13 #1493确实将prepend deviation在renderer layout effect确认后同paint补偿，未确认仍走下一帧fallback；这纠正“4.18.13无相关修复”，但不自动签过全部C3。当前唯一与取消相关的真实止损轨迹是：append尾随或点击回底后，用户立即向上并叠加resize，不能被再次拉回。先用公共接入验证该可达路径；不能用虚构目标导航要求fork，也不能因Stream采用就免测。

应用通过稳定内容单元、增量解析、媒体尺寸、选择与组件协作；不要求库理解任务/业务段落，也不声称稳定key解决所有几何。冷混合更新、段内/选择、快滚和真实回底交接仍有具体门槛。前端实现、依赖安装、接线与测试已经发生；仍不授权fork、依赖源码修改、后端协议/服务修改、部署、分支切换、提交或推送。

### 1.1 不降低的验收目标

- 后台数据变化不能改变用户阅读目标；用户继续滚动时保留已发生的运动。
- browsing 时保持仍存活阅读内容的位置，following 时跟随尾部；两者不能由 loading/resize 偷换。
- 历史触顶、异构冷行、并发 live、长文、展开收起及快速反向滚动，均要求不抢定位、不暴露已加载内容空窗。
- 每次进入、重选及恢复均主动建立同步义务，无下一条 push 也能获取已有最新内容；错误不会吞掉义务。
- 消息事实、任务状态、用户展示选择、阅读状态各有权威；缓存不能复活已结束任务。
- 弱网下本地接受、草稿恢复、local echo、确认合流正确，输入法与输入响应不受历史处理拖累。
- 原移动目录、Header、Preview、下载入口、默认展开和外观保持；32px间距、内容自然增高与控件可达性同时满足。
- 原 U01–U16、B01–B06、E01–E06、J1–J7、42条轨迹与F01–F29全部保留，新增场景不能替代旧场景；逐组施工/验收映射见spec §11.1。

## 2. 权威、模块边界与数据流

| 唯一 owner | 持有与产出 | 无权做什么 | 失败归属 |
|---|---|---|---|
| GatewayClient / SyncSession | 既有协议适配、连接/attach/校准状态、请求关联和超时 | 改协议、写DOM、替后端宣布任务状态 | 假连接成功、校准丢失、晚答复错频道 |
| Replica / Storage | 当前权限下可见事实、去重、扫描覆盖、内存/持久进度 | 持有折叠、位置、行高或推测运行队列 | 假coverage、串账号、丢消息 |
| HistoryDemand / Scheduler | 持续语义范围需求、来源选择、优先级、重试和公平预算 | 请求结束后恢复位置、UI循环取下一页 | 触边不取、饿死需求、重复请求 |
| Presentation | 不可变实体/块、顺序索引、依赖索引与准确changes | 发请求、创建导航、直接读可变turn getter | 身份/顺序漂移、全量重解析 |
| PresentationChoices | 用户展开、图表、详情等选择 | 缓存queued/running；因latest改变选择 | 回收丢展开、后台自动收起 |
| ReadingSession | following/browsing、语义书签、用户输入版本、回底意图 | 将加载状态变阅读模式、维护尺寸树或通用导航任务 | 错误跟随、恢复重复执行、回底后抢用户 |
| CommitCoordinator（逻辑职责） | 配对展示/布局版本与当前阅读授权 | 独立following/browsing、像素补偿或另一个导航任务 | 旧策略随新数据提交、并发撕裂 |
| ListAdapter | initial/firstItemIndex/key映射；以当前已提交ReadingSession仲裁唯一即时回底入口；可见观测 | 尺寸树/spacer/锚点差值补偿、第二following状态、私有guard或重试队列 | 初始化重复、prepend计数错、浏览时错误回底 |
| 单一成熟列表组件（当前生产为Virtuoso 4.18.13安全回退） | 测量、范围/回收及公开prepend/size保位；具体tail协作仍须当前冻结证据 | 业务阅读意图、同步或内容身份权威；不得同时存在两条连续tail writer | Legend迁移C1 0/3失败已退出生产；当前C1/takeover4/4与+28轨迹1/1绿，prepend白帧、fold control、bookmark物化与initial仍开 |
| MessageList / ContentHost | 组合唯一Adapter、稳定内容DOM、只读语义及活动节点观测 | 自己决定范围/目标、另起restore/follow/resize循环 | DOM提交错版、节点重挂、文本身份失效 |
| ContentRenderer | 稳定块、局部解析、媒体容器与渲染降级 | 滚动祖先、自动聚焦、越权改折叠 | 段内重排、旧图表回写 |
| ConversationSurface | 阅读区、输入栈、可用尺寸及可达性 | 网络/任务状态驱动外框、写消息滚动坐标 | 遮挡、32px错误、移动导航污染 |
| Composer / Submission | 草稿、IME、附件、本地意图、receipt/feed合流 | 用本地pending代替后端queued | 清稿丢失、双发、输入卡顿 |
| TaskView | 将现有view/响应与完整性证据投影为任务展示 | 自造后端控制协议、从缺terminal推出queued | 过期等待状态或真实任务遗漏 |

这些是状态所有权，不要求建立十二个全局store。一个模块可以实现相邻职责，但写入入口、数据生命周期与依赖必须可检查。

事实流：`Gateway/cache → Replica → Presentation → 当前ReadingSession策略配对 → 唯一ListAdapter → 当前单一成熟列表组件 → ContentRenderer`。
意图流：`用户/明确路由 → ReadingSession、Composer或业务请求 → 对应owner`。
几何流：内容/Surface变化仍由组件测量；公开List commit、高度通知和现有scroller尺寸通知只提示Adapter用**当前已提交**ReadingSession重新评估是否即时回底，不携带旧授权。List commit的同turn microtask仅用于等公开handle与owner layout effect发布并合并同次commit，不读取尺寸树、不循环重试。可见内容和输入归属观测用于书签、已读、HistoryDemand。Adapter不建尺寸树、差值补偿、RAF重试或第二following状态。

### 2.1 全部位置变化入口与授权链

| 入口 | 谁授权什么 | 唯一执行与禁令 |
|---|---|---|
| 初次进入/返回 | ReadingSession保存的following或browsing书签 | 挂载前解析为initialTopMostItemIndex/公开restore输入；cache晚到不二次恢复 |
| 真正频道/不连续消息集切换 | 新activation及对应初始阅读策略 | 合法新组件生命周期/key；不能在同频道输入时伪remount |
| 点击回最新 | 用户创建一个回底意图并进入following | Adapter在latest已安装后对当前已提交证据公开`scrollTo({top: 当刻scrollHeight, behavior:'auto'})`；同一意图可在后续新的data/layout/viewport revision继续由同一issuer跟随，不是通用目标导航 |
| wheel/触摸惯性/拖条/键盘/辅助输入 | 浏览器真实运动，ReadingSession按归属改意图 | 不preventDefault仿真，不把scroll通知当用户授权 |
| live/流式 | 当前following且同activation/inputEpoch仍有效才尾随 | 内建follow恒false；公开List commit与data/layout/viewport通知只触发同一Adapter issuer重新核验；每个新的已提交证据revision最多一次公开即时`scrollTo`当前底部，同一revision不重复，浏览不发，Content无滚动ref/命令 |
| prepend/cache/补洞/删除/mixed | Presentation真实data，浏览只保位/必要钳制 | firstItemIndex仅表达真实prepend；无restore/外部补偿 |
| 正文/折叠/媒体/字体 | Content/Choices稳定单元更新 | 组件测量并通知；唯一issuer仅在当前following回底，不算行高/差值；C4检验实际段内点 |
| Surface/宽高/键盘 | Surface只分配尺寸 | 现有scroller RO仅提示同一issuer重新评估；不维护尺寸模型，0尺寸不消费显式意图或存空书签 |
| focus/anchoring/snap/clamp | focus用preventScroll，禁正文滚祖先及主列表snap | anchoring遵循组件保位路径避免双补偿；clamp不当手势 |
| 回底/尾随与用户反向 | 一次回底或有效following；真实向上输入改为browsing | C1只检验回底/append pending或active后是否再次拉回，不扩大为任意目标取消 |
| 错误/重试/恢复 | 只恢复数据义务 | 不回尾、清窗或重挂 |

库内部几何观测不等于另一业务阅读模式。单链审查覆盖全部入口，不只数公开API调用点。

## 3. 正交状态与生命周期

| 维度 | 模型 | 保持/失效规则 |
|---|---|---|
| 身份 | principal/channel/viewKey + activationID | A→B→A产生新activation；旧A无新A的UI写权 |
| 数据世界 | 服务端既有Boot及可用连续性证据 | 当前Boot注释定义为安装世界，普通进程重启不等于换世界；不发明新字段 |
| 传输 | connecting/open/reconnecting/closed + generation | generation只拒绝旧连接响应，不重置阅读/草稿 |
| attach | pending/installed/failed | 关键身份安装成功才installed；持久化不在关键路径 |
| 本地恢复 | loading/ready/absent/failed | absent与failed有区别；失败不关闭合法live |
| 数据可用性 | unknown/partial/readable/empty-known | 尚未拿到数据不等于空；已有内容不因重试清空 |
| 新鲜度 | needs-probe/probing/catching-up/current(H)/error/offline | current针对有限目标H，不是“永远最新” |
| 阅读 | following/browsing + bookmark + revision | history、live、Meta、网络和尺寸变化无mode写权 |
| 回底动作 | idle/issued/observed | 用户按钮，或普通Composer发送**发起时**捕获当前activation/inputEpoch/用户意图revision并在durable Outbox接受时仍匹配，才创建一次；到尾观测或用户反向结束，不持任意目标/重试任务。receipt/feed/retry/控制请求不能事后重建 |
| 历史 | idle/loading/exhausted/error + demandRevision | 独立于阅读；耗尽需要有效页终态证据 |
| 内容 | immutable presentationRevision/contentRevision | 旧候选从当前事实重算；事实不随候选一起丢弃 |
| 展示选择 | choicesRevision | 按业务身份保存，不依赖挂载次数/latest |
| 任务证据 | unknown/stale/known-at(H或既有响应边界) | 历史缓存不授予current；断线/证据缺口不冒充空队列 |
| 布局 | layoutRevision、已提交几何版本、实际尺寸、唯一执行边界的测量 | 0尺寸/隐藏不覆盖有效书签；旧宽度测量不可复用 |

阅读书签按principal/channel/view隔离；Choices按principal/channel/message隔离，真正视图专有选择才加view；草稿按principal/channel/编辑上下文隔离。小型持久记录带schema与revision，各自所有入口条件写，不只保护save。存储条件写拒绝旧激活卸载覆盖新状态。草稿跨tab采用原子版本比较与冲突副本；不能静默最后写胜出。没有现有远端读位置能力时只能承诺本地连续性，跨设备需求保持未满足，不能自创接口或将本地storage称为多端同步。

恢复以已保存阅读mode为权威：following即使附有旧bookmark也不能被恢复为browsing。channel或viewKey改变均建立新activation，不只key重挂列表。输入命令同步提交新的阅读授权后才通知React；reducer不包含持久化副作用，ref不得等下一render才阻止旧follow。

并发优先级固定为：身份/权限有效性→当前activation→用户原生阅读输入→数据/内容版本→有效布局版本。权限撤销可立即移除内容，高于保位；普通掉线不是撤权。数据事实持续合流；重新可见恢复同一阅读意图，不能模拟一次用户回最新。订阅注销、解析取消、需求release只销毁对应activation资源，不清除共享Replica或未发送意图。

## 4. 行为闭集与七个完整使用过程

| 用户事件 | 处理与可见完成条件 |
|---|---|
| U01进入 | 已保存following/browsing书签>新会话最新；在activation初始化决定一次，并行展示已有内容与校准 |
| U02重选/刷新 | 更新同步兴趣，保留阅读；只有用户按“回最新”才一次回底 |
| U03离开/返回 | 保存有效revision；新activation恢复一次；旧卸载/响应不覆盖 |
| U04向上/离尾 | 归属于主列表的输入进入browsing，关闭后续follow；不创建反向程序定位 |
| U05向下/反向/惯性 | 继续阅读；只有本次有效主列表运动真正到尾才following |
| U06触边 | 提前或继续范围需求；失败可重试、真耗尽安静停止；无导航 |
| U07暂停/拖选/复制 | 保持选择、焦点与阅读；选择期间不自动尾随，结束不擅自跳尾 |
| U08回最新 | 取得最新数据后公开回底并设following；新的已提交尺寸/内容可由同一issuer继续跟随，后续向上输入立即回到browsing并撤权 |
| U09（撤回误建模） | 产品没有引用/search/任意消息定位；删除相应入口、状态和选型硬门，不用它否决组件 |
| U10筛选/视图切换 | 新viewKey；保留可见锚点，否则存活邻项；空结果与加载未到区分 |
| U11展开/收起/详情 | Choices提交；保持操作附近内容；不重置整个列表 |
| U12回复/编辑/删除/任务操作 | 既有请求路径和权限；操作不自动导航；pending不等于成功 |
| U13输入/附件/IME | Composer独立更新；自然增高进入Surface；不重挂编辑器 |
| U14发送/重试 | 本地持久接受再清对应草稿；普通用户消息在发送发起时向ReadingSession取得一次性语义token，接受时token仍属于同activation/同用户意图才回底；接纳等待中的上滑或A→B→A已使token失效，receipt/feed/retry只同身份确认合流 |
| U15嵌套滚动/文件/弹层 | 事件归实际容器；原生链式滚动交给浏览器；返回焦点不滚祖先 |
| U16重试 | 仅重试失败的数据/同步/提交义务；不能自动回底或重建整个会话 |

后台事件族：B01历史批次；B02 live/补洞；B03 token/编辑/终态/删除；B04缓存与持久结果；B05 attach/Meta/权限/世界变更；B06 receipt与任务响应。
环境事件族：E01尺寸/方向/缩放；E02键盘/焦点；E03图片/字体/图表；E04 React提交/回收/重复effect；E05后台/冻结/BFCache/强刷；E06存储/网络/解析/资源异常。每族都有对应owner，不将它们混成能写所有状态的“刷新”。

| 使用过程 | 必须主动完成 | 失败与持续推进 |
|---|---|---|
| J1进入并看内容 | 建立会话、展示有效缓存、主动请求初始内容、取得有限H并补齐 | 无缓存无push也取数据；空/无权/离线/失败分别展示；不能只等live |
| J2持续追新 | 兴趣版本→探测→按coverage补洞→完成H→下一次校准 | 请求在途的新兴趣保留dirty；超时后有界重试，不靠下一次点击救活 |
| J3连续历史阅读 | 预取数据和准备正文；触边持续需求；提交保当前内容与运动 | 缺网络在边界等待；已有数据不暴露白屏；live不能永久饿死历史 |
| J4阅读中变化 | live/媒体/正文更新继续应用；Choices、稳定身份与段内语义保持 | 改写/删除当前文本才降到存活邻项；不能冻结整篇或永久延迟更新 |
| J5表达与发送 | 回复、IME、附件、草稿、本地接受、传输、确认构成完整生命周期 | 持久失败不清稿；不确定发送明确对账；用户后续输入不被旧接受结果清掉 |
| J6目录/会话/预览往返 | 各Surface保持边界、可点击、下载可达，返回恢复阅读一次 | 预览失败局部降级；隐藏会话不污染目录；焦点返回不抢滚动 |
| J7理解并控制任务 | 取得既有权威证据、展示有效状态、按能力发request、响应对账 | 未知有主动补证与失败原因；永远未知不是该过程验收通过 |

输入可来自鼠标、触摸惯性、滚动条、键盘与辅助技术。scroll通知不天然是用户输入；嵌套滚动和编辑器按键不得误归属主列表。不能长期保留一个“曾向下滚过”的布尔值等未来atBottom。

## 5. 提交一致性与阅读策略

所有来源先合流至Replica，Presentation再串行产生不可变版本。`Object.freeze`包住可变getter不算不可变。实体的正文、拓扑、展示选择分版本；依赖索引将事实变化定位到受影响实体和内容块。token更新不扫描全频道。

应用内更新合同（不是新增wire协议）：

```ts
type ViewUpdate = {
  identity: { principal: string; channel: string; world: string; viewKey: string };
  baseRevision: number; nextRevision: number;
  snapshot: ImmutablePresentation;
  changes: Array<Insert | Revise | Remove | ExplicitRebase>;
};
type ReadingGrant = {
  activationID: string; inputEpoch: number; readingRevision: number;
  policy: 'preserve' | 'follow';
};
```

应用层在每次唯一回底发出前读取**当前已提交**ReadingSession；通知只要求重新评估，不携带旧following许可。普通data/内容/viewport变化不创建导航任务，只有同一activation/inputEpoch仍following时可经唯一issuer调用公开即时scrollTo。真实回底交接按§6.4验证，不能从缺通用cancel直接推导失败。

异步准备不携带永久有效follow值。旧base重投影、旧应用授权重取，合法事实保留；data/changes同版本提交。请求开始时不留将来恢复用的旧屏幕位置。React render是可丢弃候选，不得写DOM、保存候选书签或把库缓存当已提交视窗事实。

纯prepend必须保证旧身份序列和相对顺序完整保留；纯append只增加尾项；中间补洞、删除、混合变化按真实changes处理，不能伪装prepend、用户rebase或重挂。普通历史补齐不改既有分组头、线程归属和latest折叠。

进入/返回/切频道通过activation初始化，不是挂载后目标导航。唯一显式程序意图是用户点击回最新：数据若尚未到先完成既有最新数据义务，随后公开回底并进入following；同一issuer可对之后新提交的尺寸/内容revision继续跟随，但历史完成、缓存恢复、测量和错误本身都不能创建新意图。用户随后向上以真实运动进入browsing并立即撤权；是否存在迟到拉回只按这条实际轨迹观察。

位置替代顺序：存活文本位置→存活块→消息→旧序列最近存活后继→前驱→已知空。暂未加载不能当删除。权限撤销优先于保位；普通断网不能伪造撤权。合法范围缩短允许必要钳制，仍保持browsing。

## 6. MessageList与内容的公开接入合同

优先公共接入候选为React Virtuoso **4.18.13**。Stream官方VirtualizedMessageList是责任分工证据，不采用其后端/SDK业务默认；[4.18.13 release](https://github.com/petyosi/react-virtuoso/releases/tag/react-virtuoso%404.18.13)和[公开API](https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/)是静态来源，不是本项目成绩。当前不fork、不改库源码。

| 行为 | 公开协作/应用责任 | 未证明部分 |
|---|---|---|
| 初始/恢复 | initialTopMostItemIndex或公开restore输入；值在activation挂载前确定 | cache晚到不得二次恢复；书签数据未到是数据义务，不转成目标导航 |
| prepend | data、firstItemIndex与稳定computeItemKey同次更新；#1493主路径同paint补偿 | mixed/删除及fallback、未确认fallback帧仍按C3实测 |
| append/follow | `followOutput={false}`恒定；append commit只提示唯一issuer按当前已提交activation/inputEpoch/mode评估即时回底 | layout时新尾项尚未物化时能否在首paint前完成：C1/C3 |
| 内容resize | 组件继续测量；公开高度通知只提示同一issuer重新核验当前following并即时回底，不保存行高/差值 | 长文文本点、字体/媒体、浏览中upward fix与选择仍按C2/C4实测 |
| 频道/不连续集 | activation身份或确认不连续message set使用合法key新生命周期 | 连续prepend不remount；禁止同频道输入时伪造key |
| 回底 | 显式意图与自动尾随共用唯一issuer和公开绝对`scrollTo`当前`scrollHeight`；显式意图以intentID参与去重 | 0size不消费；用户立即向上叠resize不得晚拉回：C1 |
| 物化 | increaseViewportBy/overscan/scrollSeek按预算使用 | 缓冲不能证明任意快滚无空窗：C5 |

禁止应用尺寸树/spacer、隐藏行测高、scrollBy/锚点差值/RAF补偿、私有tracker/behavior guard。公开初始化、firstItemIndex和唯一即时回底issuer是当前接入；真正频道/不连续集key也是合法生命周期，不与同频道伪remount混同。不能用新offset命令伪装取消库中已交付的index任务。

### 6.1 阅读连续性的准确判据

保住的是**一个指定的仍存活阅读锚点**及用户实际运动，不是scrollTop。观测实际可见块/文本，不只测整条长消息顶部。未改写、未发生该点自身排版重流且物理可达时，无用户运动逐可观测帧偏差≤1 CSS px、不累积；有手势与真实运动对照。普通prepend/live/cache不豁免。

宽度、字体或当前段落改写会重新换行，不能同时固定所有字符或保持已删文字；按同一语义阅读位置/最近存活点、合法范围及选择/焦点验收，记录reflow/fallback。**前方新增使未改写段落跳走不能冒充“字体重排”；不能把所有内容更新排除出像素oracle。** D01长文段内、B08选择、正常流式与实时更新保留。

用户明确要求阅读不被后台拉走、长文稳定、快滚不闪空；“任意全文编辑/任意UA变化下所有字符每帧≤1px”不是用户明确需求。校正此过强推论不降低前述合同，本稿原先已有物理可行域也不应被误称为完全没有。

### 6.2 Content单元、稳定身份与成本

Presentation维护messageID/blockID及存活解析节点、局部编辑映射；offset/index/latest不作ID。同一个列表内使用稳定展示单元，普通短消息可单项；超长消息按真实语义块形成连续单元，共享消息头/外观/引用/复制和可访问关联，不形成第二虚拟引擎或视觉假消息。粒度按内容类型/版本稳定，不随可见范围反复切块。

| 内容 | 应用责任 | 必测风险 |
|---|---|---|
| 头部/控制条/折叠摘要 | 业务角色ID、独立Choices；latest只决定无override时的默认，不覆盖用户选择 | echo确认/补父关系不能换根身份 |
| 段落/标题/列表/引用 | 稳定块及局部更新；前方新块独立为项，保留当前块 | 当前块内部改写/Markdown回溯需实际文本oracle，不只行顶 |
| 代码/超长纯文本 | 增量解析/高亮，保留原换行和复制；合法语义分块 | 不逐字符DOM，不每token全文处理；不可拆大块单列成本 |
| 图片/附件/图表/数学/表格 | 稳定壳/比例、版本化异步结果；保真才拆 | 不假设表格列宽/图表可随意切固定片 |
| 活动选择/编辑 | 稳定Content key、节点复用与当前可见范围协作 | Virtuoso无Legend式alwaysRender保证；DOMRange/复制/activeElement和资源实测，不先推fork |

稳定块不是冻结正文。token/终态/修订持续合流；未闭合Markdown使前文失效就按解析依赖重算，不等停滚、不要求手动接受。图表/高亮结果带content/解析版本，尺寸相关加layout版本。Content无祖先scroll/focus写权。日期、作者、反应、代码换行、图片失败都属于几何输入；用可计量box/padding，不能漏掉margin。

当前已落的ContentPlan仍不是W4整项完成：Timeline、进度和artifact入口传入稳定业务`contentKey`；有界plan store保留前一已提交版本，render阶段只准备不可变候选，layout commit后才发布；sealed/unchanged sibling以app-owned block ID保留真实DOM和原生selection，单义局部编辑及纯格式变化续用身份，歧义更新显式replacement。bookmark层已提供DOM/纯文本`describe + resolve`与exact/context/block-offset结果；它用保存文本否决cache淘汰后的ordinal假ID，跨ID只接受唯一fingerprint，重复则返回null。列表尚未消费A07语义点作item内部初始化。列表仍以whole message为一个当前组件item，未引入第二虚拟器、行测量、滚动写入或后台完成后的视窗替换。定向6 files/42 tests及build通过；真实Chromium 2/2证明未回收块在流式尾续写/前插时Selection endpoint节点、文本和block节点仍相同且connected，Control+C后`navigator.clipboard.readText()`精确为`sealed`，以及卸载/away编辑/宽度reflow后的context resolver回到目标passage。它们只证明上述内容身份链，不覆盖任意跨虚拟行/回收后的selection。active tail自身改写、coarse超长展示单元、Choices revision/CAS、parser真正局部增量和fold browser仍未完成；128,888 chars/2,500 blocks的纯Node样本首次约426ms、尾append约276ms，说明仍是全量remark parse，长文CPU门明确未过。

正确fold语义是：权威current-entry在无用户override时默认展开；失去该角色且无override才折叠；显式override跨角色变化持久。旧“所有长文包括latest默认折叠”结论已撤回。latest候选由Presentation分类，发布authority绑定exact epoch/view/source/candidate并证明`coverage(candidate.seqHigh→head)`；Timeline `findLast`、loaded rows或`bottomReady`均不是权威。root归一矩阵记录latest request入口已补、模型37/37及完整App1/1；它们只定向签署角色链。`roleRevision + adapter public height ack`仍在集成，role false→true高度与cache-first following/wheel仍是红门。另有新反例：streaming→terminal更换正文key会破坏Selection/实例连续性，必须在Content/Presentation责任层关闭。

该切片的生产浏览器证据不能抹去既有fold缺口：数学/Markdown真实路径通过，但折叠硬断言仍以按钮`201.1875→202.34375`失败。逐帧记录显示折叠后的被测row/list高度已稳定为`539.09375`，随后row高度不变而列表`scrollHeight 3832→3834`、`maxScrollTop 3347→3349`，`scrollTop`仍为3347，按钮与整row同步移动。这与既有列表总高/夹限波动同族；没有证据把它归为ContentPlan块重挂，故既不改`≤1px`阈值，也不在Content层添加滚动补偿。

项数不等于DOM/CPU成本。文本、AST、原子复杂块排版和活动选择常驻量分别统计；常态DOM随视口+有界缓冲。禁止全量挂载、暗清选择或把长文改成复制按钮。选择/节点连续与宽度改变交错由C2/C4验收。

### 6.3 同一更新链，不再定义自有几何事务

轨迹：长文中段原生滑动→prepend+live+前文更新→变宽→点击回底后立即上滑→跨行选择。

1. Replica接纳全部合法事实；Presentation生成不可变next、稳定单元及真实changes。旧候选重算不丢事实。
2. CommitCoordinator配对当前ReadingSession；Adapter同次提交data/firstItemIndex/key，内建follow恒false。render无DOM副作用、不提前发布owner或旧授权。
3. 组件独占范围、测量、回收和prepend保位；Adapter不测行高，只把data/layout/viewport事件作为重新评估提示，经当前owner核验后调用同一即时回底入口。冷首次paint与混合尺寸变动是C3/C5运行门。
4. Surface合法宽高变化交组件；Content稳定壳/块减少无关重流。UA强制字体/缩放不假称可全部拦截，按§6.1和真实设备验证。
5. 主列表向上输入同步把ReadingSession改为browsing并递增inputEpoch；后续所有提示重新读取当前owner而失效，浏览器原生运动继续。已交给库的initial retry及库独立size补偿另列风险，不拿新offset冒充取消。
6. selection更新只改变活动keys/跟随授权及只读语义观测；未改写节点复用，复制/重排/焦点用独立oracle。
7. 有效提交后观测才条件保存书签/已读并驱动Demand；0尺寸不覆盖书签，后台完成无回底出口。

### 6.4 回底与尾随交接：真实门，不设通用导航门

ReadingSession只有following/browsing、书签和一次创建的回底意图。进入/返回由initial/restore初始化；真正频道切换由activation生命周期隔离。普通data/layout/viewport事件不能创建意图，只提示现有Adapter issuer重新读取当前session；只要同一意图仍current/following，新证据revision可触发新的合法执行，用户上滑或activation变化立即撤权。Adapter没有第二following副本、任意目标命令、导航Promise、RAF重试或取消控制器。

Stream以`followOutput`处理append，以一次`scrollToIndex(last)`处理已有最新数据时的回底；它没有通用cancel。这证明缺通用cancel不妨碍成熟聊天接入，但不证明本项目的接管轨迹必过。Atoll不复制Stream自己的消息强制回尾、focus回尾、highlight定位。

C1只保留一个真实反例：在动态高列表底部触发append尾随或点击回底，随即wheel/touch/key/拖条向上，同时最后项resize；向上运动之后不得被组件pending/retry再次拉回底。先按4.18.13公开API正常接入验证。若通过，通用cancel缺口退出准入门；若失败，先区分错误follow策略、错误重复调用与组件具体阶段，保存最小轨迹，再决定受支持配置或最小能力缺口。没有该证据不得fork/vendor，也不得禁输入、冻结数据、伪remount、异步current-offset“取消”或静默删除现有动画。

当前架构复审仍有两个P0：`useReadingSession`四个owner refs、Timeline的reading controller以及initialLocation首次render在render期发布候选，已提交事件可能命中未提交controller；initial ready也缺少绑定current activation+snapshot的nonempty public viewability并经document/Surface visible next-rAF确认。当前集成另有三条即时红门：explicit latest错误等待不会发生的新height通知而0 writer；ordinary following的height路径同样0 writer；unseen在真实visible-tail ack之前被清零。单adapter/单writer静态、cold三态和focused send均不能替这些轨迹签过。

### 6.5 生命周期、资源与关闭门槛

C1只核验真实回底/尾随接管；C2选择/节点连续、C3冷mixed/删除/#1493 fallback、C4段内/字体宽度、C5快反向/物化/资源各自保留独立运行证据，不以Stream采用或类型签通过，也不把一般导航缺口错误带回。当前通过/失败矩阵以执行账§0与§9.10.23之后的增量为准；§9.10.5只是历史冻结。

冷频道的具名三态缺陷已取得**定向**关闭：following且已有缓存行时不再由presentation initialization遮挡，`bottomReady`仍独立守住follow授权；empty-known只在attached、同generation、message current、local replica ready且权威`headSeq=0`时成立，协议/过滤batch不再误报“无相关”。独占production-browser为3/3：cache首paint约385.6ms、无缓存约109ms先给稳定反馈且known>0/body pending不假空、权威known0约126.4ms空态；关联unit为3 files/33 tests，build通过。无新增request/poller、后端或协议修改。这只关闭命名的cold三态，不自动签过bookmark successor/predecessor/seq fallback、权限/错误、隐藏页paint-ready或完整列表初始化门。

删除块由Presentation提供存活关系，ReadingSession保留语义fallback；普通删除先走组件数据保位，不每次借fallback发导航。若公开机制无法保持必要邻项语义，记录C3接入缺口，不在Adapter算offset。A→B→A、隐藏0size、选择和宽度纳入同一矩阵，不以remount重置所有模型。

在现有项目的真实生产接入与回归中关闭能力门；不另开独立demo、不请求商业试用。前端代码、依赖与测试施工已经获准并发生；fork/依赖源码、后端协议/服务、部署、分支与提交仍未授权。C门通过后仍须W1–W8、42+N/F/Q、模型fuzz、真实浏览器/Android验收；候选成功不等于系统交付。

## 7. 现有Gateway上的同步与历史需求

### 7.1 已核验的基线能力

后端 `platform/subjectgate/frame.go` 定义FrameVersion=5、attach、feed、checkpoint、history_before/history_cancel、page_end、submit/receipt；既有 `channel_meta` 也已存在于恢复前的main。读取既有能力不构成新增后端改动；是否要移除这个历史接口属于另一个需批准的后端变更。

AttachReceipt含MembershipsComplete、HistoryMeta和Boot；ChannelMetaReceipt含head/has_rows/activity/generation，**不含当前任务全集**。page_end提供扫描范围、游标、has_older及错误；可见seq允许因权限过滤而不连续。SubmitReceipt给message_id，不能冒充账本seq。

这些是源码事实，不证明当前正在运行的二进制/浏览器产物一定一致。实现要读取既有版本信息并明确报告不匹配，不能写v6适配要求服务器跟着升级。

### 7.2 独立启动与持续义务

客户端连接与本地读取并行；关键attach身份安装与非关键持久化分开。缓存慢/损坏/升级阻塞不拖住合法live；本地身份未确认的数据不能跨账号展示或提供虚假resume。安全空resume必须配合主动初始读取，不能只等未来push。

每频道兴趣状态包含interestRevision、probedRevision、fulfilledRevision、有限目标H、requiredRanges、coverage、请求及重试状态。probe成功只推进probedRevision，所需批次完整安装后才能推进fulfilledRevision；probe成功而catchup失败仍有待办和重试，不检查probedRevision就误判完成。进入/重选/回前台/回最新/显式刷新都更新兴趣；在途新兴趣保留dirty并在结束后补一次校准。重复低级pointer/scroll不逐个发网络请求；连续阅读由持续需求表达。

当前前端实现用connectionEpoch隔离旧连接迟到probe/catchup；真实新attach generation只在旧义务已fulfilled时新增一次interest，pending义务只resume，同generation Meta不重复。`hidden→visible`边沿只给当前频道一次既有channel Meta兴趣，不设interval/poller；已读恢复另由当前activation、真实可见消息Surface与同次已物化high-water证明，不能把页面可见或远端head直接当已读。这些已有定向unit/browser mock证据，但真实服务与完整冻结仍未验。

probe失败保留义务，在线瞬时失败有界退避，离线等待恢复，权限错误显式结束。前台活动频道有可合并的新鲜度复核以发现无push缺口；后台恢复合并过期tick，不爆发重试。没有现有轻量探测能力时仅可使用已支持的有限历史读取/attach语义并记录成本，不能假造新接口。

追赶按扫描coverage补缺口，不按max(seq)；完成有限H就发布进度，新H另建下一轮。前台最新与当前上翻需求都获得进展机会；后台预热最先让路。缓存、live、历史幂等合流；消息行与持久coverage原子提交。内存接收、持久可恢复、用户已读分别记账。

已读语义遵守现有合同；过滤视图看见100不能推断未展示的90已读。其他设备读前沿不控制本页面位置。

### 7.3 声明式历史需求

UI只维护 `{channel, view, anchor/range, intent, urgency, deadline, demandRevision}`。Scheduler独占来源、请求合并、取消、批次和预算；无“UI连续nextSegment直到有可见项”的第二调度器。按照阅读方向、速度与观测延迟提前准备数据和正文，deadline影响优先级，不代表到期可抢定位。

完整批次证据才能推进对应扫描coverage；错误或不完整页不能宣布exhausted。重复页只确认已有事实；实际新增量为0不触发布局prepend。请求取消与阅读意图无关；迟到结果按身份合流或拒绝，没有恢复位置权限。

当前`historyDemand`以`{revision, phase: idle|pending|error}`表达一次语义操作；warm/initial-tail的物理批次只进入`loading/backgroundLoading`事实，不借批次数重启前台条或动画。同一次`loadHistory`跨至少两个物理batch保持同一revision，失败保留error，用户显式retry才创建新revision，EOF按Scheduler证据结束。zero-projection semantic supply edge在anticipatory阶段保持静默，按当前viewSpec/filter跨物理batch推进到first matching或权威EOF；filter切换Abort旧view obligation，只有EOF能definitive empty。MessageList DOM key保持channel稳定，semantic presentation/reading key独立。最新loading/filter Chromium3/3、unit64/64及build绿；此前cross-physical Chromium1/1仍只签跨批呈现。它们不关闭W3几何或完整browser门。foreground loading→可读历史的连续展示仍未闭：允许纯视觉淡入，但必须保留逻辑消息身份、操作与读屏唯一性，覆盖重复事实、快速终结、切频道和reduced-motion；不得移动已有正文、动画主滚动坐标或冻结滚动。网络仍是同一个Scheduler/`history_before`请求链，UI只发语义需求，没有第二poller。

当前历史呈现仍以raw record reservoir/release满足；terminal turn会保留其全部provisional，`loadHistory`虽按`projectTimeline`可见seq循环，仍没有conversation语义unit边界。已批准但未实现`ConversationHistoryProjection`：把可交付conversation unit与控制/临时记录分层，HistoryDemand按unit满足。它复用同一Scheduler和既有`history_before`，不是第二poller或新协议；在实现前，8 raw/256KiB不能冒充8个语义单元或完整呈现门。

### 7.4 后端性能边界

源码已确认：web.go:129起先PrimeFeed，再PrepareHistoryMetadata，收齐后发送receipt并LaunchFeed。session.go:291起对所有非temporary订阅用4个worker读取Meta，共享默认5秒读期限；focus仅在结果收齐后排序，不是优先返回。生产Home的ReadVisibleMeta只读head/可见活动序号和时间，不读消息正文。这里存在全体结果等待，不应再描述为逐频道反序列化正文，也不能把5秒读期限说成整个attach耗时上限。

客户端可以拆掉自身等待、主动消费既有channel_meta、保留失败后的同步需求、并行恢复内容；不能据此宣称消除了服务端等待。是否实际成为此次慢的主因尚未测量。若目标要求移除该等待，则确需后端实现调整，先提出BE-01取得批准；这不自动意味着需要改协议。未经审批不得提前LaunchFeed或改变订阅seam。

## 8. TaskView：权威输入与完成义务

任务事实由既有后端view/合法响应表达，TaskView只是客户端投影。展示旧内容和声明当前运行状态是不同权限。缓存中有request、缺terminal，既不能推出queued，也不能证明无活跃任务。head追平仅证明对应范围，不证明全任务集合。

当前实现状态必须与目标合同分开：会写账本的`system.log.query`生产自动调用已经撤下，`useChannelFeed`里无人消费的`queryLog`端口、waiter、timeout与terminal settle链也已经删除；迟到的既有query terminal仍只作为普通事实进入Replica，不被删除或隐藏。此前接入的TaskEvidence snapshot把同一生命周期复制成第二权威，用户HMR zombie与源码复核否决了这条方向；projection/discovery/hook及其migration/preparing现已从生产删除，旧7/89和三条browser不继承。

W5当前唯一链是`Gateway validated rows → canonical Replica fold → stateless WaitingPresentation → WaitingLayer`。queued/processing/terminal、乱序吸收、内存窗口与root-turn事实只由Replica canonical fold裁决；WaitingPresentation只按当前roster、content/controls完整性和已物化turn派生UI，不持久化生命周期、不发请求、不另建snapshot。HistoryScheduler继续提供通用validated history/coverage，不产生Waiting专用输出或discovery。terminal-first→mobile trim→older request+queued的僵尸反例已由focused78/78、build/diff-check及production browser1/1定向关闭；consumer重复注册/释放泄漏另有StrictMode、A→B→A、卸载及closure40/40与build/diff-check。compact tombstone只保证lifecycle closure，不保terminal正文或错误摘要；这项内容保真与其他任务/操作路径仍未完整验收。不得恢复`system.log.query`、第二后台游标或后端协议。

任务actor作用域另受网络OBS权威门约束：authority token绑定`principalId + channelId + generation`，缓存seed不产生current；generation变化、注销、world重置或访问失效都会撤销旧权威，OBS不完整时保持calibrating而不是假空。WaitingLayer保留逐项`contentComplete/controlsComplete`及集合partial元数据；不完整项可以只读预览，但不得编辑、插入或发送缺失控制。上述78/78与browser1/1只关闭具名防僵尸链，不得扩成全部任务、操作或内容保真通过。

证据路径按成本与能力选择：

1. 已核验Native Agent有`agent.status`而Base没有；这只是能力事实，不授权Waiting自动调用、分页或创建发现owner。`agent.queue`是入队命令，`agent.context`不是任务列表。
2. 对已物化turn，canonical Replica fold按request/response关系、状态闭集和终态吸收裁决；WaitingPresentation只读取结果。终态不能被旧queued或迟到cache反转。
3. 要声明整个活跃集合完整，必须由Replica已经持有的合法事实与覆盖证明；仅几个已知turn已对账不能宣称整个等待区无遗漏。

Base Agent的现成事实来自既有`history_before → HistoryScheduler → Replica`及live/checkpoint；带status的进度帧携带controls，后帧替换，终态清除。history与live都只进入同一个Replica fold；response-before-request由该fold的unmatched/turn合并处理，内存窗口保留开放turn所需事实。Waiting没有固定discovery head、tombstone副本、第二cursor或retry loop。actor更替也不能把旧incarnation的进度变成新actor当前状态。

现有history view不提供活跃队列全集索引；空的scan-limited页不是没有任务。未到origin或服务端view过滤掉生命周期事件时，WaitingPresentation只能把当前已物化开放turn标成partial，不能为填满等待区自动发查询，更不能把未知说成全集空。Base的queued心跳不是定时快照；“任意历史规模下固定成本拿到Base完整运行队列”的能力仍没有从现有接口得到保证。

Waiting不拥有`probing/reconciling`状态机；它只继承Replica/同步的currentness与错误，并以stateless派生显示partial/stale/unavailable。跨连接证据陈旧不能伪装current或空队列，终态也不能因新鲜度未知而复活。

Waiting不创建补证请求或专用预算；普通消息同步继续按自己的需求与内存边界推进，Waiting只消费canonical结果。不能为了等候区把所有历史正文挂DOM或无限扫描。若现有view无法提供完整性，记录BE-02具体缺口；J7仍标未满足，不能把永久unknown当合格替代。

控制按钮只按已知权限/能力发送现有request；本地只显示pending-command。响应或既有view确认后更新结果；不能通过新增expected-version字段要求服务器改变合同。实际接口若不支持并发期望版本，不能虚构CAS保证。

## 9. Composer、Submission与本地连续性

Composer独占当前草稿、回复、附件、IME和selection；消息更新不重挂编辑器、不每键重算Presentation。已知权限与网络连接分开：离线可保存本地意图，传输时重新校验权限；未知/撤销权限不能伪装已发送。

本地事务状态：`draft → durable-queued → transmitting → accepted → landed`，另有uncertain/rejected/cancelled。IndexedDB将outbox记录与对应草稿版本接受原子提交；失败不清稿，后续新输入不被旧版本成功回调清空。附件引用和内容的可恢复性必须纳入接受条件；临时object URL不能算持久附件。

已核验现有持久化幂等路径：humancell.interpretSubmit以submitFingerprint规范化客户端语义，随Post/Emit经Harness传入Store；同频道同ID且指纹相同返回原seq/Replayed，不重复落账或触发onCommit，指纹冲突映射idempotency_conflict。指纹随消息事务持久化，已有并发和数据库重开测试。无需为客户端可靠重试新增后端协议或去重表。

Outbox接受时固定ID、频道和完整客户端语义，包括payload、audience、parent、visibility及显式expires_at；重试不得重新生成ID、期限或修改正文。回执丢失可同ID重试；冲突明确失败，不换ID盲发。重试仍经过现有权限、时效等校验，失败保留uncertain并经现有view对账，不能将账本去重夸大为任意外部副作用exactly-once。相关源码和已存在测试位置见审核文档§6，本轮未运行测试。

local echo用同一呈现身份合流，receipt/feed任意次序都不重复气泡，landed不回退accepted；正式seq改变排序时按真实变化保位，不能因确认而整行remount。本地发送队列与后端任务等待区分开。本地多tab发送用IDB条件租约协调发送者，崩溃接管仍依赖服务端实际幂等语义，不宣称仅靠租约实现exactly-once。

当前实现把send-start固定为首await前唯一bottom intent；durable accept只校验/消费token，receipt/feed/retry无滚动入口。final四hash上send pure transaction按exact target和snapshot list revision/rowIDs/height双序join，waiting只记exact inserted，A/B并存，takeover/activation清；无timer/rAF补偿/private patch。production CDP repeat2为2/2：每条恰1 intent/1 writer，outbox/transmit/receipt/feed各1；trusted wheel令epoch1→2后18/19个ordinary-stream issuer均not-authorized，无二写；数据focused25/25。因此W6数据与窄发送轨迹通过，但完整浏览态发送仍有intent1/write0，不能称发送场景整体关闭；它与W3目标/高度准入差异须联合归因。另有三个已定位未闭数据义务：慢receipt不得阻塞连续发送；旧批次错误反馈不能丢失；durable失败必须撤销残留bottom intent。

阅读书签、草稿、已读与同步coverage分别存储；缓存可清理，未发送意图不能随缓存清理删除。跨设备连续性只能复用已存在的授权能力；缺少接口记录BE-04，原需求保持可追溯。

## 10. Surface：全部布局因素及有限尺寸

已获用户确认：输入、回复、附件自然增高可以调整消息区可用高度，同时保位；断线/排队/错误状态不能改变外框。等待区是贴在Composer顶部的浮层，不属于消息视窗几何；阅读边界与实际输入栈保持32px。L1据此冻结为：空态零占位，存在经后端证据确认的等待项时显示有界浮层，数量变化只在浮层内部滚动，用户可收起。它可能覆盖浮层自身所在的阅读内容，这是“悬浮层”的明确产品结果，不再通过推高Composer或重排MessageList规避。

当前实现把Observer/naturalHeight、constrained overflow与padding全部收窄到真实`conversation-input-slot`；absolute WaitingLayer不进入测量、滚动或裁切。final四hash的CDP发送证据显示Waiting mount与唯一writer同帧，promote/completed后browsing gap2135；历史FINAL6旧SHA 2/2仍只作外框零漂移证据。当前旧waiting轨迹1/2红，完整following/browsing几何须在现树重签。Waiting queued→正文running连续过渡也未闭：允许浮层淡出/正文淡入，但逻辑消息身份、操作与读屏只能有一个，快速queued→completed、重复事实、切频道、reduced-motion及屏外路径都须正确；不得做正文复制portal、移动已有正文、动画主滚动坐标或用过渡掩盖跳位。Android键盘/rotation/safe-area/完整视觉命中仍开；自然Composer增长合同不得用固定高度掩盖。

| 因素 | 唯一处理位置 | 几何规则 |
|---|---|---|
| 输入换行、回复、附件、用户展开 | ComposerStack→Surface | 内容尺寸改变阅读高度，列表按当前阅读策略处理 |
| 网络、任务数量、计时、错误文案 | 固定StatusBar/等待内容槽 | 换文案/内部滚动，不以内容数量增减外部占位 |
| 图片、字体、图表、代码、正文编辑、作者头 | ContentRenderer→ListAdapter/组件 | 稳定容器/块，实际尺寸进入组件唯一测量边界 |
| 窗口、分栏、缩放、键盘、地址栏、安全区 | Surface | 有效可视窗口重新分配；隐藏0尺寸不重置会话 |
| 导航、Header、Preview、Terminal切换 | 各自Surface | 隐藏会话不参加目录Grid、点击命中和焦点 |
| 焦点/选择/浏览器滚动锚定 | 输入归属与列表接入 | 不创建无来源程序导航；活动内容不被普通回收破坏 |

H为Header和安全区扣除后的可用高度，G=32px，O为输入栈实际分配高度，M为最小阅读高度。正常尺寸满足 `O≤H-M-G`、`V=H-O-G≥M`。输入栈到预算上限后内部滚动，必要按钮可达。Surface只报告容器尺寸，列表不反写Surface；没有互相观察调整的闭环。

等待区不进入H/O/V公式，也不被Surface测量。它的下边固定贴住Composer实际顶部，高度有上限且内部滚动；空、未知或证据不足时不渲染。任务事实只能决定浮层内容是否存在，不能写`--conversation-input-height`、Grid轨道或列表滚动坐标。R2常驻128px/默认240px槽位和“测整个overlay再回写消息区”的路径均禁止。

极小视口无法同时容纳M、必要输入控件与32px时，启用明确的外层可达性滚动，使必要控件和阅读区分别可达。不能负高度或覆盖假装成立；恢复窗口保留同一会话/IME。这是环境降级，与后台状态无关。

Preview限制自身溢出、不撑宽移动页面；不支持预览仍保留合法下载。Header紧凑高度独立验收。末条可见和真实点击命中均测试，不能只测padding。

## 11. 不变量、推进性与证据

| 编号 | 必须成立 | 检查依据 |
|---|---|---|
| I1阅读权威 | 后台事件无导航/mode写权 | reducer事件集、依赖边界、随机轨迹 |
| I2用户优先 | 向上接管后回底/尾随不再拉回；后台无回底权 | 模型与真实组件两层证据 |
| I3单一几何执行 | 组件独占测量/范围/回收/滚动，Adapter只映射公开初始化/data及当前回底/follow；一个current intent可响应后续新证据revision，不得把它误限成终身单写 | 静态写入与状态所有权检查、运行来源、clamp/anchoring/snap/focus归属 |
| I4提交一致 | 快照不可变、版本匹配、变化真实且幂等 | 历史/live/cache混合乱序性质测试 |
| I5阅读连续 | 存活内容坐标保持，手势运动保留 | 真实块/文字逐帧，不只最终scrollTop |
| I6身份连续 | latest、回收、补父关系不改用户展示 | Choices/拓扑/DOM生命周期组合 |
| I7状态权威 | 无证据不宣布current queued或空集合 | 完整性、陈旧响应、跨端终态反例 |
| I8布局隔离 | 状态不改外框，内容增长可达 | 几何、命中、移动Surface回归 |
| I9可靠输入 | 接受与传输分离、不丢草稿、不双气泡 | 事务失败、IME、receipt/feed排列 |
| I10资源有界 | 交互路径无全量阻塞，已有内容不闪空 | 主线程/DOM/解析/数据覆盖独立指标 |
| I11持续推进 | 有效同步/历史/补证需求最终满足或明确失败 | 公平调度、无push、失败恢复、移动H |
| I12审批与发布 | 前端改造不隐含后端写入/运行服务操作 | 文件diff、批准记录、产物与版本核对 |

结构证明只证明模型权限与版本性质；几何、性能和网络最终性另需实际证据。网络/权限/存储最终不可用时不能保证新数据到达，但必须保证失败可见、已有内容可用、义务可恢复。不能用这些合理前提掩盖正常在线下长期不显示内容。

## 12. 行为模糊测试与集中验收

既定模型、组件接入及相邻owner正在当前工作树实施；完成后必须集中review与同源冻结测试，不每改一小块就部署给用户试。能力研究可在隔离夹具核实事实，但不能把缺失设计留给生产试错。focused通过只更新对应轨迹，不得覆盖完整验收门。

独立reference model以用户阅读目的、可见内容、数据已知性、草稿接受为状态；不复制实现reducer。生成U/B/E事件及异步调度顺序，覆盖following/browsing、空/部分/充分数据、在线/离线、active/suspended、回底交接、权限、存储、冷热测量、输入/选择。

每次运行保存seed、调度序列、身份与必要版本；失败自动缩减，保留能复现失败的最小轨迹。统计实际转移覆盖、关键交叉覆盖和失败种子，不以随机样本总数冒充UX覆盖。建立变异检查：人为引入历史完成后自动回底、maxSeq当coverage、缓存queued当current时，测试应失败。

模型fuzz验证语义，浏览器行为fuzz使用生产列表/正文/编辑器，并注入受控history/live/cache/media/resize延迟；独立观测实际文字位置、已加载内容覆盖、焦点/selection、点击命中、草稿与请求次数。真实鼠标/触摸/键盘序列与网络故障交错，不能仅dispatch合成scroll事件。

阅读几何诊断复用现有`__ATOLL_DIAGNOSTICS__`导出，作为默认关闭、仅内存、有界的flight recorder，不另建日志权威或后端上传。关闭时不得为了诊断读取`scrollHeight/clientHeight/getBoundingClientRect`；开启后才按批次采集activation/inputEpoch、Presentation revision、真实输入来源、history请求与批次到达、List/RO/range提交、语义锚ID与screen Y、scroller几何及唯一issuer接受/拒绝原因。字段调用点采用元数据白名单，不记录正文、草稿、token或协议payload；大量history row只汇总数量、到达首末及min/max seq、首末时间，导出明确`limit/dropped`。日志用于区分合法prepend补偿、语义点跳动、旧epoch写和供给/物化空窗，不能代替真实输入、逐帧oracle或证明paint时机。

原42轨迹全部转为具名回归；新增N01–N12见场景文档。用户未报告的合法组合也生成覆盖。几何oracle针对§6.1指定的一个未改写、仍存活且物理可行的阅读锚点：无手势偏差≤1 CSS px且不累积；有手势用对照轨迹/输入与组件写入记录区分u，不从wheel.delta推测实际运动。rAF观测补充录制与真实设备手势，不能声称观测全部合成线程帧。

至少分别使用桌面1100px与移动390px、Android真实惯性/IME及桌面滚动条/键盘；窄桌面不是Android验收替代。夹具包含长短混合文本、超长单条、流式改写、图片/字体/图表晚到、巨量已存历史及持续live。

验收前固定支持负载、参考设备与预算：输入延迟、解析/提交耗时、长任务、DOM常态/活动选择预算、内存、最大并发与重试。预算要以恢复后基线和目标设备测量落表；本轮没有捏造已测数字。输入响应与滚动分别通过；不能用扩大overscan到全频道规避空窗。

完整链路在未修改的现有服务或既有合同夹具上验证。服务夹具不能模拟生产不存在的channel_control/v6来使测试通过。模型通过、组件通过、端到端通过与真实设备通过分别报告。

## 13. 后端变更审批清单（提案条件，不是已判定必须改）

| 编号 | 触发证据 | 前端先完成的核查/替代 | 未获同意时的边界 |
|---|---|---|---|
| BE-01启动服务端等待 | 实测服务端Meta收集成为进入性能瓶颈 | 客户端并行、既有focus/head快路、延迟分段 | 保留后端seam；不得声称该延迟已消除 |
| BE-02任务完整性 | 既有view/request与有限补证不能满足J7 | 列出实际可用能力、响应语义、可见生命周期证据与成本 | 状态诚实显示；J7不签全通过；不得新增控制投影 |
| BE-03发送幂等（既有能力已确认，无需申请） | 当前同ID同语义重试已受持久化指纹保护 | 前端保存稳定ID和语义，按receipt/feed/冲突对账 | 不新增协议或去重表；不扩大为副作用exactly-once |
| BE-04跨设备读/草稿 | 无既有授权读写能力却要求多设备连续 | 列出现有能力，先兑现本地/跨tab版本隔离 | 不将本地持久化宣传为跨设备同步 |

任何其他后端变更也受同样规则约束。提案必须含：未满足的具体行为/场景、源码或复现证据、现有能力为何不够、最小后端文件/协议/schema变更、兼容与数据影响、验证、回退、替代方案和明确审批状态。初始均为“未申请/未批准”；前端架构同意、测试通过或笼统“继续做”不代替对后端具体范围的同意。

只读核查后端源码不属于修改；写后端代码/测试/协议、数据库迁移、生成后端代码、构建或替换运行后端产物、操作服务均不得借前端施工夹带。测试mock遵循既有接口，不能创造实际产品依赖。

## 14. 完整替换、删除与发布

恢复后的master@28abef1及R2@1cadf76是历史对照来源，不是重新清空当前r3的指令。继续施工须保全现有r3工作树，再按逐路径处置表核验已有实现：符合合同者修订复用，错误机制删除，不整分支合并或从零抹去正确模型。施工spec的W0–W8定义模型、同步消费、历史需求、内容、完整列表、Surface、输入发送及行为测试整体接入。可分内部工作包管理，但整体完成必须逐项满足需求；不能将同步/发送/控制移到“以后”又声称全部重构完成。

唯一生产入口切换后删除旧MeasuredTimeline、旧尺寸树/spacer控制器、隐藏预测量、滚轮同步准备、历史完成restore、冗余following、叠主动库的外部像素补偿及失效兼容路径。不新建Engine索引/spacer，不重命名搬回旧机制。旧测试有效场景迁为黑盒回归，不以删断言证明正确。迁移有效草稿/Choices/书签需明确导入计划；“无legacy实现”不等于删除用户数据，旧控制器不与新Adapter/组件并存。

每个需求都有实现位置、删除位置、测试证据和状态；有能力或审批门槛未关时不能把对应包列为完成。保留前端可回退提交及完整构建信息；审批后端依赖如发生也须独立提交、独立回退，不能捆绑偷偷切版本。

构建、复制dist、服务真正使用该产物、浏览器加载对应版本分别核对。恢复源码/重建dist不证明运行二进制或缓存已匹配；出现“消息不见”先只读定位传输/事实/投影/渲染层，不清数据库、草稿或账本试运气。发布前必须通过冷缓存/热缓存、无新push初始内容、协议不匹配的明确报错路径。

本轮已获准在当前r3工作树实施前端整合并运行build/测试；仍不复制产物、不重启服务、不修改后端或部署，也不切换/提交/推送分支。当前实现与未决C1见执行账§9.10。

## 15. 历史阶段裁决与当前覆盖

下列§9.10阶段记录只保留机制取舍与反证，不是当前成绩；任何“最新”“冻结”或通过数字均限定在它写明的旧源码。当前状态只读本节末§15.1与执行账§0，旧通过不得覆盖后续失败或未重签门。

系统目标及真实U/B/E/J、42+N/F/Q、W1–W8与后端审批不变；其中U09/任意目标导航标为误建模撤回，不拿不存在的功能扩充用户需求。撤回Legend fork/统一executionEpoch前置；自有ListEngine仍不授权。当前优先React Virtuoso 4.18.13公共接入，C1–C5按真实路径逐门闭合，不等于已准入。

职责、真实产品路径、Stream/Virtuoso公开接入分工已经进入生产接线；最新一次完整冻结是执行账§9.10.11的Chromium **151 passed / 4 failed / 1 skipped（156项）**、unit **661 passed / 1 failed**及build通过，不再以§9.10.6的旧150/4/1作当前总账。其后静态合同失败已按真实唯一writer结构修正，diagnostics/history/生命周期等focused结果只作增量，尚未替代完整轮。内建follow恒false、单Adapter即时issuer与公开List commit提示已经实施，见执行账§9.10.9：旧严格轨迹在只读trace下曾4/10失败，定位了DOM commit→默认RO通知的JS可观测瞬态，但该样本未证明跨paint；最终List commit接入后严格append 10/10、C1/nested 6/6、初始化/恢复/prepend 8/8及新增生命周期定向回归通过。§9.10.10的opt-in trace进一步证明tail下方行增长时的28px来自组件内部upward-size补偿，而冷prepend 8轮的语义锚逐采样零漂移；后者没有复现用户反馈的轻微回弹，不能据此否定反馈或盲调overscan/default高度。§9.10.12把fold普通亚像素误差和真实大跳分开，`1lh`及fractional公开`itemSize`两条前端假设均被原断言反证并撤回；大跳仍落在组件内部upward-size compensation。有限固定seed内容连续性fuzz没有复现空洞/隐藏/row-error或long task，但只代表该fixture，真实闪烁继续独立调查。全部视觉与F8证据、native thumb隔离headful证据仍保留；tail内容增长28px、initial retry、fold波动及Android设备证据继续独立记账。当前不独立demo、不换库、不fork、不实现或发布后端。

§9.10.13的独立CDP compositor控制组已把“未复现闪烁”更新为确定反例：无history快速上滑0白帧，而0/32/96ms prepend与静止触顶prepend都各出现1帧真实全白。原data/firstItemIndex稳定、slot有ID、应用issuer写入0；未知高度prepend第二次实测修正先把旧range整体移出视窗，替换range/row/List commit约43ms后才到。它不是空data、undefined row、网络、long task或CSS隐藏。不能简单停掉prepend补偿；最小责任边界须在组件内部把实测修正与新range DOM的prepaint交接协调，同时保留用户继续滚动、选择和100k有界DOM。tail +28与fold大跳共享尺寸/上行补偿子系统，但分别是“变化位置未限定”和“active行收缩/夹限后重复补偿”；fold普通亚像素与initial retry独立。两条公开参数实验只证明那两条假设不足，不代表穷尽公开方案；当前没有依赖修改授权。

通知与发送回底见§9.10.14：rail的显示与清除现复用同一`unreadCounts`根去重语义；Timeline不再以Presentation插入推断live，而消费Replica在accepted live commit记录的稳定到达身份，cache/history/processing/同ID更新不制造“新动态”。到达传递采用固定1024热journal；仅当当前React消费尚未确认且热窗溢出时，按稳定身份保留精确overflow集合，消费revision后立即ack回收，后台频道直接建立基线。当前ReadingSession的未读身份集合不再独立截成256，持久化到重进并在回底/已读时整体释放，故不会把第257个旧root再次报新。普通Composer消息在第一个异步持久步骤前捕获当前ReadingSession的activation/inputEpoch/intentRevision/mode，durable Outbox接受后只有该token仍匹配才经窄意图端口回底；卸载controller不能由迟到`update`重新start。slash/edit/receipt/retry/feed echo/后台控制无入口。最新竞态/上界focused为**6 files / 71 tests passed**（包含failed durable acceptance不消费token）；同源生产Chromium **4/4 passed**、build通过（4358 modules）。完整unit **671 passed**仍是此前完整轮证据，不改写§9.10.11冻结数字。

后续边界复核收紧了两点：Composer专用accept seam必须收到字段完整的send-start token，`null`/残缺token直接拒绝；用户按钮的显式`requestBottom`仍可无token调用。Timeline在layout commit登记arrival consumer，route/access使它卸载时同步注销并ack当前viewport传递队列；无consumer的活动/后台频道每次live到达直接走rail/read-cursor基线，不积累overflow。只有已提交viewport在一次React消费前被同步burst超过热窗时，overflow才按未ack稳定身份暂存，下次effect回收。稀疏revision选取已以重复root溢出、部分ack和新unique tail反例覆盖；后续focused为**6 files / 75 tests passed**，取代上文71项增量数字。

在该consumer生命周期修订后冻结生产源码重跑：完整unit为**118 files / 682 tests passed**，指定的通知/发送生产Chromium回归为**4/4 passed**，build继续通过。Replica store对同一频道持有稳定state对象，`apply/commit/trim`原地变更，普通render不会重复release；只有频道key、principal/cache world reset或首条数据将无账本的临时空state换成canonical state时更换owner。临时空state本身不是live commit目标，首条commit会建立唯一Replica owner。注册入口只有Timeline一处，ack只在同一arrival owner内执行。这些通过不关闭未知高prepend compositor白帧、browsing中下方行增高+28、fold大跳/亚像素波动、initial retry独立风险或真实Android证据缺口。

用户授权的三库隔离demo v1目前只是观测，不是换库结论：在共享的400行+30未知高prepend、同一快速wheel与探针下，三库fast+prepend都捕获compositor白帧（3/3），同速无prepend都为0/3；静止触顶prepend则Virtuoso 3/3每次一帧，Legend/Virtua 0/3。另一下方行+28轨迹中Virtuoso 2/3出现`scrollBy(+28)`和锚位-42→-70，Legend 3/3锚稳定，Virtua因target未物化无法判定。但v1共享fixture给所有root加了生产不存在的`contain: strict`，还在每次scroll/rAF全量读几何并以`flushSync` prepend；显式高度数据/CSS也不等于生产自然长文DOM。root正在核验contain有无×重探针的共享因素；未结案前不把白帧推定为三库同一内部根因，也不据此换库。

**后续证据纠正（取代对上段fast轨迹的任何候选否决力）：** v2证明Legend去掉root `contain:strict`、关掉重几何探针后，fast+prepend仍四组2×2各3/3白帧，同速no-prepend仍0/3；但已发布TanStack 3.14.9/core 3.17.7的新隔离卡又显示，同一极端wheel下fast+prepend与fast no-prepend都可白，甚至**静态400行、无virtualizer、无React update**的DOM也捕获一帧全白。运行环境是Headless Chrome 151 + SwiftShader；因此“三库fast都白”只说明该synthetic track有paint现象，已被浏览器软件栅格/compositor环境明确混杂，不能推出三库同根因、都不满足或换库无意义。TanStack trace的`missing_tile_count:1`与白图只在9–17ms邻近，没有共享frame token，不得写成每帧白的精确因果。

这个纠正**不把所有问题归结为GPU**：生产Virtuoso静止触顶prepend时的“二次实测修正先scroll、range/List后commit”顺序仍有独立trace，并与4.18.13/#1493只覆盖首次prepend handoff的上游边界一致；可见锚下方增高时Virtuoso内部`scrollBy(+28)`更是已经直接定位的组件行为。它们仍是真实未闭门，但现阶段不把“邻近顺序”升格为每个白帧的唯一根因。下一决策边界只是完成当前Virtuoso的静止prepend 3条trace+静止no-prepend 1条对照，将组件commit顺序与环境paint分层；不快轮、不加新候选、不因此要求fork。v1原始`test-results` 已被一次未指定独占`--output`的默认Playwright运行清理，现已不可复核；上段v1数字只是当时已审记的观测记录，不再引用临时路径作当前artifact。可链证据以`docs/evidence/list-demo-comparison-v2/`和`docs/evidence/list-demo-tanstack-released-fixes/`为准。

**生产历史交接的有界补证：** 普通浏览不是用新历史“替换”当前视图。后台页先只进Scheduler reservoir/IDB；同activation的真实向上意图才允许一次最多8条raw/256KiB经replay进Replica，Presentation保留原可见row的稳定身份，只在上方加older rows。一条180行raw长文在进入几何前被既有内容折叠稳定为507.09375px项（viewport 485px）；同一连续输入中3个runway批次均释放8条raw，95个DOM帧无空窗、32个CDP compositor ROI帧均有正文，最多15个物化项、应用issuer写0。这证明现有“后台准备→用户frontier有界发布”在该正常长文轨迹中有效，不是任意像素高度承诺。用户展开、非文本异构项及initial/focus较大释放仍独立；原+30直接prepend的白帧硬oracle不撤回。具体证据见执行账§9.10.19。

**候选A已否决、未实施：** “一次准入一个默认折叠单元，再把首次List commit/range/total-height当完成ack”的前提不成立。隔离轨迹中原子30项首次通知报告`65771`后，同一revision仍连续修订到`70392`；单个180行已展开root首次仍报告估算`61943`，随后才到`70447`。逐根首通知并不证明物化与实测已经完成，拿它开放下一根仍会重叠后续修订；不增加settle次数、timeout或动态内容不存在的永久最终尺寸信号。该候选没有改生产列表，现有reservoir隔离、真实frontier有界release、稳定Presentation身份、单ReadingSession、唯一几何owner与原+30硬oracle全部保留。迟到媒体的灰色内容块不得因`darkPixels`阈值误记为白帧。精确反例和artifact见执行账§9.10.20；B方案未结论，不据此迁库或fork。

### 15.1 当前状态覆盖说明

本节前面的阶段证据不得作为当前成绩。生产为单Virtuoso/单ReadingSession issuer；W1 cold/filter具名轨迹、W4内容2/2、latest模型37/37+App1/1及W5防僵尸78/78+browser1/1均只定向有效。843/843+integrity4/4早于当前改动，现树待重签。当前硬门包括W2 semantic unit；W3 explicit latest/ordinary-follow 0writer、提前清unseen、append gap519、prepend白帧、bookmark Infinity；W4高度事务、stream→terminal正文key、长文CPU/回收selection；W6完整浏览send intent1/write0；W7当前集成与Android设备门。静止prepend的现有3/3因果反例已收敛为“测高后的坐标修正先发生，而新可见range/DOM尚未一致提交”，不是网络、应用第二writer或缺数据；fold大跳虽已定位到总高度差补偿路径，但逐次对应仍待核验。另撤回“一个intent终身只能写一次”的错误约束：同一唯一issuer可在intent仍current/following时处理新的已提交尺寸/内容revision，用户上滑后必须立即失权。没有完整同freeze unit/browser/fuzz/build总账，当前不可称完整验收、交付或部署。
