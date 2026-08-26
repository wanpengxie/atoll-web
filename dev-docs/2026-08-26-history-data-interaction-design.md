# Timeline History 数据平面与交互平面统一设计

状态：Phase A+B+C 已实现并通过模型/隔离浏览器/协议门禁；Phase D 仅为可选首屏性能增强
日期：2026-08-26  
范围：Timeline 历史首屏、向上加载、IndexedDB、WS live/history、筛选、频道切换、断线恢复、优先级与可观测性

## 1. 结论

现有问题不是某个 `startReached` 回调漏触发，而是跨层使用了错误的完成单位：

- scheduler 生产和消费的是 ledger row；
- fold 生产的是 timeline entry；
- 当前 scope / actor filter 最终展示的是 visible item；
- Timeline 却把“释放了 32 个 ledger row”近似成“这次顶部交互已经取得进展”。

真实数据直接否定了这个近似。当前频道最近 5000 行中，3834 行是 provisional；157 个连续 32 行窗口中有 75 个没有新的可见条目；最长连续 603 行没有可见起点。零可见批次是常态，不是边界。

目标结构只有一条正确性链路：

```text
物理顶部状态
    ↓
TopIntentController（一次顶部访问只有一个 intent）
    ↓
LoadUntilVisibleOperation（anchor + viewSpec + cancellation）
    ↓
HistoryCoordinator.nextSegment（cache / WS 的统一连续历史）
    ↓
FoldStore.applySegment（幂等、一次 publish）
    ↓
projectTimeline(state, viewSpec)
    ↓
firstVisibleSeq 穿过 anchor / ledger exhausted / failed / cancelled
```

正确性不再依赖 React effect、`setTimeout(0)`、Virtuoso 是否再次发回调，也不依赖固定行数恰好产生可见项。

## 2. 四种单位，禁止再混用

### 2.1 LedgerRow

账本事实。request、provisional、terminal、housekeeping、terminal session 都是一行。它只用于传输、游标、coverage、审计和 fold 输入。

### 2.2 HistorySegment

一段已经确认连续的历史扫描结果：

```ts
type HistorySegment = {
  channelId: string
  generation: number
  boot: string
  source: 'cache' | 'network'
  highExclusive: number
  lowInclusive: number
  nextBeforeSeq: number
  ledgerExhausted: boolean
  facts: Array<{ seq: number, envelope: Envelope }>
  rows: number
  bytes: number
  projectionVersion: number
}
```

`facts.length` 可以为 0；只要 `[lowInclusive, highExclusive)` 已被权威扫描，cursor 仍必须推进。`facts.length` 不是展示进度。

### 2.3 TimelineEntry

fold 后的语义条目：根 turn、其 child thread、standalone、orphan、narration。一个 entry 可以由几十或几百个 ledger row 组成。

### 2.4 VisibleItem

`projectTimeline(state, viewSpec)` 的输出。它已经应用：

- housekeeping / terminal lifecycle 隐藏；
- root/thread 归并；
- `@我` / `全部`；
- actor filter；
- transient collapse；
- 产品级 presentation policy。

用户向上滚动的完成单位只能是 VisibleItem。

## 3. 核心完成条件

一次顶部意图建立时记录：

```ts
goal = {
  operationId,
  channelId,
  viewKey,
  anchorSeq: projectTimeline(state, viewSpec).firstVisibleSeq,
  topEpoch,
  signal,
}
```

它只能以四种状态结束：

1. `satisfied`：`firstVisibleSeq > 0 && (anchorSeq === 0 || firstVisibleSeq < anchorSeq)`；
2. `exhausted`：权威 network cursor 已到 ledger 起点；
3. `failed`：明确错误进入可重试状态；
4. `cancelled`：离开顶部、切频道、viewKey 改变、失去访问权或稳定 view owner 被明确 dispose。

以下情况一律不能结束目标：

- 释放了 32 行；
- reservoir 数量下降；
- fold 有变化但首个可见 seq 没变；
- 收到空 page；
- cache 到了自身边界；
- live 新消息到达；
- Virtuoso 没再发 `startReached`。

## 4. 数据平面

### 4.1 Attach seam

网关的正确 seam 是：先安装 commit subscription，再为频道取 head `H`，将 live cursor 设为 `H`，随后 live 只发送 `seq > H`。

初始历史必须以 `beforeSeq = H + 1` 读取，而不是 `beforeSeq = 0` 的移动 head。由此得到：

```text
history: seq <= H
live:    seq > H
```

即便过渡期仍存在 overlap，FoldStore 的 seq/id 幂等也必须兜底；但目标合同应是明确 seam，而不是依赖 overlap 猜测无缝。

当前网关不会把滞后 cache 到 head 的整个缺口当 live 回放。`since` 初始化的 cursor 会在 attach metadata 阶段推进到服务端 head。滞后缺口本来就应由 `history_before` 补，不需要为这个问题新增“大 gap 截断协议”。

### 4.2 HistoryCoordinator 的状态

每频道只有一个所有者：

```ts
type ChannelHistory = {
  generation: number
  boot: string
  headSeq: number
  beforeSeq: number         // cache/network 共用的 exclusive scan frontier
  ledgerExhausted: boolean
  coverage: CoverageMap
  reservoir: OrderedSegments
  inflight?: Batch
  error?: RetryableError
}
```

- cache 与 network 只能服务同一个 `beforeSeq`；cache miss/hole 不移动它，network 从原位接管；
- 取得的事实可以先进入有序 reservoir，只有用户消费 segment 时才进入 FoldStore；reservoir 不是第二条账本 cursor；
- segment 必须首尾相接，不允许 reservoir 内有静默 gap；
- 每频道最多一个 history fetch in-flight；
- live 不进入 reservoir，也不移动 history cursor；
- background reservoir 达到行/字节水位后停止，不靠无限预取换体验。

### 4.3 Cache 与 network 的统一合同

v8 cache 保留浏览器实际收到的不可变 envelope fact，不再尝试在 terminal 到来时破坏性删除 provisional。network history 已做服务端投影、live 是完整可见账本；两者不需要伪装成同一种 row 分布，因为它们都只是同一个幂等 FoldStore 的合法输入。真正必须同构的是扫描合同：同一个 exclusive `beforeSeq`、明确的连续 coverage、严格递减的 `nextBeforeSeq`。

实现采用两类持久事实而不是不可变 page blob：

```text
rows          (channel, seq) → 已收到且可重放的 envelope fact
channel_meta  → boot / 独立 coverage intervals / quota metadata
```

coverage 只证明区间已被权威扫描，不声称该区间应有多少 row。fact 可以是 0，也可以有数百个 progress。短窗口写合批先提交 facts，再提交合并后的 coverage；崩溃最多造成安全的重复拉取，不会产生“coverage 已有、事实没落”的假命中。FIFO/quota eviction 同步裁剪 coverage，cache hole 从同一个 frontier 回到 network。

这里还有一个协议前提：仅凭若干 live feed row，客户端不能知道它们之间缺失的 seq 是“服务端已扫描但不可见”，还是“尚未收到”。v5 协议因此已新增与 generation/channel 关联的 `checkpoint(scanned_seq)`：

- live row 仍立即进入 FoldStore，不等待 checkpoint；
- cache 先把 live row 写 journal，但只在 checkpoint 后把上一个 checkpoint 到 `scanned_seq` 记为权威 scan coverage；
- 断线前未 checkpoint 的 journal row 可以保留为 hint，不能形成 coverage；
- checkpoint coverage 在同一有序写批中排在对应 facts 后提交；
- checkpoint 只证明 scan coverage，不改变 history reveal cursor，也不满足顶部 intent。

没有这个 watermark，live cache 最多只能保存零散 singleton coverage，不能被 HistorySource 当作连续历史。这是自审后补出的必要条件，不是可选优化。

v7 没有足够 provenance 区分 raw coverage 与 projected coverage，不能伪造无损迁移。v8 上线时应一次性失效 v7 的历史 cache；如果要迁移，只能把旧 rows 当非权威 hint，经服务端 coverage 校验后重新物化，不能直接继承旧 coverage。

### 4.4 Coverage 规则

coverage 必须是独立 interval map：

- cache 只有在 `highExclusive - 1` 落入一个连续 interval 时才能命中；
- cache read 只能读到该 interval 的下边界，不能跨 hole；
- cache interval 用完只表示 `cache-miss`，不表示 `ledgerExhausted`；
- hole 立即回退 network，并从同一个 `beforeSeq` 继续；
- network 的 `scan_low_seq / scan_high_seq` 才能增加权威 coverage；
- eviction 删除 segment 时必须同步截断 coverage 和 fetch frontier，绝不能留下“行没了但 coverage 还在”的幽灵命中。

### 4.5 Page 原子性

network page 以 `(generation, channelId, ref)` staged：

1. feed rows 只进入 batch staging；
2. `page_end` 到达后校验 generation/ref/channel、rows/bytes、scan interval、cursor 单调性；
3. `nextBeforeSeq < requestedBeforeSeq`，除非 `ledgerExhausted`；
4. `page_end` 校验成功后，在一个同步临界区提交内存 segment、coverage 与 `beforeSeq`；随后异步持久化，严格 facts-before-coverage；
5. 旧 generation、半页、缺 page_end 的结果不改变任何 cursor。

IndexedDB 写入遵守 facts-before-coverage；不要求用一个超大 transaction 锁住整个批次。崩溃在 facts 后只会重拉，绝不能让 coverage 先于 facts。内存消费必须是无 `await` 的同步临界区：

```text
peek segment → validate → FoldStore.apply all → advance reveal cursor → one publish
```

如果 fold 中途因意外异常只部分写入，seq/id 幂等允许重试补完；在整个 batch 完成前不得 publish，因而 UI 看不到半个 segment。

### 4.6 FoldStore 的内存形态

后台 hydrate 只进入有行数/字节双上限的 reservoir 和 5000-row IDB FIFO，绝不因为“预取到了”就进入 FoldStore。FoldStore 只保留用户已经实际展开的语义历史与本次 live session；Virtuoso 另外限制 DOM。这样 10 万 raw ledger 的首屏不会变成 10 万 JS envelope，测试同时约束 DOM、reservoir 和 IDB。

自审曾尝试在 terminal 到来时删除 provisional 来压缩内存，结果造成 reservoir 以 5000 输入 fact 停水而 cache 只剩 4008，且会丢失审计细节；该方案已撤销。任何未来 body spill/LRU 必须先建立完整的可回水 body 合同，不能夹在本次正确性修复里用删除事实冒充内存模型。

## 5. 交互平面

### 5.1 projectTimeline 必须是纯函数

从 `Timeline.jsx` 抽出唯一投影：

```ts
projectTimeline(channelState, viewSpec) => {
  items,
  firstVisibleSeq,
  lastVisibleSeq,
  visibleRevision,
}
```

`viewSpec` 至少包含 channel、scope、actor filter、self identity 和稳定 presentation policy。React renderer 只能消费 `items`，history operation 也必须调用同一个函数；禁止一套函数决定 UI、另一套简化判据决定“是否可见”。

### 5.2 LoadUntilVisibleOperation

```ts
async function loadUntilVisible(goal) {
  for (;;) {
    goal.signal.throwIfAborted()

    const result = await history.consumeNext(goal.channelId, {
      priority: 'foreground',
      signal: goal.signal,
      consume(segment) {
        foldStore.applySegment(segment) // 同步、幂等、一次 publish
        return projectTimeline(foldStore.get(goal.channelId), goal.viewSpec)
      },
    })

    if (result.kind === 'failed') return result
    if (result.kind === 'exhausted') return result

    const first = result.projection.firstVisibleSeq
    if (first > 0 && (goal.anchorSeq === 0 || first < goal.anchorSeq)) {
      return { kind: 'satisfied', revision: result.projection.visibleRevision }
    }

    // segment 可以是零 fact，或全部被 fold / filter 吃掉；继续同一个 goal。
    // 为避免长 cache 扫描霸占主线程，可以按 CPU budget yield，但 operation
    // 对象仍持有 continuation；yield 只影响性能，不参与正确性。
  }
}
```

一个频道/一个 viewKey 同时最多一个 operation。重复调用 join 同一个 Promise。

### 5.3 TopIntentController

Virtuoso 的 `startReached` 和 `atTopStateChange` 都只是观测提示。controller 每次都读取真实 scroller：

- `scrollTop <= epsilon` 才是 atTop；
- false → true 建立一个 `topEpoch`；
- 同一 epoch 同时最多一个 active operation，重复回调只 join；短列表在前一个 operation 完成并完成 layout acknowledgement 后，可以在同一 epoch 串行启动下一次 continuation；
- 离开顶部取消 consumer operation；已经完成的 network segment可以留在 reservoir，但不能在用户离开后突然 prepend；
- viewKey 在顶部改变时创建新的 epoch，旧 operation cancel；
- attach/cache metadata 晚到时 controller 重新 reconcile 当前 level，不需要补造 callback。

当前 `pending/armed/revealVersion/setTimeout/effect cleanup` 链路全部删除。React effect 可以负责注册观察者，但不能拥有 intent 或 continuation。真正卸载 view 时，由稳定的 view-owner token 显式 `dispose`；普通 rerender、依赖变化或 StrictMode probe 的 cleanup 不能静默销毁 intent。即使发生真实 dispose，迟到 segment 仍按数据平面合同进入 cache/reservoir，下一次 mount 由当前 top level 重新 reconcile。

### 5.4 短列表

短列表同时 atTop 和 atBottom。它不是“bottom 所以取消 top”，而是一个 viewport-fill goal：

1. loadUntilVisible 取得一个更早 VisibleItem；
2. React commit 后，`useLayoutEffect` 把该 `visibleRevision` 对应的真实 geometry 回报给 controller；
3. 仍然 `atTop && atBottom && hasMore`，同一 topEpoch 再启动下一个 loadUntilVisible；
4. 直到列表可滚动或 ledger exhausted。

必须等待指定 revision 的 layout acknowledgement，不能用 `setTimeout(0)` 猜 DOM 已更新。

### 5.5 筛选与频道切换

- `viewKey = channelId + scope + sortedActorFilter + projectionPolicyVersion`；
- 筛选改变只取消旧 consumer，不取消已经在进行且可复用的同频道 data fetch；结果进入 reservoir；
- 新 view 在物理顶部时从自己的 anchor 开始；若已应用事实都被过滤掉，继续向前扫描；
- 切频道取消旧 view operation，并立即提升新频道 foreground priority；
- 已取消的旧频道 page 可以完整落 cache/reservoir，但不能 publish 到当前 view；
- 失去访问权立即取消、隐藏内存状态，并清除或隔离该频道 cache。

## 6. 冷启动、滞后 cache 与实时流

### 6.1 全新环境，无 cache

1. attach 先建立 focused channel seam，得到 head `H`；
2. live lane 从 `H + 1` 开始，始终独立；
3. focused initial-tail 以前台优先级请求 `before = H + 1`；
4. segment 原子应用，projectTimeline 立即展示；
5. 若首屏仍短，由 viewport-fill goal 继续；
6. background hydration 只能在 foreground 保留槽之外运行。

结论：没有 cache 也不依赖回调时序；初始 tail、live 和后续向上翻页都有明确 seam 与所有者。

### 6.2 cache 严重滞后

设 cache 最新覆盖到 `C`，attach head 为 `H`，且 `C << H`：

1. 初始 frontier 是 `H + 1`，cache 不覆盖 `H`，因此 focused initial-tail 先走 network；
2. 当前 tail 先展示，不先把陈旧 cache 伪装成“当前页面”；
3. live `> H` 立即应用；
4. history 从 `H` 连续向下补，进入 cache coverage 后才切 cache；
5. coverage hole 再切回 network；整个过程 reveal cursor 严格递减且不跳洞。

结论：滞后 cache 是历史加速器，不是当前 tail 的权威，也不会阻塞 live。

### 6.3 5000 行高密度 progress cache

一次 top intent 可能连续消费 19 个或更多零可见 raw/semantic segment。operation 不设“最多 N 批”的正确性上限；只依赖严格递减 cursor 保证终止。取得第一个更老 VisibleItem 后才 satisfied。

### 6.4 浏览历史时 live 到达

live 直接进入 FoldStore，但不能满足旧 anchor。用户不在 bottom 时维持视口并累计“新动态”；history operation 只用更老 firstVisibleSeq 判定完成。回到底部才更新 read cursor。

### 6.5 断线发生在 page 中间

没有匹配 page_end 的 staged rows 全部丢弃；generation 前进；reconnect 从未提交的 `beforeSeq` 重试。已经 commit 的 cache/segment 保留，同 boot 下可复用。

## 7. 优先级与资源隔离

优先级必须端到端成立，不是只给 `PQueue` 一个数字：

| 等级 | 工作 | 资源策略 |
|---|---|---|
| P0 | live feed / receipt / access revoke | 独立 lane，不占 history slot |
| P1 | 当前频道 top intent / viewport fill | foreground history lane |
| P2 | 当前频道 initial-tail / 切入首屏 | foreground history lane |
| P3 | 当前频道 reservoir refill | background lane |
| P4 | 最近频道 initial-tail | background lane |
| P5 | 其他频道 hydrate | background lane |

约束：

- 每连接最多 4 个 network history read；background 最多占 3 个，永远保留 1 个 foreground slot；
- server admission 也执行相同保留，不能只相信客户端；
- live writer 每个 frame boundary 严格优先于 foreground history，foreground history 优先于 background；
- fairness 只在同一优先级内轮转，禁止等待时间把 background 晋升到 foreground；
- focus 改变立即重排 queued work；已运行的 bounded page 可以完成；
- 快速切频道需要 `history_cancel(ref)` 取消不再有消费者的 foreground server read，从而及时释放保留槽；同频道筛选改变通常保留 fetch，因为数据仍可复用；
- `purpose`（initial/user/hydrate）与 `priority`（foreground/background）分开。purpose 可以影响 root window 大小，priority 只影响 admission 和 transport lane。

当前网关已有 live/history/backfill 三 lane，基础方向正确；缺的是 focused initial 进入 foreground lane、background slot 上限、显式 cancel，以及客户端 fairness 不跨级。

## 8. 原子模块边界

### 8.1 HistorySourceAdapter

只实现统一的 `readBefore()`，cache/network 都返回 HistorySegment 合同。它不懂 React、scope 或“顶部”。

### 8.2 HistoryCacheStore

只拥有 fact FIFO、coverage、boot、quota 和有序写批次。它不决定交互是否满足。

### 8.3 HistoryCoordinator

只拥有 per-channel fetch/reveal cursor、reservoir、inflight、priority 和 retry。它不计算 VisibleItem。

### 8.4 FoldStore + projectTimeline

FoldStore 只接受事实并保持 seq/id 幂等；projectTimeline 是唯一展示投影。二者都不发 network 请求，也不从“收到多少事实”推导 history completion。

### 8.5 HistoryInteractionController

只拥有 viewKey、topEpoch、geometry revision 与 LoadUntilVisibleOperation。它通过 coordinator 取 segment、通过 projector 判断完成，不直接操作 cache/WS cursor。

任何模块若同时拥有“数据 cursor”和“React callback 是否触发”，即视为边界设计失败。

## 9. 必须成立的不变量

### 数据不变量

1. 同一个 `(channel, seq/id)` 最多影响 fold 一次；overlap 可接受，重复效果不可接受。
2. history cursor 只在完整、校验通过的 segment commit 后推进。
3. 非 exhausted 的成功 segment 必须严格降低 cursor。
4. cache coverage 与 cache rows/facts 分开，且不能跨 hole。
5. cache miss 不等于 ledger exhausted。
6. live 不等待 cache/history，不进入 history reservoir，不移动 history cursor。
7. live cache coverage 只能由服务端 scanned checkpoint 增长，不能从相邻 feed seq 猜测。
8. attach head 是初始 history/live seam；initial history 绑定该 head。
9. reservoir 有行数和字节双上限；eviction 不得留下 coverage 幽灵。
10. generation/ref/channel 三者不匹配的 row/page_end/checkpoint 都不能提交。
11. membership revoke 之后任何 cache fact 都不能进入产品投影。
12. background reservoir/cache 不得因为预取而把 raw progress 注入 FoldStore；reservoir、IDB、DOM 分别有独立上限。

### 交互不变量

1. 一个 viewKey/topEpoch 最多一个 active operation；重复触发 join。
2. active operation 永远有下一动作：消费 segment、等待一个 in-flight、或进入四种终态；不存在 pending 但无 timer/inflight/demand 的状态。
3. 只有 visible prepend、ledger exhausted、failed、cancelled 能结束 operation。
4. live append 永远不能满足 older anchor。
5. React rerender、callback identity 和依赖 cleanup 不能改变 operation 的生死；只有稳定 view owner 的显式 dispose 可以 cancel。
6. viewKey 改变后旧结果不能满足新 view。
7. 短列表以 layout revision 的 level state 继续，不靠 callback edge。
8. 用户离开顶部后，迟到 page 不得突然 prepend；它只能进入 reservoir/cache。
9. 错误必须可见并可重试，不能用无限 retry 表现为“卡住”。
10. DOM 数量由 Virtuoso 控制；历史正确性不依赖 DOM 中保存全部 item。

## 10. 实施顺序

### Phase A：先建立可证明的语义

1. 抽出纯 `projectTimeline`，让 UI 与 history completion 共用；
2. 建立 `LoadUntilVisibleOperation` 和模型测试；
3. 用 controller 取代 Timeline 内 `pending/armed/revealVersion/timer`；
4. 暂时允许 coordinator 从现有 reservoir 供给，但完成条件彻底改成 visible anchor。

Phase A 已能消除当前 32 行死锁，但不能宣称 cache/network 一致性完成。

### Phase B：统一数据合同

1. 引入 HistorySegment 与独立 scan coverage；
2. cache schema v8，失效不可证明的 v7 coverage；
3. cache/network adapter 输出同一合同；
4. live checkpoint 协议，把 server 的 scanned watermark 交给 cache coverage；
5. page staging、cursor validation、fact/segment/coverage 原子 transaction；
6. initial query 锚定 attach head；
7. 后台 reservoir 与 FoldStore 隔离；禁止用破坏性 progress 删除伪造内存上限。

### Phase C：端到端优先级

1. purpose 与 priority 拆开；
2. client/server background cap = 3，保留 foreground slot；
3. focused initial 走 foreground lane；
4. `history_cancel(ref)`；
5. fairness 限制在同级。

### Phase D：focus-first attach（性能增强，不是本次死锁正确性的前提）

当前 attach receipt 要等所有频道 metadata。若频道很多或某频道慢，focused channel 会被无关频道拖住。要达到严格的最优首屏延迟，可把 attach 改成：先建立 focused seam 并回执，其他频道逐个发送 metadata update 并激活 live。这个改动需要单独协议设计，不能偷偷塞进 Timeline 修复。

## 11. 验收矩阵

### 11.1 纯模型 / 属性测试

- 任意成功非 exhausted segment 都降低 cursor；否则硬失败；
- 随机插入 0..N 个零 fact/零 visible segment，单个 goal 最终只会 satisfied/exhausted/failed/cancelled；
- 随机重复 startReached/atTop、rerender、callback identity 变化，不增加 operation 数；
- 随机 generation 切换、半页、乱序 ref，不移动已提交 cursor；
- cache hole 不被跳过；cache 边界不被当 ledger 起点；
- live feed 在 checkpoint 前断线时，rows 可显示但不得形成连续 cache coverage；
- 同一事实以 live→history、history→live、重复三种顺序进入，最终 projection 相同；
- cache/network 的 golden ledger fixture 生成等价 HistorySegment / projection；
- background 等待再久也不能跨级抢 foreground slot。

建议用 property-based generator 构造 request/progress/terminal/control 树，而不是继续只用 `human.note`。

### 11.2 浏览器场景

1. 无 cache 冷启动：focused tail 先显示，live 不丢，首屏短则填满；
2. cache 与 head 相同：cache 首屏可用，network 不做重复首屏；
3. cache 严重滞后：当前 network tail 先显示，再连续回填并在 coverage 交界切 cache；
4. 5000 行、77% provisional、至少 603 连续无可见起点：一次物理到顶最终出现更老可见项；
5. 当前 filter 下所有剩余历史都不可见：扫描到 exhausted，操作明确结束；
6. page 中途断线：半页不显示，重连无 gap/duplicate；
7. live checkpoint 前断线：本次 live 已显示，但 reload 后 cache 不跨未知 hole；
8. top fetch 中切频道：新频道先得到 foreground，旧页不污染当前 view；
9. top fetch 中快速切 scope/filter：旧 consumer cancel，新 view 正确继续；
10. 短列表同时 top/bottom：逐 revision 填到可滚或 exhausted；
11. 浏览旧历史时 live 到达：视口不跳，出现新动态提示，回底部后可见；
12. 10 万 ledger：DOM 仍受限，内存/IDB/reservoir 不超预算；
13. 移动端真实 touch：一次物理手势，不依赖 hover/callback 偶然性。

现有“5000 cache + exactly one `history.demand_taken`”断言应删除。一个物理 intent 可以合法消费任意多个 segment；应断言 operationId 唯一且最终 visible anchor 前进。

### 11.3 真实数据 gate

- 用当前频道脱敏后的结构 fixture 保留实际 parent/kind/type/status 分布；
- 回放最近 5000 行和卡住区间，验证单个 operation 跨过连续零可见段；
- 在真实 8832 运行包上记录 attach head、operationId、每段 scan range、source、cursor、projection firstSeq 和终态；
- 不接受“日志看起来动了”，只接受 UI anchor 前进或权威 exhausted。

## 12. 可观测性

日志围绕 operation 和 segment，而不是散落的 callback：

```text
history.intent_started
history.segment_requested
history.segment_committed
history.segment_consumed
history.projection_checked
history.intent_satisfied | exhausted | failed | cancelled
```

每条至少包含：`operationId, topEpoch, viewKey, channelId, generation, source, requestedBefore, scanLow, scanHigh, nextBefore, facts, firstBefore, firstAfter, reservoirSegments, terminalReason`。

监控必须能直接查询不变量异常：

- active intent 但无 inflight/segment/terminal；
- cursor 未下降；
- page_end 不匹配；
- cache 跨 hole；
- background 占满所有 slot；
- cancelled view 发生 publish。

日志用于证明和定位，不参与调度。

## 13. 被推翻的假设

1. “一次取 32 行通常会有可见项”——真实数据否定。
2. “reservoir 有 5000 行就等于页面有 5000 条可用历史”——单位错误。
3. “cache page 和 network page 都是 rows，所以同构”——一个 raw、一个 projected。
4. “再加一个顶部 callback 能补救”——callback edge 不是持久意图。
5. “把 boolean 改成 React reducer 就是状态机”——如果 continuation 仍由 effect cleanup 持有，所有权仍错。
6. “numeric priority 足够”——4 个 background 已 in-flight 时，最高分 foreground 仍无槽。
7. “滞后 cache 会通过 live 无界回放到 head”——审计现有 gateway 后确认不成立；attach metadata 已把 live cursor 推到 head。
8. “一个隐藏 terminal.session 的测试足以覆盖零可见批次”——真实数据是数百行 progress/control/child turn 的组合。

## 14. 实现证明与明确边界

本次完成的门禁：

- pure projector 与 UI/history completion 共用；20 个连续 zero-visible segment 模型测试；
- cache hole 原位回 network、stale cache claim、lag cache network-first seam；
- cold cache、5000-row warm cache、640 连续 cached progress、10 万 raw ledger、移动端与 live-during-history 浏览器场景；
- page generation/ref/channel/row-count/scan-range 原子校验；
- attach `H+1` seam、live checkpoint、foreground/background admission、cancel receipt 屏障；
- v8 FIFO、quota recovery、zero-fact coverage、boot change 与 pending write 隔离；
- React StrictMode setup/cleanup/setup 生命周期回归；
- Go gateway/subjectgate、race、e2e 与生产 build（以最终提交前门禁结果为准）。

明确不混入本次正确性合同的性能增强只有 Phase D focus-first attach。另一个可选方向是完整 EntryBodyStore/LRU；当前没有用删除 fact 假装它已经实现。现有硬边界是：后台 reservoir 5000 row/16MiB per channel、64MiB global，IDB 5000 row per channel/256MiB global，history network 4 in-flight/background≤3，DOM 虚拟化；FoldStore 只随用户实际展开的语义历史和本次 live session 增长。

## 15. 方案自审记录

| 攻击场景 | 初稿风险 | 审后合同 |
|---|---|---|
| 32 行全是 progress/control | row release 后 operation 可能失联 | operation 自己循环，只有 visible anchor/权威终态可结束 |
| React 因 live feed rerender | effect cleanup 可清唯一 timer | continuation 在独立 operation；React 只回报 layout revision |
| cache 有 5000 raw 行 | raw row 数被当成可见完成 | fact 与 coverage 分开；同一 frontier + pure projector 判定完成 |
| live seq 100 后直接到 105 | 客户端可能误认 101..104 已覆盖 | 只有 server `live_checkpoint.scanned_seq` 能增加连续 coverage |
| open turn 后来 terminal | 为压缩直接删除 provisional 会丢审计并破坏水位 | 保留已收到事实；服务端历史投影负责远端压缩，客户端不破坏性改写 |
| cache coverage 中间有 hole | readBefore 可能跨 hole 改 cursor | source read 截止当前 interval；hole 从同一 before 转 network |
| cache 自己用完 | 被误判全账本结束 | cache-miss 与 authoritative ledgerExhausted 分开 |
| 4 个 background 已运行 | foreground 即使最高分也没槽 | client/server 都限制 background≤3，保留 foreground slot |
| background 等得太久 | fairness 晋级后抢用户请求 | fairness 只能同级轮转，绝不跨 priority band |
| focused initial 与 hydrate 共用 backfill | 首屏可能排在无关 hydrate 后 | purpose/priority 分离，focused initial 走 foreground lane |
| 快速切频道 | 旧 foreground read 占保留槽 | consumer cancel + `history_cancel(ref)` 释放 server read |
| 初始 query 用 before=0 | query 时 head 移动并与 live seam 含糊 | 绑定 attach head，严格 `before=H+1` |
| 短列表 top/bottom 同时成立 | bottom 清 demand 或 timer 连发 | topEpoch + visibleRevision layout acknowledgement |
| 筛选后全不可见 | 固定批数后假成功或永远 pending | cursor 严格递减直到匹配 visible 或 authoritative exhausted |
| page 中途断线 | 半页 rows 已进入 fold/cache | rows staged，只有匹配 page_end 才原子提交 |
| 10 万 ledger | 后台预取若直接 fold，DOM 小但 JS heap 仍会膨胀 | hydrate 只进有界 reservoir/IDB；用户消费后才 fold，DOM 继续虚拟化 |
| revoke 后读旧 cache | 历史事实可能重新显露 | access gate cancel + cache clear/隔离是数据不变量 |

自审后的结论：实现必须同时满足 Phase A+B+C；当前代码按这三个平面一起落地并由上述反例门禁约束。focus-first attach 是进一步消除无关频道 metadata 首屏阻塞的 Phase D，不参与本次历史正确性。
