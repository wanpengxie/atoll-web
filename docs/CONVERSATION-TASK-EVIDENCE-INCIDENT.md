# 等待区任务证据：查询风暴事故与最小产品合同

日期：2026-09-17  
状态：只读事故复盘与接入边界；不批准生产自动查询，不新增协议或后端投影。

> **2026-09-17 更正：本报告关于“现有无副作用入口只能覆盖已加载窗口”、
> “窗口外任务只能长期 unknown”的结论不完整，现已撤回。** 当时只核了 HTTP
> `obs.js` 封装，漏核 Gateway 的只读 `history_before` 控制帧。该帧直接读取
> `LedgerView`，不会写入频道账本，并返回可分页的语义历史与扫描 coverage。
> 查询风暴因果与禁止恢复 `system.log.query` 自动入口仍有效；接口替代、真实投影
> 范围和有限补证机制以
> `docs/CONVERSATION-GATEWAY-VIEW-TASK-EVIDENCE.md` 为准。

## 1. 结论

当前 Composer 上方的“等待区”不是“全频道任务中心”。它展示的是一组**已经在 Replica 中成为消息 turn、属于内容消息类型、由同一受理 actor 的实际 progress 帧证明仍为 `queued`、且当前同步证据没有遗漏其后续终态**的等待消息。

产品规格还分别定义了：

- 时间线中的长任务单元：请求、临时文本、工具活动、审批和终态；
- 全局后台操作中心：跨频道创建、上传、Actor 启动和长任务。

把这三层合并成“后台遍历所有 agent/tool/peer request，恢复完整活任务集合”，是对等待区职责的扩大，不是当前等待区正常使用所必需的合同。

`system.log.query` 是写入频道账本的 request，不是无副作用 view。用它在前端自动冷扫整个账本，即使消除反馈环，也会制造用户可见 system 操作；当前生产入口必须继续关闭。

## 2. 已发生的反馈环

原接线把 Scheduler 的物理 `headSeq` 当作任务发现 round boundary。一次查询有如下闭环：

1. Hook 以边界 `H` 调用 `system.log.query`。
2. Query 作为普通 request 入账；其 terminal 也入账。
3. 两条账本事实进入 Replica，同时把 Scheduler `headSeq` 从 `H` 推高。
4. React effect 看到 boundary/Replica revision 变化，先 deactivate/abort，再以新 head 创建 round。
5. Controller 清空 `verified`，把发现游标重置为 `head + 1`，立即再次查询。
6. 成功轮次清空错误与退避，所以错误退避不能限制这个成功自激环。

排除 `system.log.query` 作为“候选任务”不能断环：它仍然推进物理 head。隐藏查询消息也不能断环，只会掩盖已经写入账本的操作。

原来的 quantum 上限也不是生命周期上限。一个被截断的已知候选最多可能发生 1 次 related 查询、31 次 anchor `next_read`、31 次 response `next_read`，即约 63 次查询；所谓 64 次查询上限仍可能制造约 128 条 request/terminal 账本记录。这个 UX 与资源成本不适合作为等待区的默认冷启动行为。

## 3. 最小等待区合同

一项进入等待区必须同时满足：

1. `request.type` 是当前产品定义的“内容消息”类型，而不是仅凭 recipient kind 推断。现有集合为 `agent.ask`、`agent.queue`、`agent.compact`、`agent.new`、`agent.replace`、`agent.steer`。
2. 请求与状态属于当前频道、当前 actor incarnation；roster/identity 未校准时不能宣布集合 current。
3. actor 自己的实际 progress 帧声明 `status: queued`。没有 reply 的 request 不能默认当 queued；日志投影的 `processing` 也不是执行证据。
4. 同一 progress 帧提供 controls；前端不从 describe 或静态表猜按钮。
5. 请求未出现 terminal；terminal、`processing` 或 `merged_into` 后归时间线，不再留在等待区。
6. 当前同步 coverage 足以覆盖该 queued 证据之后直到当前业务边界，避免缓存缺 terminal 时复活旧 queued。

因此下列内容不属于等待区候选：`actor.describe`、能力参数读取、`agent.options`、`agent.context`、`agent.select`、治理/system word、任意 tool/peer request、仅在日志里无响应的 request、已经 processing 的长任务、已终结任务。

这不是宣称这些操作“不重要”。它们分别属于 Actor 能力面板、时间线、审批、任务视图或全局后台操作中心；不能因等待区恢复困难而混进同一集合。

## 4. 现有端口能证明什么

| 现有入口 | 副作用 | 能证明 | 不能证明 |
|---|---:|---|---|
| live observe → Replica | 无额外业务消息 | 当前连接收到的 request/progress/terminal；新 queued 与其后续终态 | 连接前且窗口外的旧事实 |
| `historyBefore` → Replica + verified coverage | transport 读，不创建频道业务 request | 已加载历史段的消息事实；连续覆盖区间内没有被过滤掉的后继终态 | 尚未读取区间中的未知 queued；未覆盖全历史时的“全集为空” |
| `channelMeta` / Scheduler status | transport/view 读 | 远端物理 head、attach generation、同步/coverage 新鲜度 | 哪些 seq 是业务任务；任务集合 |
| `/obs/channel/:id/actors` | HTTP GET | 当前 roster 与 actor incarnation | actor 当前有哪些 queued 消息 |
| 当前 capability index / actor describe | describe 本身是一次账本请求；结果仅对该现场请求有效 | actor 当前声明接受哪些 word、schema、风险/能力字段 | word 是否具有“等待区内容消息”语义；历史任务全集；按钮（按钮只认 progress controls） |
| 已加载 Replica turns | 无新增副作用 | 已见 request 与实际 queued/processing/terminal 状态 | Replica 外的未知请求；缺口外是否已有终态 |

OBS 现有 GET view 只有 space/channel/profile/actors/devices 等管理投影，没有 task/queue view。当前 manifest 的 word 描述也没有通用的 `waiting-task` 分类位。故前端不能从“actor/tool/peer 接受这个 word”推出“它应进入等待区”。

## 5. 不新增查询时如何自动收敛

“unknown”不是永久等待动画，也不等于假空。当前端口可在以下条件自动收敛：

1. **持续连接**：新内容请求和 `queued` progress 经 live observe 入 Replica；其 terminal 或 `processing` progress 同样实时移出等待区。
2. **重连/冷恢复的已知项**：Scheduler 正常 tail catch-up/history 恢复，把某个已知 queued 的 source seq 到当前 head 之间形成连续 verified coverage；Replica fold 看到 terminal 就移除，没有 terminal 才允许把该已知项恢复为 current queued。
3. **新出现的旧任务事实**：用户正常向上加载历史时，相关 request/progress 进入 Replica；只有随后覆盖到当前边界，才升级为当前 queued。
4. **actor incarnation 变化**：roster 当前后，只保留同一 live incarnation 的非终态；旧 incarnation 的 terminal 仍可作为历史事实，但不能复活为当前等待项。

在这些条件之外，系统应保持证据不足并不渲染等待层；连接、历史加载或新 live 事实到达后自然重新投影。无需由 raw head 或任意 render 创建新的扫描兴趣。

## 6. 当前无法证明的范围

使用现有无副作用入口，前端不能自动证明：

- Replica 与已验证 coverage 之外，是否存在一条很早、至今仍 queued、且之后没有任何 live 心跳的内容消息；
- 未扫描全历史时，频道中“绝对没有任何 queued 消息”。

这两个否定命题不应被伪装成 `complete=true`，也不应以后台 `system.log.query` 冷扫来换取。当前等待层产品规则本来就是“空、unknown 或证据不足不渲染”；它并不要求向用户显示一条“已经证明全历史零等待”的全局断言。

若未来产品明确要求跨窗口、跨频道的完整后台任务集合，应归到后台操作中心，并先取得一个有明确范围、身份、游标和无账本写放大的权威投影合同；不能复用等待区的局部消息投影冒充完整任务数据库。

## 7. 生产重新准入门

当前不建议恢复自动 discovery hook。任何后续隔离方案至少要先证明：

- query 自身 request/terminal 推高物理 head 时，不创建业务 interest、不重开 round、零追加 submit；
- `actor.describe` 等非内容请求不会成为候选，未知 capability 也不会被静默当成完整支持或完整排除；
- unmount、deactivate、频道/账号/generation 切换后，timer、迟到 terminal 与旧 promise 都不能继续 submit；
- 每个激活生命周期有总查询预算而非每轮重置预算，耗尽后发布真实 partial/error 并停止；
- roster unknown 时不能发布 current/complete 或权威空集合；
- 所有由查询产生的用户可见操作数与 UX 代价被明确验收。

这些门只是事故回归，不代表自动冷扫符合产品合同。是否需要完整后台任务发现，仍需独立产品决定。

## 8. 源码与规格依据

- `src/model/agent-control.js`：内容消息集合与 queued/timeline 阶段机。
- `src/model/task-controls.js`：queued/processing 和 controls 只认同一 actor-authored progress 帧。
- `src/ui/Timeline.jsx`：等待层文案为“等待消息”，且 cached open state 必须由同步新鲜度/coverage 校准。
- `src/net/obs.js`：现有 OBS GET view 范围，不含 task/queue 投影。
- `src/app/hooks/useChannelFeed.js`：`queryLog` 以普通 public `system.log.query` request 经 `wire.submit` 发出。
- `src/model/history-scheduler.js`：live seq 推进物理 head 与 verified coverage。
- `docs/USER-INTERACTION-SPEC.md` §6、§7、§15.2：时间线长任务、控制长任务、全局后台操作中心是不同产品层。
- `docs/CONVERSATION-IMPLEMENTATION-SPEC.md` §2.2、§7：证据不足不渲染等待区；生产自动查询当前未准入。
