> 历史归档：源自 refactor/conversation-architecture-r2@1cadf76；只作审查证据，已被 R3 替代。文中设计通过、后端施工、库扩展等结论不代表当前授权。

# 会话前端完整架构审核

版本说明：本文保留R1审核发现与当时裁决。R2已逐项修订，并在用户确认内容驱动阅读高度后完成静态设计复审，
当前实施基线见[总设计](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/CONVERSATION-FRONTEND-REBUILD.md)第16节。
下文“不通过/未选定”是R1历史结论；原运行代码问题未因文档修订而自动修复，仍需实施与验收。

日期：2026-09-16。结论：**本轮架构审核完成；现有实现不符合目标合同，重构草案不通过实施准入，尚不能承诺全部故障被排除。**

这是代码与设计的静态审核，不是测试通过报告。本轮没有修改运行代码、运行测试/构建、部署或操作服务，也没有联网选型。已有未提交的自写列表改动不属于本次审核成果。

## 1. 审核对象与证据边界

- [重构草案](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/CONVERSATION-FRONTEND-REBUILD.md)：状态权威、组件合同、事件空间、更新协议、迁移和验收。
- [场景推演](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md)：42 条核心设计轨迹及后端、存储、浏览器等交叉扰动；这些不是执行过的测试。
- [用户反馈对账](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/docs/USER-REPORTED-ISSUES-RECONCILIATION.md)：此前已完成频道历史分页核对，归并为 F01–F28；服务/日志等非消息区事项另外列出，不偷渡进本轮实现范围。
- 当前 ReadingSession/Viewport、Presentation、ViewSession、HistoryScheduler、Wire、提交持久化、等待区、布局与 Mermaid 路径；后端 attach/频道 Meta 协议；本机已安装的 react-virtuoso 类型和相关定位实现。

完整审核指覆盖架构责任链与场景来源，不表示逐行审计整个仓库，也不表示穷尽所有浏览器轨迹。下文区分“代码确定存在的行为”“设计能力未证明”“产品约束冲突”。没有把每次用户观察到的闪动都强行归因于同一个点。

## 2. 总判断：之前为什么不断出现局部补丁

根本问题不是文件太大，而是三个不同合同被混为一谈：

1. **语义权威**：谁有权改变阅读目标、当前任务状态、消息事实。
2. **提交一致性**：数据、阅读策略、组件收到的版本是否属于同一次有效提交。
3. **几何实现能力**：组件能否在真实测量、手势和内容变化下兑现保位、取消和可达性。

把 scrollTop 集中到一个文件，只约束了写入位置，没有建立第一、第二个合同；换成自写列表又扩大了第三个合同的维护范围。即使恢复成熟组件，若仍向它传可变快照、过期导航或错误 follow 授权，问题也不会消失。

当前草案的行为分类和单一 owner 方向可以保留，但不能直接进入“按文档照做即可保证成功”的阶段。具体阻断如下。

## 3. 确定性发现与修正决策

### A01 — 阻断：历史恢复失败被授予跳到最新的权限

证据：[useConversationViewport.js:229](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationViewport.js:229)。恢复需求返回 exhausted、failed 或 cancelled 且锚点不在列表中时，代码清锚点、设置 following、调用 latest 并保存。加载/恢复过程还与 browsing/following 混在同一个 mode 中。

反例：用户正在读取可用旧内容，恢复页失败或被取消，后台结果把用户带到最新。这不是用户导航。

决策：ReadingSession 只持有 following/browsing；历史与导航各有独立过程状态。历史完成函数没有构造导航的权限。恢复失败保持 browsing、保留可用位置并暴露失败；确实失效的锚点采用存活邻项与合法滚动范围降级，不能默认为尾端。筛选变化也不能不经明确策略一律 jumpLatest（同文件第174行）。

关闭证据：恢复失败/取消/耗尽、等待期间继续滚动、筛选与返回的组合中，没有无用户来源的导航；用户先前运动被保留。

### A02 — 阻断：Presentation 的“冻结”不是不可变快照

证据：[conversation-presentation.js:104](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/conversation-presentation.js:104)。Object.freeze 包裹的 row 仍通过 getter 读取可变 entry/turn；body 直接引用 entry。旧 row 的 contentRevision、settled、布局类别可能随底层修改而变。

反例：列表保存前一展示版本用于比较，账本已修改同一个 turn；前后两份引用读到同一新值，失去可靠的变更边界。稳定 key 和 memo 不能修复这一点。

决策：发布版本拥有不可变呈现输入；未变实体结构共享，变更实体发布新值。revision 必须覆盖正文、结构与展示输入，不能未经证明把 max seq 等同于全部内容版本。更新依赖索引明确记录“哪条事实改变哪些实体/块/分组”，不逐 token 扫描整个频道。

关闭证据：发布后快照不再变化；混合 prepend/append/revise/remove 生成可重放的真实变更集合；重复事实没有第二次结构变更。

### A03 — 阻断：导航、会话保存和 React 提交缺少端到端版本合同

证据：[useConversationViewport.js:199](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationViewport.js:199) 发出 restore 即标记完成，显式 focus 调用后即消费目标；[view-session.js:75](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/view-session.js:75) 按 channel 合并写入，没有 activation/reading revision 的条件写接口。这里不据此断言已经发生跨账号泄漏，但接口本身不能证明旧激活回调不会覆盖新会话。

决策：会话键是 principal/channel/view；activation 区分 A→B→A。展示提交与阅读授权通过同一个受版本约束的协调入口配对；React render 只读取稳定快照，不在 render 中执行命令。若使用外部 store，订阅必须符合 useSyncExternalStore 的快照一致性要求，但该 Hook 本身不是导航取消机制。layout 提交前重新验证 inputEpoch/readingRevision，失效的是旧授权，不是已接受消息事实。导航必须有 issued/completed/cancelled/failed 回报，保存必须是当前 activation 和 revision 的条件写。

关闭证据：中断渲染、重复 effect、A→B→A、旧卸载保存、已发导航后用户接管均不会恢复旧目标。不能用“加了令牌字段”代替实际组件回报与取消能力。

### A04 — 阻断：候选列表尚不能兑现整套几何合同

证据：[本地 VirtuosoHandle:1601](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/node_modules/react-virtuoso/dist/index.d.ts:1601) 没有公开的导航 cancel 方法；[定位实现:1091](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/node_modules/react-virtuoso/dist/index.mjs:1091) 包含 listRefresh 后重试，auto 路径也存在延后重试。应用令牌无法自动撤回组件内部已接受的动作。

这不等于已证明整个库无法满足要求；它明确否定“behavior:auto + 应用令牌就证明可取消”的推断。纯 prepend 的 firstItemIndex 也不能直接证明中间补洞、删除、混合结构变更和长消息块内保位。

决策：保留成熟组件唯一几何 owner；**不批准当前候选直接作为最终实现基线**。必须为取消、混合变更、块内锚点、选择/焦点给出具体公开能力或组件内部受维护的机制。不能在应用添加第二尺寸树、隐藏测量引擎、反向 scrollTop 或 wheel 中 flushSync 来替代缺失能力。不恢复旧的双重补偿接法。

关闭证据：能力映射完成后集中运行隔离的真实组件场景；若失败，以明确缺口决定升级/上游修复/替换，而不是继续扩展应用补丁。组件选型未通过是当前设计的真实阻断，不是已经解决的实现细节。

### A05 — 阻断：新鲜度是一次请求，不是持续需要完成的同步任务

证据：[useChannelFeed.js:336](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/hooks/useChannelFeed.js:336)。进入/再次选择频道已经会请求 Meta，不能再说“没有入口”。但 in-flight 合并没有记录期间新产生的校准意图；失败后返回 false，注释明确等待下一次 attach/focus。

另见 [history-scheduler.js:1065](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/history-scheduler.js:1065)：该 Meta 刷新路径用 head > visibleNewest 决定追尾。拥有最高 seq 不证明中间 coverage 完整。假设已知覆盖有洞而最高消息已到达，这个比较本身无法发现洞；不能据此断言其他路径必然不会补洞。

决策：SyncSession 保存 interestRevision、校准目标 H、缺口和失败状态。进入/重选等明确动作触发校准；请求期间新意图留下 dirty 标志并在完成后再校准。瞬时失败有有界退避/超时与可见重试，断线暂停等待可用事件，权限拒绝进入终态，不无限风暴。当前活动频道还需要有界的新鲜度复核，不能仅靠下一次 push 或用户再次进入。依据协议 coverage/checkpoint 判断缺口，不能要求可见 seq 连号，也不能拿 max seq 当覆盖证明。每次追赶到有限 H；之后的新 head 是下一项任务，不永久等待移动的“最新”。

关闭证据：进入后无任何新 push、Meta 首次失败、请求中再选择、洞后收到更大 seq、持续 live 与上翻历史并发；在网络恢复等公平前提下追赶最终推进，且历史需求不被永久饿死。

### A06 — 阻断：attach 的关键失败仍会宣布成功，服务端仍有全目录屏障

证据：[wire.js:149](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/net/wire.js:149) 先设置 attached，onAttach 同步抛错后仍可能发布 attached。关键 Meta 安装失败与非关键持久化失败没有不同的成功边界。

后端 [web.go:130](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll/drivers/gateway/connector/web/web.go:130) 在 attach receipt/live 前等待 PrepareHistoryMetadata；[session.go:291](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll/drivers/gateway/session.go:291) 收集所有成员频道 Meta 后返回。已存在生产 body-free 快路，不应重复旧的“每频道反序列化正文”结论；但有并行 worker 不等于消除了最终等待全部频道的屏障。这里是结构性延迟风险，不是实测耗时结论。

决策：同步安装会话身份/关键 Meta 成功才开放该 generation；持久化独立失败，不阻塞已合法接入的 live。服务端按频道建立可证明无丢失的订阅/快照 seam，目录 Meta 增量到达，慢频道不得阻断其他频道启动。不能仅把 LaunchFeed 提前而丢掉原 seam 的一致性保证。transport、session、hydrate、catch-up、history 状态必须成为实际模型。

关闭证据：关键安装异常不进入假 attached；一个频道 Meta 超时不阻断其余频道；seam 前后消息不丢不重复发布，异步缓存失败不关 live。

### A07 — 阻断：等待区把消息尾部就绪当作当前任务权威

证据：[Timeline.jsx:790](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/Timeline.jsx:790) 从当前加载的 turns 推导 queued，然后用 history.controlCurrent 放行；未放行时传空数组。Scheduler 的该标志由尾部/coverage 路径设置。当前 [ChannelMetaReceipt:606](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll/platform/subjectgate/frame.go:606) 只有 head/has_rows/activity/generation，不提供当前任务完整快照。

反例：旧请求已缓存，终态位于未覆盖区间，最新尾部已就绪；或者真有仍在执行的老请求却尚未加载。仅尾部正确无法证明整个任务集合正确；隐藏为 [] 又把 unknown 伪装成没有任务。

决策：完整方案采用独立的**后端当前控制投影合同**：权限过滤的任务集合、数据身份、版本/快照边界及后续增量接续；发现版本缺口重新校准。前端只保留展开偏好，不能恢复后端真相。current/stale/unknown 显式建模，本地待发送意图另列。若复用已有服务能力，必须证明相同语义；本轮未声称整个后端绝无可复用接口，也没有擅自新增协议。

关闭证据：快照与增量交错、旧 terminal/request 乱序、跨设备结束、权限变化、断线及缓存晚到，不回退当前状态，不遗漏真实活跃任务；任务未知有明确展示，外框不因状态变化跳动。

### A08 — 阻断：固定消息边界与输入栈增长存在未解决的可达性冲突

证据：[app-shell.css:106](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/styles/app-shell.css:106) 桌面保留 112+32px；[composer.css:19](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/styles/composer.css:19) 编辑器本身可长到160px，另外还有工具栏、回复、附件和等待区。浮层增长可能超过保留带。这是尺寸上可构造的遮挡，不需要先假设网络慢。

令固定保留带为 B，实际浮层总高度为 O。要无覆盖，必须 O ≤ B；若要整个浮层与消息边缘始终再隔32px，则必须 O+32 ≤ B。当前基础保留带不能证明任意增长态满足任一条件。

决策：网络状态不得改布局、等待区贴 Composer、输入自然增高、移动目录独立、基础间距32px全部保留。**不擅自把等待区收起或固定死，也不承诺固定底边加任意增长就不会遮挡。** 要完成布局实施，必须明确有限视口下的栈高度上限/内部溢出与极小窗口策略，或允许用户内容变化导致阅读区域重分配；后者不同于网络状态推动布局，但改变了此前“输入不影响边界”的约束，不能偷渡。当前审核判该设计不通过，尚未选定产品行为。

关闭证据：给定手机/桌面/软键盘最小可用尺寸，回复、多行、附件、默认展开等待区下所有消息和操作可达，点击命中真实目标；不能只验证默认一行输入。

### A09 — 重要：持久提交、已读与会话恢复仍不能随列表替换宣告完成

证据：[submissions.js:55](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/submissions.js:55) localStorage 写失败被吞掉，无法兑现“持久本地接受成功后清空”的合同；[useConversationViewport.js:257](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationViewport.js:257) markLatestRead 入口只判断可见/following/atBottom，尚无筛选阅读的显式证明；ViewSession 是内存频道 Map。

决策：输入、持久接受、传输、receipt、落账是不同状态。持久失败不能冒充持久成功；稳定 client ID 对应服务端确认，避免重试重复。已读前沿表示什么范围必须明确；过滤视图末尾不自动代表未展示消息已读。会话/草稿持久化按 principal 隔离，读取失败、quota、另一个标签页更新均不能覆盖当前编辑或当前屏幕位置。

关闭证据：quota/关闭页面/receipt与feed乱序/重连重试/切账号/过滤阅读；该工作包未完成时，整体交互架构不能宣称全部达标。

## 4. 六项能力门槛的审核裁决

| 门槛 | 本轮裁决 | 实施准入所需结果 |
|---|---|---|
| G1 导航取消 | 候选公开 API 没有直接 cancel，auto 仍含延后重试；当前映射不通过 | 组件已发动作也可被用户接管，不只是拒绝尚未发出的命令 |
| G2 选择/焦点 | 仅声明“有限资源下不丢选择”还不是策略；未证明候选有回收保护 | 明确活动编辑/普通复制的节点生命周期与资源边界；不默默截断用户选择、不无限 pin，不承诺任意跨全历史原生选择 |
| G3 混合结构变更 | firstItemIndex 的纯前缀映射不足；未证明任意中间更新 | 提交真实变更，存活锚点保持，非用户更新不重挂/导航 |
| G4 长文内部 | rowID+offset 与稳定消息 key 不足以保持段中文字 | 可识别稳定内容块及统一执行机制；改写/删除内容有确定性降级 |
| G5 当前任务权威 | 当前 tail/head 输入不足；确定需要独立权威合同 | 有版本和完整性的控制投影，不再由消息窗口猜当前队列 |
| G6 浮层可达性 | 当前通用承诺存在尺寸反例；不是虚拟列表问题 | 明确有限尺寸策略与必要产品取舍，再做几何验收 |

以上不是六个留给编码时“想办法”的 TODO。G1–G4 在选型前阻断，G5 在端到端控制正确性上阻断，G6 在布局可满足性上阻断。没有关闭就不能批准总体设计。

## 5. 必须形成的整体责任链

| owner | 唯一权威与输入/输出 | 无权做什么 | 出错归属 |
|---|---|---|---|
| 后端账本/控制投影 | 权限过滤的消息事实、扫描覆盖、任务快照/增量 | 定义本地用户当前阅读目标 | seam、权限、任务完整性 |
| SyncSession + Scheduler | 当前身份、兴趣、有限 head 目标、缺口、重试与公平预算 | 导航、DOM、高度 | 进入不追新、永久等待、重复请求 |
| Replica/Storage | 幂等事实、原子行/coverage、内存与持久进度分别标记 | 把未持久事实写成可恢复进度 | 丢消息、假覆盖、跨身份污染 |
| Presentation + Choices | 不可变语义项、局部内容版本；用户展示选择独立 | 用 latest/网络状态改变默认高度；推断当前任务 | 重分组、全量重解析、回收后折叠 |
| ReadingSession | 目标、浏览/跟随、书签、命令生命周期、用户接管 | 以 loading/resize 自创导航 | 错恢复、跟随误判、过期命令 |
| 提交协调入口 | 配对有效展示版本和当前阅读授权 | 维护尺寸、修正 scrollTop | 跨版本/并发提交撕裂 |
| MessageList/内容组件 | 成熟组件独占测量、物化、补偿；内容遵守稳定结构合同 | 网络请求、重置会话语义 | 冷行保位、块内重排、空窗、回收 |
| Surface/ComposerStack | 固定状态栏、明确边界、独立目录、焦点/键盘与输入布局 | 将连接或任务状态变成页面高度策略 | 遮挡、移动布局、点击不可达 |
| Submission | 草稿、持久本地意图、发送状态、稳定确认映射 | 把本地意图伪装后端 queued | 清空丢稿、重复发送、错误恢复 |

这不是要求九个全局 store 或九套框架。模型和模块必须有明确权威；可共享实现，但不能共享越权的状态写入口。

## 6. 外部行为、安全性、推进性与性能同样是准入条件

- **身份与访问**：principal/权限/data epoch 改变使旧事实展示、缓存读取、命令与任务快照按各自边界失效。Socket generation 只隔离连接响应，不能自动当账本换世界。撤权后的下载与任务操作由后端重新校验；缓存不能绕过权限。
- **浏览器生命周期**：StrictMode、并发 render、卸载、BFCache、hidden、软键盘、缩放、字体与媒体到达均是事件，不是导航来源。恢复时一次校准，不重放后台积累的定时器风暴；零宽高测量不得成为有效几何。
- **多端并发**：远端已读或任务结束更新相应事实，不移动本地阅读窗口。旧标签页不能覆盖新草稿/书签；必须有版本冲突策略，不能只扩大 localStorage 键。
- **输入与选择**：输入法 composition 不受 live 重挂影响；选择/编辑保护有清晰生命周期。键盘焦点、Tab顺序、屏幕阅读器与指针命中属于可用性，不由“像素没跳”代替。
- **推进性**：在连接和资源最终可用的前提下，当前频道校准、有限目标补洞、历史需求和控制状态最终完成或进入可见终态。高优先级不等于历史永远饿死；重试有退避、取消、预算，不能把之前的后端重试风暴复制到前端。
- **性能**：消息量、单条长文、流式速率、并发媒体和滚动速度都要有声明的支持负载。手势路径没有全量投影/同步测量准备；解析、缓存、DOM、请求和诊断都有上限。超负载明确降级，不清空正在看的内容，也不许用无限 overscan 宣称解决。
- **诊断**：有界记录 activation、data/presentation/reading revision、导航来源/结果、anchor、提交类型、Meta目标/覆盖、请求状态以及渲染耗时。区分缺数据、数据待准备、DOM不覆盖、主线程阻塞。默认不记录正文/草稿/凭据；只在状态转移记录，重复错误聚合。

这些是设计义务，不是本轮对全项目安全性、性能或可访问性已经通过认证。

## 7. 已存在且应保留的正确实现

- 生产频道 Meta 已有 body-free 快路径；进入/重新选择频道已触发请求。需要修正任务生命周期，不是删除后重造入口。
- Scheduler 已区分追尾与上翻游标；继续保持二者不互相覆盖，并补齐 coverage 义务。
- Following 意图应优先于旧物理快照、展示选择跨回收保存、固定状态栏、目录 Surface 隔离，均是正确边界；仍需在新接入中保留。
- [MermaidBlock.jsx:101](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/MermaidBlock.jsx:101) 已用 effect 清理标志阻止旧 source 的异步完成写回。不能把“外部渲染迟到”这个通用风险虚报成此处已确认的回写 bug，也不应为每个已有正确局部生命周期再套一层全局状态。

## 8. 由审核导出的施工与验收边界

1. **设计准入**：先关闭 G1–G4 的组件能力映射、G5 的权威输入、G6 的布局取舍；具体未知不以“适配器处理”带过。审核报告是阻断清单，不是选型批准。
2. **模型与输入合同**：整体验证 ReadingSession、不可变 Presentation、提交协调入口、SyncSession、控制投影和 Submission 的职责；可以分工作包实施，但它们共同决定完整交互是否达标。
3. **单入口迁移**：一次替换消息列表接入，删除旧自写尺寸树、准入/隐藏测量/手势预渲染，以及所有应用层滚动补偿；保留并迁移用户 Choices。不要让两套引擎同时监听同一视窗。已有脏工作区先识别归属，不能直接 reset。
4. **整体实现后集中验证**：先对设计逐项静态对账，再做 reference model 状态机 fuzz、真实组件、端到端合流和 Android/桌面手势验收。用实际可见位置、内容覆盖、焦点/选择、命中、持久结果和推进性作 oracle，不用内部“preserve=true”或测试数量代替结果。
5. **发布与回退**：代码与文档完成状态分别记录，保留受控提交回退点；构建不是部署，部署不是重启。未经明确安排不操作承载当前会话的服务。不能将现有未提交自写引擎视为已批准产物。

审核后的范围修正：此前草案把同步/控制/提交全部列为外部输入，同时承诺覆盖进入不追新、旧 queued、弱网发送等场景，范围并不闭合。可以先交付视觉工作包，但只有相关工作包都满足合同，才允许称“完整会话交互重构完成”。

**最终结论：行为模型已有系统性覆盖，但实现与能力证明尚未闭合。明确拒绝继续用局部补偿完成这些阻断项，也拒绝把本次审核完成写成软件修复完成。**
