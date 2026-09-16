# R3 架构复审结论与证据

日期：2026-09-16。审查任务：保留系统架构级重构和全部交互要求，优先使用现有后端，任何后端改动先取得明确同意。

本次已进一步完成[R2逐路径核验](CONVERSATION-BRANCH-IMPLEMENTATION-AUDIT.md)与[完整施工spec](CONVERSATION-IMPLEMENTATION-SPEC.md)。前者列出全部差异的处置和Q01–Q20，后者将缺口转成W0–W8工作、内部接口、删除及验收合同；不再只交不通过结论。

本轮只读检查主分支源码、R2提交和本地组件接口；在独立文档工作树修订。没有实施、构建、部署、服务操作、数据库操作或浏览器诊断。“恢复后消息不见”保留为未诊断F29，不以本次文档审查冒充修复。

## 1. 核查基线

- 前端：`master@28abef1a15e3`；审核时工作区干净。
- 后端能力审核基线：`8441c2fa5ade`；用户TUI等改动在审核期间提交为`125bf517`，最终main保持该新提交且干净。本次核验的Gateway/Store协议路径未被该TUI提交修改，不回退或改写用户工作。
- R2：`refactor/conversation-architecture-r2@1cadf76`中的设计、审核、42场景、反馈总账；已归档，非当前授权。
- 本地 `react-virtuoso` 类型及定位实现仅用于能力核验，没有联网检索或修改库。

## 2. 具体发现与已完成的设计修订

| 审核项 | 证据/反例 | R3修订与当前状态 |
|---|---|---|
| R01范围漂移 | R2§15.5要求服务端逐频道seam和新协议协商；§15.6指定后端控制快照/增量 | 改为现有能力映射、BE提案和逐项审批。前端要求完整保留，后端施工未授权 |
| R02过度收缩 | 先前纯前端回复宣称公共API足够；unknown可被误当J7完成 | 取消无证据组件承诺，J7写明主动补证、完整集合边界与未满足状态 |
| R03基线误判 | main的frame.go已有FrameVersion=5、FrameChannelMeta；wire.js已有channelMeta | 明确现有接口可消费，禁止将“不得新增”误解为必须删除现有能力 |
| R04数据世界误判 | frame.go AttachReceipt注释：Boot为c0 genesis，重装改变，普通重启不变 | 分离世界、transport generation、activation和content/layout版本；新增N11 |
| R05任务全集证明缺失 | Native已有agent.status；Base有状态响应，system.log.query可核对请求关联终态；channel head不含任务全集证明 | 现有路径已核实，按actor能力消费；Base冷态完整集合和固定成本不能凭单任务查询证明，详见§6 |
| R06发送保证跳步 | 已追踪submitFingerprint→Harness→Store事务，重复返回原seq，冲突明确拒绝，持久指纹支持重开 | 发送去重已有能力，不需BE-03后端变更；前端固定ID和完整语义，权限/过期等失败仍需对账 |
| R07服务端瓶颈越权修复 | web.go:129起在receipt/live前PrepareHistoryMetadata | 客户端并行可做；服务端改seam只列BE-01待证据与批准，不能称前端已消除此等待 |
| R08组件证明缺口 | index.d.ts公开handle未列通用cancel；index.mjs定位含延后重试/1200ms清理 | C1单列已issued用户接管；auto、一次调用或应用token均不是取消证明 |
| R09混合更新/段内保位 | firstItemIndex规定prepend索引，不能单独证明中间insert/remove及长文文本保位 | C3/C4必须具体能力映射，禁止外层反向补偿、冻结正文或自动批准fork |
| R10生产恢复边界不足 | 用户恢复后报告消息不见；上一轮只验证源码分支和复制产物 | 新增F29/N01；冷/热缓存无push初始内容、产物/协议/缓存分别核对。未做运行诊断，不归因账本丢失 |
| R11范围降级风险 | 把Outbox/草稿/同步都称“独立包”后仍宣布整体完成 | 各包可独立组织，整体需求逐项完成，不能后置后冒称交付全部 |
| R12模型覆盖缺口 | 原42条未直接包含审批、回退产物、全任务集合、跨tab发送 | 新增N01–N12；原42条和28项历史反馈映射保留 |

相关源码位置以审核基线为准：`platform/subjectgate/frame.go`的FrameVersion、SubmitPayload、AttachReceipt、ChannelMetaReceipt、PageEndPayload与SubmitReceipt；`drivers/gateway/connector/web/web.go`的attach流程；前端`src/net/wire.js`、`src/app/hooks/useChannelFeed.js`、`src/model/submissions.js`；安装包`node_modules/react-virtuoso/dist/index.d.ts`与`index.mjs`。只读证据不代表该版本已在当前服务运行。

## 3. 完成状态分层

| 审查对象 | 本轮结论 | 关闭条件/责任 |
|---|---|---|
| 用户目标与范围 | 已修订且未降级 | R3保留U/B/E/J、F01–F28/原42轨迹，新增F29与12反例 |
| 状态权威、并发、生命周期 | 前端合同已明确 | 实施时检查唯一写入者、不变快照、条件保存、提交时授权 |
| 布局产品约束 | 输入增长与32px已确认；等待区空态/自动展开/状态不改框存在冲突 | spec的L1明确取舍，不能把R2常驻128px视为已批准；其余可达性要求保留 |
| 后端授权边界 | 已明确 | 具体文件/协议/schema/验证回退提案经用户明确批准才能写 |
| 成熟列表选型C1–C5 | 尚未取得完整能力证据 | 逐项public机制/行为证据；不能用一句“交给组件”签字 |
| J7完整任务状态 | 现有状态及查询路径已核验；Base冷态集合成本未闭合 | 不将消息processing默认值或单任务查询冒充完整运行队列；具体边界见§6 |
| 可靠重试与跨设备 | 持久化重复ID/冲突语义已确认；跨设备读写仍独立核验 | BE-03无需后端变更；前端稳定ID重试及异常对账，跨设备不借此宣称完成 |
| 性能支持负载 | 指标与采样方法已定义，预算未实测 | 参考设备、恢复后基线与目标负载固定后验收 |
| 代码/运行/用户故障修复 | 本轮未实施或验证 | 完整替换后集中review、行为fuzz、真实组件/集成/设备验证 |

上述待证据项由工程审查继续完成，不要求用户提供新的UX枚举。若证据最终表明需要后端修改，应准备具体提案再请用户审批；审批前可完成不依赖该修改的文档、只读核验和明确授权的前端工作。

## 4. 结构性证明能覆盖什么

历史完成没有Navigation构造出口，可以证明该事件在应用模型内不会授权跳转；仍不能证明候选组件无额外位移。Choices独立于latest/DOM生命周期，可以证明对应事件不能改用户折叠；仍需接入代码真的只读该权威。coverage与消息同事务可以证明持久不虚报；还要检验失败/崩溃路径。未知状态可防误报，但J7推进性必须另证。

因此撤回“静态复审通过即全部能力闭合”的R2结论。需求与架构约束可作为当前基线；完整实施准入仍需上表具体证据。缺证据不会被转成局部补丁、需求删除或擅改后端。

## 5. 文档审查方式

复查需求覆盖与权限矩阵；逐一代入原42条及新增12条合法轨迹；核对每项有事实owner、意图owner、执行owner、失败终态与推进义务；用独立的可见行为而非内部字段作验收依据。检查归档与当前基线分离，并对文档变更做diff检查。

本轮未执行runtime测试；不将54条设计轨迹写成54项测试通过。后续行为模糊测试必须保存seed、缩减轨迹、转移覆盖，并以生产组件的可见内容、选择/焦点、点击命中、草稿和请求结果作为oracle。

分支复核额外发现probe成功后catchup失败会丢推进义务、cancelled导航可接受晚completed、草稿接受非原子及异步clear会误清新输入。它们不是新增需求，分别是既有I11、I2、I9的具体反例；已写入spec的状态转移与必杀变异测试。R2已有同步和阅读模型property测试，不能再简化为“没有行为测试”；缺的是生产UX组合与独立浏览器oracle的完整证据。

## 6. 三项后端源码核验（同一main基线，只读）

### 6.1 等候状态：已有输入，不需要先造新协议

- `drivers/agents/native/native.go:695` handleStatus支持work_id、submission_key和分页列举；`drivers/agents/workapi/work.go`定义协议及incarnation范围。它不是所有Agent统一具备的全频道快照。
- `drivers/agents/base/base.go:50`列出Base控制words，没有agent.status；`loop.go:622`的agent.queue确实调用enqueue，不能拿来查询。`loop.go:1340`明确status进度附带controls全量替换、终态不带controls。
- `platform/internal/sysactor/sysactor.go:170`已有普通request的system.log.query派发；`platform/home/logprojection.go:153` related_to精确读取关联；`runtime/internal/store/logquery.go:103` ReadVisibleReply按is_terminal DESC、seq DESC选终态优先/否则最新进度。这能为已知request找回不在当前历史页中的终态，无需前端加载全部正文或新增channel_control。
- `logprojection.go:95`对没有回复的request也默认state=processing。该字段是日志展示分类，不是运行证明；排队/执行状态必须来自实际响应payload。查询返回的是head_seq处可见消息事实，后续live仍需合流；不可用旧head去证明新鲜度。
- 分页搜索可发现未知请求，但没有固定成本的Base活跃全集接口。必须尊重scan_limited/has_more及分页边界；逐任务对账不证明全队列无遗漏。Base心跳由运行事件触发，不能保证刷新后立即送达。这是已确定的能力边界，不是“还没读代码”。需要完整冷态恢复时先落实既有分页/持久索引方案并核算成本，只有确实不满足目标才提出BE-02；本次不授权、不实施任何后端变更。

### 6.2 重试：已有持久化幂等，不需要改后端

- `platform/internal/humancell/humancell.go:237` interpretSubmit，`:335` submitFingerprint：规范化kind/type/payload/visibility/parent以及显式audience/expires_at。
- `lib/actorbase/engine.go:640`与`runtime/harness/chain.go`将指纹送入账本Append；`runtime/internal/store/messages.go:182`重复ID相同指纹返回原seq/Replayed，不同指纹拒绝；同文件onCommit排除Replayed。
- `platform/internal/humancell/humancell_verbs.go`将ID冲突映射idempotency_conflict。前端不能在重试时更换ID或期限、正文，不能把鉴权/过期拒绝当成未落账证明。
- 已有`runtime/internal/store/messages_test.go:202/227/270`分别覆盖重复及冲突、12写入者并发、数据库重开。这里只阅读测试，没有执行。证明范围为提交去重，不是任意工具外部副作用exactly-once。

### 6.3 attach：存在服务端集合等待，但不能仅凭源码断言实际耗时

- `drivers/gateway/connector/web/web.go:129`：PrimeFeed→PrepareHistoryMetadata→receipt→LaunchFeed。
- `drivers/gateway/session.go:291`：4 worker覆盖非temporary订阅，共享读期限，收完全部结果才返回；focus只影响收集后的排序。
- `drivers/gateway/gateway.go:57`默认读期限5秒。PrimeFeed/reconcile在前，5秒不是整个启动上限。
- `platform/home/view.go:199`→`runtime/internal/store/messages.go:218`已经走不读payload的Meta查询。之前将现状说成必须反序列化各频道正文不准确。
- 消息阅读/滚动重构不要求改这条后端链；移除这条服务端集合等待本身则需后端实现变更，必须在计时证据和具体方案得到批准后进行，未必需要协议变更。客户端主动同步和需求重试能使用现成能力，不能代替服务端优化，也不能把所有移动端延迟归因于这里。

本次仅修改独立文档工作树；运行前端、后端代码、用户TUI变更、服务和数据库均未修改。消息不见F29仍未经过运行诊断，不据上述代码核验宣称已修复。
