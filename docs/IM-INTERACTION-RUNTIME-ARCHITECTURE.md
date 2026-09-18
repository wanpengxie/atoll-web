# Atoll Web IM 交互运行层总设计

> 状态：总设计与施工总账，2026-09-16。  
> 本文固化 2026-09-15 对当前系统的完整诊断。视觉专项施工以
> [VISUAL-INTERACTION-COMPLETION-SPEC.md](./VISUAL-INTERACTION-COMPLETION-SPEC.md)
> 为子规格；同步数据专项以
> [SYNC-DATA-ARCHITECTURE.md](./SYNC-DATA-ARCHITECTURE.md)
> 为子规格。总账必须反映真实完成边界。

## 0. 结论

数据层重构方向是对的，但此前视觉架构文档把完成度写高了。现在已经有成熟 IM 所需的“账本副本 + 历史调度”基础，却还缺一个真正闭合的交互运行层。

核心问题可以概括为：

> 后端事实、数据可用性、用户屏幕位置，这三种状态仍在互相驱动；成熟 IM 必须让它们单向协作、彼此不越权。

## 1. 当前真实模型

后端提供的模型已经比较清晰：

```text
频道账本
  ├─ live feed：实时新增
  ├─ history_before：按 seq 向前读取
  ├─ checkpoint：证明扫描覆盖范围
  ├─ page_end：一次历史批次终态
  └─ submit receipt：确认消息被接受
```

协议以 `channel + seq + generation` 为边界，历史有明确 cursor、批次终态和取消能力。服务端也已经把 live、前台历史、后台 backfill 分成三条逻辑 lane，并且在每个 WebSocket 帧边界优先发送 live。

前端目前是：

```text
WebSocket
   ↓
ChannelReplica
   ↓
HistoryScheduler
   ↓
ConversationProjector
   ↓
ViewSession
   ↓
ConversationViewport
   ↓
Virtuoso / DOM
```

这个分层本身没有问题。真正的问题在层与层之间的契约没有兑现。

## 2. 按用户场景看问题

| 用户行为 | 重构前实际行为 | 成熟 IM 应有行为 |
|---|---|---|
| 打开页面/重连 | WebSocket 已打开，但先等 IndexedDB；attach 后又拦住 downstream，直到历史状态安装完成 | 连接、缓存恢复、历史补齐三路并行；live 最先可用 |
| 连续向上滚 | 到固定阈值才提需求；prepend、Virtuoso 补偿、手动 `scrollTop` 修正同时发生 | 根据阅读速度和预计延迟提前维持历史 runway；一次原子 prepend 事务 |
| 到达最老消息 | 多个 top 几何信号共同触发 operation；顶部位置变化还可能取消当前需求 | 到达 origin 后进入稳定 exhausted 状态，安静停住 |
| 浏览旧消息时收到 live | 原则上不移动，但 following 判断仍由物理距离和多个回调共同修改 | 只更新未读尾部，除非阅读状态机明确处于 following |
| 展开/收起消息 | 收起进入布局事务，展开没有；过程详情和嵌套 thread 也绕过合同 | 所有高度变化服从同一个 resize/anchor 合同 |
| 图片、Mermaid、字体晚加载 | Virtuoso 自己重新测高，阅读锚点没有统一保护 | 可知尺寸提前保留；未知尺寸由唯一虚拟布局系统重测，不能再叠加第二个像素修正器 |
| 弱网发送 | 断线时 Composer 被禁用；outbox 虽存在，用户实际上进不去 | 本地事务接受、时间线立即出现 local echo、后台发送 |
| 切频道/切筛选 | 频道整体 remount；不同筛选对虚拟列表 identity 的处理不一致 | 每个频道持有阅读会话；筛选和导航是明确的 rebase 事务 |

## 3. 五个结构问题

### 3.1 Sync Session：连接状态错误地依赖缓存和历史

诊断时，socket 打开后 `beforeAttach` 会等待本地副本初始化；收到 attach receipt 后，网络层又打开 `attachBarrier`，把后续 feed 暂存在内存，直到 `onAttach` 完成。

这会产生：

```text
socket 可能已经连上
但页面仍显示“等待连接”
live 也没有进入 UI
输入框仍不可发送
```

成熟 IM 应拆成独立状态：

```text
transportConnected
sessionAttached
localHydrated
liveCaughtUp
historyReady
```

缓存慢不能阻止 live，历史调度更不能成为“连接成功”的一部分。本缺口已在同步数据专项中闭合：Wire 不再等待或缓存 IndexedDB 工作，attach Meta 同步安装，Replica 持久写通过独立 epoch fence 排序。

### 3.2 Atomic Viewport：名义上唯一，实际上存在多套反馈回路

重构前同时存在 Virtuoso 的 `firstItemIndex` prepend 补偿、锚点恢复与展开收起时循环修改 `scrollTop`、following 的强制回底，以及同步、microtask、rAF 多次钉底。

“所有 `scrollTop` 都集中到一个文件”不等于只有一个滚动模型；同一个 Controller 内仍可能有多套互相观察、互相修正的几何控制器。

完成态必须满足：

```text
一次语义变化
→ 一个布局机制
→ 一次物理结果
→ 闭合
```

旧方案将 Virtuoso 的 `firstItemIndex` 加上 Adapter 的 paint 前修正当成原子事务，这个判断已撤回：库内仍有独立的跨帧补偿。消息区现改用 Adapter 自有的测量表与有界窗口，prepend/resize/append 共用一次实测布局提交；上层只提交语义意图，不做第二轮像素恢复。执行合同与验证边界见 [READING-VIEWPORT-REFACTOR.md](./READING-VIEWPORT-REFACTOR.md)。

稳定 identity 还不够，旧 row 的几何也必须对 prepend 单调。分页窗口头最初不知道自己的前驱；更早历史到达后，投影不得据此从旧 row 删除日期分界、头像或作者头。连续分组一经展示即冻结，日期分界由较早一侧的新增 row 持有，保证 prepend 只增加前缀、不重塑已经在屏幕上的后缀。

request thread 同样服从单调性：一个子 request 已在父级未知时作为根展示，父 request 后续随历史到达也不得把它搬走。完整冷回放在首次投影前已经同时知道父子时仍可建立 thread；增量分页不允许重写既有视觉所有权。

冷挂载也不能把估算几何当成可见事实。消息 row 高度异构时，adapter 必须先用真实 row probe，再显示初始位置；之后的 ResizeObserver 结果应在当前帧交给虚拟布局，不能先显示旧估算、下一帧再纠正。频道第一次滚动与 live row 增高遵守同一条合同。

数据已经在 replica 中不等于 DOM 已经可供合成。adapter 还要维持独立的 materialization runway：根据实际 viewport 和滚动速度在上滑方向预先挂载足够的稳定 row，并按块移动窗口。每个 row 以 semantic identity + content revision 订阅更新；live 只能重绘变化的 row，不能让整个可见窗口因父组件 publish 重新构造。否则位置虽稳定，浏览器仍会在回收与富内容挂载之间露出一个空帧。

频道返回时可以复用 renderer 的已测 ranges，但它只是可丢弃的加速状态。只有 presentation geometry key 完全一致才恢复；任何 row、revision、layout class 或折叠状态变化都回退到语义 anchor，防止旧像素成为第二真相。

### 3.3 Content Height：高度变化合同覆盖不完整

重构前只有少数折叠路径报告布局事务；过程详情、nested thread、turn detail、Markdown 图片、Mermaid、Composer 以及 Timeline 底部占位动画均绕过合同。

完成态不是让每个正文组件分别实现 anchor transaction，而是：

- 正文只改变自身 DOM；
- 稳定源文本决定默认折叠，不在挂载后测量再改策略；
- 所有真实尺寸统一由虚拟列表重测；
- 不另存行高、不写祖先 CSS 高度变量、不做尺寸动画；
- 用户展开/收起只提交 Presentation choice，保持当前 reading mode；following 继续稳定
  tail，browsing 由列表原生测量同一 row。只有真实用户位移或 focused edit 取得 browsing，
  且任何模式都不执行自定义反向修正。
- 远程图片和 Mermaid 首帧即获得稳定 frame，异步解码/绘图只替换 frame 内部内容。
- Composer 与等待队列保持现有产品形态；消息区重构不得顺带改变它们的视觉、默认状态和操作入口。

### 3.4 Declarative History Demand：Visual → Scheduler 仍是命令式操作

当前 `HistoryDemandPort.open()` 仍然主要包装 UI 的一次命令：

```text
UI 到达顶部
→ begin operation
→ next segment
→ 投影
→ 看有没有更老可见消息
→ 没有就继续 next segment
```

真正的声明式需求应近似：

```text
setDemand({
  channel,
  beforeAnchor,
  intent,
  urgency,
  deadline,
  requiredVisibleCoverage
})
```

Visual 只维护“用户在未来多久内需要 anchor 前方有内容”；Scheduler 自己持续满足、更新和取消，不暴露“再取一段”的操作模型。实时预算和历史 runway 应动态竞争，不能按设备类型硬切掉整个策略。

### 3.5 Local-first Submission：Outbox 尚未成为本地事实

当前虽保存 pending submission，但它仍不是完整的 local-first 发送模型：连接断开会禁用 Composer，pending 的持久介质和失败语义不够强，pending 也没有在时间线原位置成为 local echo。

完成态应为：

```text
IndexedDB 原子写入 outbox
→ 时间线立即显示 local echo
→ 输入框立即清空
→ 后台传输
→ receipt 标为 accepted
→ feed 落账后替换为正式 seq
```

连接状态影响传输，不影响用户提交本地意图。

## 4. 四个稳定契约

1. **Sync Session**：连接、attach、live、缓存恢复、历史追赶分别有状态，缓存故障不能阻塞实时通信。
2. **Declarative History Demand**：视觉层提交语义范围、紧迫度和期限；Scheduler 决定来源、批次、预取量、并发和重试。
3. **Atomic Viewport Transaction**：每次 prepend、replace、resize 只有一个物理所有者，禁止多轮互相纠正。
4. **Local-first Submission**：输入和发送首先是本地事实，网络只负责同步。

## 5. 次级问题

- 投影仍可能在结构变化时扫描整条时间线，老频道仍有主线程压力。
- ViewSession 目前只是内存态，刷新和跨设备没有阅读连续性。
- 草稿需要独立的持久合同，不能只依赖当前页面生命周期。

## 6. 施工优先级与真实状态

状态只能使用：`完成`、`本轮施工中`、`明确后置`。禁止用“已有雏形”冒充完成。

| 优先级 | 工作 | 当前状态 | 完成判据 |
|---|---|---|---|
| P0-1 | 解除 attach/live 对 IndexedDB 和历史初始化的等待 | 完成 | Wire 不等待 IndexedDB；attach Meta 同步安装；缓存失败不挡 live；持久写受 `(principal, boot)` epoch fence 约束 |
| P0-2 | 收敛屏幕几何为单一原子事务 | 完成（实现与受控验证；真机待验收） | 无第二套 `scrollTop`/anchor 修正；prepend、resize 各只有一个物理 owner |
| P0-3 | 补齐消息内容高度合同 | 消息区完成 | 内容组件不控制祖先几何；异步富内容首帧定框；Composer/等待区另案 |
| P0-4 | 有 deadline 的持续 demand 与动态 runway | 明确后置 | Visual 维护需求，不调用“下一段”；Scheduler 自主闭合 |
| P0-5 | IndexedDB outbox 与时间线 local echo | 明确后置 | 离线可提交；本地回显；receipt/feed 对账 |
| P1-1 | 增量 Presentation Model | 本轮施工中（稳定模型已落位，完整计算增量化后置） | 稳定 row identity；live 不使稳定历史 row 重建；避免无条件全量重投影 |
| P1-2 | 筛选、切频道、Preview 返回的统一导航事务 | 完成（实现与受控验证；真机待验收） | rowID 导航；用户意图取消过期命令；rebase identity 明确；阅读会话可恢复 |
| P1-3 | 持久草稿、阅读位置和跨设备 read frontier | 明确后置 | 刷新/崩溃/跨设备连续性有独立协议 |

仍标为“明确后置”的项目尚未施工；P0-1 已由后续同步数据专项闭合，不再沿用视觉专项当时的范围判断。

## 7. 被推翻的判断

- live 慢不主要是服务端把整页历史挡在前面；服务端已经逐帧抢占。更大的问题是 attach barrier 和浏览器主线程的数据处理。
- “所有 `scrollTop` 都集中到一个文件”不等于只有一个滚动模型；仍须删除同一文件里的多套修正回路。
- 给每种高度变化都补一个自定义 anchor handler 不是完整合同。若虚拟布局系统已拥有真实尺寸，再加 handler 会制造第二真相。

## 8. 总验收

完整交互运行层只有在以下四项全部完成后才可称为完成：Sync Session、Declarative History Demand、Atomic Viewport 与 Content Height、Local-first Submission。

本轮只允许把视觉合同及其直接依赖标为完成；不得把“视觉专项完成”写成“总设计完成”。

2026-09-16：用户仍遇到滚动定位变化，撤回 P0-2 的旧完成判断。整体执行层重构与验收见 [READING-VIEWPORT-REFACTOR.md](./READING-VIEWPORT-REFACTOR.md)。
