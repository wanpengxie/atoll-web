# Gateway View 任务证据审计与 W5 替代机制

日期：2026-09-17  
范围：只读核对前端调用、Gateway wire、Platform View 与 handler；未发任何真实请求，不改生产代码。

## 1. 更正后的结论

W5 使用 `system.log.query` 是选错端口。前端已经有 `history_before`：它是附着用户连接上的 Gateway read control，直接读取该用户有权看到的 `LedgerView`，源码合同明确说明它**永不进入账本**。返回的 history feed 继续走现有 Scheduler、Replica 与 fold，因此不需要第二套消息解析、关系图或分页所有者。

上一份报告把“前端 HTTP OBS 没有 task endpoint”扩大成“现有 view 无法恢复窗口外任务”，这个判断错误，已经撤回。正确边界是：Gateway history view 能分页扫描自己的语义投影；其投影会主动过滤一组 housekeeping word，因此 W5 可恢复范围必须按实际投影列出，不能笼统声称覆盖全部消息词。

## 2. 现有 Gateway read control

### 2.1 `channel_meta`

请求字段：`channel_id`、正整数连接 `generation`。

返回：`channel_id`、`head_seq`、`has_rows`、`last_activity`、`generation`。它只读当前可见 head，不反序列化消息正文，适合建立一次固定同步边界；它不返回任务集合。

### 2.2 `history_before`

请求字段与约束：

| 字段 | 合同 |
|---|---|
| `channel_id` | 已 attach/observe 且当前仍有读取资格的频道 |
| `before_seq` | exclusive keyset cursor；`0` 表示当前 tail |
| `limit` | 1–200；缺省 200；是软 raw-row 目标，View 可多扫到语义 root 边界 |
| `byte_limit` | 1–4 MiB；缺省 4 MiB |
| `generation` | 当前连接正整数 generation，旧代拒绝 |
| `purpose` | `initial-tail`、`user-demand`、`hydrate` |
| `priority` | `foreground`、`background` |

生命周期：Gateway 先回 accepted receipt，再以同一 `ref` 发送零到多条 `feed{source:"history"}`，最后必须发送一个 `page_end`。同频道最多一个 history batch；连接总计最多四个，其中 background 最多三个。`history_cancel` 以 `target_ref + generation` 幂等取消已接纳批次。

每条 feed 给出 `channel_id`、ledger `seq`、完整 Envelope、`generation` 与 batch `ref`。Envelope 自带 `id/kind/type/parent_id/correlation_id/sender/audience/payload`，现有 fold 可直接恢复 request、provisional 和 terminal 关系，不需要 `related_to` 查询。

`page_end` 给出：

- 固定页读数：`head_seq`；
- 返回行边界：`oldest_seq/newest_seq`；
- 实际扫描区间：`scan_low_seq/scan_high_seq`；
- 下一 exclusive cursor：`next_before_seq`；
- `rows/bytes/has_older`；
- 失败时 `error_code/error_detail`。

前端 Scheduler 已把 `scan_low_seq..scan_high_seq` 合并为 `verifiedCoverage`，把 `next_before_seq` 作为自己唯一的深历史 cursor，并将 history feed 统一提交 Replica。它也已经拥有 generation fencing、取消、单频道 inflight、foreground/background admission、缓存与 retry。

### 2.3 `observe` / live feed / checkpoint

Live feed 返回完整可见账本，不走历史 housekeeping projection；因此新产生的 queued/progress/terminal，包括历史 view 会过滤的控制词，仍会进入 Replica。Checkpoint 给出本代实际扫描的 `scan_low_seq..scanned_seq`，可扩展 coverage。`unobserve`/断线/generation 更替终止旧读取资格。

### 2.4 HTTP OBS

现有 HTTP OBS 仍只负责 space/channel/profile/actors/devices 等管理投影。`/obs/channel/:id/actors` 给 roster/incarnation/bound/device 状态，但不提供消息任务集合或 actor manifest。它是 W5 身份域证据，不是历史状态分页器。

## 3. History View 的真实语义投影

`ReadHistoryWindow` 返回按 seq 升序的语义闭合页：

- 每个 request 保留；
- 已完成 request 保留 terminal；
- 未终结 request 只保留 latest provisional；
- standalone visible message 保留；
- 语义边界以完整 root turn 为单位，不在任意响应中间截断；
- 页面仍受 row/byte limit，未返回的更旧部分由 `next_before_seq` 继续。

对 W5，这意味着 request + latest `queued/processing` progress 或 terminal 可以直接由现有 Replica fold 得到，不应再对 requestID 发 `related_to`。

但 history projection 会去掉 request 及其 response，只要 request type 被 `HousekeepingWord` 分类。当前精确分类包括：

- `actor.describe`；
- `agent.context`、`agent.options`、`agent.hold/unhold/interrupt/fork/select`；
- `agent.new`、`agent.steer`、`agent.compact`；
- 所有 `system.*`。

因此按当前前端六类内容消息集合：

| 内容类型 | history_before 冷恢复 | live/本机既有 cache |
|---|---:|---:|
| `agent.ask` | 是 | 是 |
| `agent.queue` | 是 | 是 |
| `agent.replace` | 是 | 是 |
| `agent.new` | 否，housekeeping 过滤 | 是 |
| `agent.steer` | 否，housekeeping 过滤 | 是 |
| `agent.compact` | 否，housekeeping 过滤 | 是 |

这是一项确证的投影范围差异：它不阻止先把 `agent.ask/queue/replace` 的 W5 恢复改走现有 View，但在现合同下不能把 `history_before` 扫到 origin 等同为“六类内容消息全集已恢复”。本报告不提出新后端接口，也不以隐藏等待区替代这个证据缺口。

超大 payload 在 Gateway browser transport 会被有界投影到约 10 KiB，但 `status/reason/error_code/detail` 是最高保留优先级，Envelope identity/type/parent 仍在。W5 仍需验证 queued progress 所需 `controls/work_id` 在极端 payload 中是否保留；不能把普通样本的完整 payload 当成无条件合同。

## 4. W5 最小替代机制

### 4.1 单一数据面

1. 删除 W5 对 `queryLog` 的依赖。W5 不再 `wire.submit` 任何 `system.log.query`。
2. Scheduler 继续是唯一 history 分页、cursor、generation、cancel、retry 与 admission owner。
3. 所有补证页仍通过既有 `history_before` 进入 Scheduler；Scheduler 校验 page/cursor/generation 后更新 coverage，并继续按原有可见性策略决定何时向 Replica reveal。
4. W5 不维护第二个 cursor、relations graph 或 raw message store。它消费两种同源事实：已经 reveal/live 进入 Replica 的 turn，以及 Scheduler 在 page commit 时已经校验过、但暂存在 reservoir 中的语义页。后者只能投影为有界 task evidence，不能自行继续分页或把后台行提前 reveal 到时间线。

### 4.2 固定义务，而不是追逐 head 的 round

一次 attach generation 建立一次固定证据边界 `H`。W5 的兴趣绑定 `{principal, channel, generation, H}`，不绑定 React render revision、Replica revision 或随后每一个物理 head 变化。

- Scheduler 已经在初始 tail、warm hydration 和用户上翻时推进自己的 `beforeSeq`；W5消费这些既有结果。
- 自动 `actor.describe/options/context`、普通消息或 task 自己带来的新 head 只按 live feed 合入 Replica/coverage，不重置深历史 cursor，不清已验证项，不新开扫描轮。
- 重连产生新 generation 时才废弃旧义务；频道/账号切换和 unmount 交给既有 Scheduler cancel/generation fence。
- 若固定 `H` 之后发生真实 task progress/terminal，live fold 直接更新该 task；不需要回扫 `1..newHead`。

实现上应把两个概念分开，不能继续共用一个动态 `boundary`：

- `discoveryHead = H`：本 generation 的冷发现上界；只由 attach/current 建立，决定旧历史向下扫描到哪里算覆盖本轮集合，不随后续 head 重开。
- `freshThrough = L`：live feed/checkpoint 已连续验证到的前沿；可随正常 live（包括合理探针）单调前进，用来判断某个已知 queued 在 `sourceSeq..L` 是否仍未见 terminal，但绝不创建新的 backfill round。

这既不会忽略 `H` 之后用户新提交的任务或其终态，也不会把每次 head 增长解释成重新从 tail 扫描。连接出现 gap 时由既有 Scheduler tail-refresh 恢复 `freshThrough`；generation 更替才建立新的 `H`。

### 4.3 有限补证与收敛状态

第一阶段不新增分页循环或独立 budget。复用 Scheduler 已有的 bounded working-set 策略：P0/P1/P2 warm scan budget 分别为 384/256/128 raw seq，单页 32–200 行、1 MiB 默认前端 batch，上限受现有 reservoir 和全局并发约束。

投影状态按证据发布：

- `current item`：某个 queued source 到固定 `H` 已有连续 coverage，且同 incarnation Replica turn 未见 terminal/processing；
- `partial`：已加载范围可安全显示其中项目，但扫描尚未到 origin，或存在 history-filtered 内容类型缺口；
- `complete(projected-range)`：`verifiedCoverage` 覆盖 `1..H` 且 `next_before_seq == 0`，只对 history view 实际承载的类型成立；
- `unavailable/calibrating`：未 attach、generation/roster 未当前，或 tail gap 尚未补齐。

在有限 warm 范围内的旧 queued 只有在 W5 接到上述“已校验语义页”投影后才会自动收敛；用户正常加载更旧历史也会继续推进同一 Scheduler cursor 和 coverage。超过已扫描范围的事实保持明确 `partial`，不得把长期 partial/unknown 标作完成。是否需要自动扫到 origin 是后续性能/产品验收项，但不能通过恢复另一套循环或写账查询实现。

## 5. 自动 describe/options/context 的核对

这三类不是 W5 冷扫描，且用户已确认它们作为必要能力探针合理；本轮不建议取消或寻找替代 view。

当前事实是：

- Composer 目标出现时，App 在当前连接内缺 describe 会自动发一次 `actor.describe`；describe 成功后，对 manifest 明确支持的 `agent.options`、`agent.context` 各自动发一次。
- 点击 roster participant 在缺 describe 时也会触发 describe；用户显式展开参数区可重试此前失败探针。
- wire open 会清本连接 probe registries，因此重连可重新校准当前 incarnation。
- 三者都是普通 request/terminal，因此会推进 ledger head；`agent.options/context/actor.describe` 被 history projection 视为 housekeeping，不进入历史时间线页。

它们之所以不会重演 W5 风暴，必须依赖各自 per-connection/per-actor 去重与失败停止，而不是让任何通用 task hook 把它们的 head 变化解释成新发现义务。W5 修正不删除这些合理探针。

## 6. 删除与保留清单（供主执行接线）

删除或保持断开：

- `useChannelFeed.queryLog` 的 W5 消费路径；
- `useTaskEvidence` 对 `queryLog` 的 controller 构造与 effect；
- `task-discovery.js` 中 `related_to/raw/next_read`、自有 cursor、head round、retry/timer 与 localStorage discovery index；
- 围绕 `system.log.query` waiter/terminal settle 的 W5 专用测试合同；若 `queryLog` 无其它真实产品消费者，端口及 waiter plumbing 可在独立清理中整体删除；
- 任何由 Replica revision、raw head 或 query terminal 自动重开 discovery round 的逻辑。

保留并复用：

- `wire.channelMeta/historyBefore/cancelHistory`；
- `history-scheduler` 的单一分页、coverage、generation、cancel、retry、cache 与 admission；
- `useChannelFeed` 的 history feed/page_end → Scheduler → Replica 提交链；
- `projectTaskEvidence` 从 Replica turn、coverage、roster/incarnation 生成等待项的纯投影；
- 必要且有界的 `actor.describe/agent.options/agent.context` 能力探针及其去重。

尚未批准生产重接。主执行应先以隔离 mock 证明：W5 激活和分页不会调用 `wire.submit`；自动 describe/options/context 推高 head 时 task 页数与 submit 数保持不变；切换/unmount/generation 更替后 Scheduler 旧 ref 被取消或忽略；投影过滤的三类内容消息不会被误报为已完整恢复。

现有测试还不足以证明这条接线：`task-evidence.test.js` 只在 `taskSnapshot` 分支覆盖 `actorScopeCurrent=false`，没有覆盖当前实际 fallback；`task-discovery.test.js` 与 `task-evidence-hook.test.jsx` 主要断言旧 `queryLog` controller，应退役或改写为以下无写账 oracle：

- fallback 即使 `controlCurrent=true` 且 coverage 完整，只要 roster scope 未 current，就必须 `items=[]/complete=false`；
- background warm page 未 reveal 到 Replica，也能在 Scheduler 的已校验 page handoff 中发现 queued，但不会改变可见时间线行；
- `discoveryHead` 固定后，连续 probe/live head 只推进 `freshThrough`，不增加 history 页数、不清除已发现项；
- generation/principal/channel 更替拒绝旧 page handoff；origin 未达或遇 filtered 内容类型时保持 partial；
- 所有上述路径的 `wire.submit` 调用数恒为零。

### 6.1 当前生产接线仍有两个阻断点

这份机制不是“把旧 hook 删掉后直接启用现有 fallback”即可完成。当前源码还缺两项明确合同：

1. `App` 构造的 `activeHistory.status` 只有 `historyFor(channel)` 与 `localReplicaReady`，没有 roster 当前性。`Timeline` 因此把 `taskActorScopeCurrent` 算成 `false`；然而 `projectTaskEvidence` 的无 `taskSnapshot` fallback 分支目前没有使用 `actorScopeCurrent`，仍会只凭 `controlCurrent` 发布 queued items，并可能在 coverage 覆盖 `1..head` 时发布 `complete=true`。在现状下直接接回 fallback 会把未知或旧 incarnation 的 actor 域误称为 current。
2. `Timeline` 目前把动态 `schedulerStatus.headSeq` 当 task boundary。固定 attach/generation 证明边界 `H` 尚未由 Scheduler 快照并暴露；任意 live/probe head 都会改变该 boundary。虽然这不再产生写账查询，但它不符合“不因自身/探针 head 变化新开证明轮”的机制合同。
3. Scheduler 的 background warm page 会先进入有界 reservoir；除 initial tail、tail refresh 或用户 demand 触发 release 外，这些行不会进入 Replica。coverage 只能证明扫描区间，不能凭空提供 request id、类型或 queued status。因此“直接从当前 Replica + coverage 投影”只能覆盖已显示/已 reveal 的 turns，不能兑现 warm scan 已发现但仍缓冲的等待项。

最小 owner 修正仍应落在既有 owner 内，而不是新建任务控制器：Scheduler 在 attach/current 建立时暴露固定的 task-evidence boundary，并在 generation 更替时重置；它在现有 `commit` 已完成 page/generation/cursor 校验后，把该语义页交给纯 task projector 一次（包括仍留在 reservoir 的行），但 projector 没有 requestPage/cancel/retry/timer 能力。现有 roster owner在同一 principal/channel 的网络 refresh 成功后暴露 current，治理失效信号、账号/频道生命期变化时先降为非 current。`projectTaskEvidence` 的 fallback 与 snapshot 两个分支都必须受该 roster current 门控并按当前 actor id 集合过滤。未满足这些条件前，等待区不得把集合宣称为 current/complete。

## 7. 证据位置

- `atoll/platform/subjectgate/frame.go`：Gateway read frame 字段与“history never enters ledger”合同。
- `atoll/drivers/gateway/session.go`：资格、并发、View 读取、feed/page_end 与 cursor shape。
- `atoll/platform/channelspec/history.go`：语义页的 request/latest provisional/terminal 投影。
- `atoll/platform/channelspec/housekeeping.go`：历史投影过滤的精确 word 集合。
- `atoll/runtime/internal/store/messages.go`：exclusive `before_seq` keyset、visible read 与 head snapshot。
- `atoll-web/src/net/wire.js`、`src/protocol/frame.js`：现有浏览器 wire port 与前端字段校验。
- `atoll-web/src/model/history-scheduler.js`：单一 cursor、coverage、budget、cancel 与 generation owner。
- `atoll-web/src/app/hooks/useChannelFeed.js`：history feed/page_end 提交链及错误的 `queryLog` 写端口。
- `atoll-web/src/App.jsx`：describe/options/context 的有界自动探针。
