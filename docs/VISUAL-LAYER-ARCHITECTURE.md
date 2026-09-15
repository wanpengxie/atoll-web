# Atoll Web 视觉层架构

> 状态：已实现，2026-09-15。  
> 范围：在现有频道副本、历史供水与智能调度机制之上，重新定义 IM 视觉层。本文不改变账本、OBS、WebSocket、IndexedDB 或 History Scheduler 的真相归属。

## 0. 当前落地状态

本文定义的边界已经完整落地：

- `HistoryDemandPort` 成为 Visual → Scheduler 的有限端口；Timeline 只声明意图、紧迫度、语义锚点和已读 frontier。
- `ConversationViewport` 集中持有 following/browsing/loading-before/restoring 状态、顶部需求、尾随、未见尾部和全部滚动命令。
- `ViewportLayoutPort` 将折叠等高度变化收敛为布局事务；正文组件不再查找滚动父节点或写 `scrollTop`。
- `VirtualTimelineAdapter` 是唯一知道 Virtuoso API 的模块。
- `ViewSessionStore` 按频道保存阅读范围、成员过滤和折叠覆盖；频道切换仍重挂 DOM，但不再丢失这些阅读选择。
- `PresentationRow` 显式提供稳定身份、seq 范围、revision、layout class 与 settled contract，不依赖数组位置。
- 语义 anchor 随每频道 View Session 保存；频道或 Surface 重挂后按 `rowID + offset` 恢复，缺数据时通过 blocking demand 补齐。
- Shell 是响应式页面拓扑的唯一 owner，断点变化不重挂 Conversation Surface。
- `VirtualTimelineAdapter` 不维护第二份行高缓存；物理高度只由 Virtuoso 的 keyed ResizeObserver 决定，且不额外制造 DOM 包装。
- 历史 prepend 和显式折叠都由 Viewport Controller 执行语义锚点事务；旧的 transform bridge 与 competing scroll owner 已删除。

## 1. 目标

Atoll Web 首先是一个以频道 Conversation 为中心的 IM。视觉层的第一职责不是展示尽可能多的能力，而是维持一个可信的阅读空间：

> 用户不主动改变位置，正在看的内容就不能因为数据到达、历史加载、异步渲染或面板开合而移动。

视觉层同时满足五条不变量：

1. 用户不主动导航，当前阅读锚点不移动。
2. 已稳定的历史内容不自动改变布局。
3. 新事实只影响时间线尾部和未读状态，不打断历史阅读。
4. Composer 的输入延迟不受 feed、投影和其他 Surface 更新影响。
5. 桌面端与移动端共享语义状态，但不共享页面拓扑。

## 2. 与数据层的边界

昨天完成的数据获取链已经形成清晰分工：

```text
Ledger / live feed / IndexedDB
              │
              ▼
       ChannelReplica
       频道事实的本地副本
              │
              ▼
     HistoryScheduler
     P0/P1/P2、前台需求、后台预热、流量和内存预算
              │
              ▼
       projectTimeline
       将已到达事实投影为可展示语义
```

History Scheduler 已经拥有：

- 当前焦点频道和跨频道优先级；
- 本地缓存与远端读取的选择；
- 前台请求、后台预热和公平调度；
- reservoir、并发、行数与字节预算；
- generation、取消、重试和 projection barrier；
- `hasOlder / loading / buffered / exhausted` 等供水状态。

视觉层不得重新实现上述判断。当前实现把频道焦点作为 App → Scheduler 的装配信号；Conversation 只通过一个按频道构造的有限 Demand Contract 声明读取意图：

```text
port.status
port.open({range, intent, urgency, anchorSeq, viewSpec, signal})
port.markRead(seq)
```

其中：

- `intent` 表达用户在做什么，例如 `initial-view / scroll-history / restore-position / jump-to-source / search-context`；
- `urgency` 表达产品语义，例如 `blocking / interactive / anticipatory`；
- `signal` 把用户离开、视图切换等取消传播给这次需求；
- demand 由返回 Promise 的 satisfied/exhausted/failed/cancelled 终态闭合，不暴露调度器内部 operation id。

视觉层拥有这些事实，因为只有它知道用户正在看哪里、是否在等待结果以及什么操作会阻塞交互。Scheduler 消费这些事实，将它们与 live activity、unread、MRU、缓存覆盖、网络成本和全局预算合并，得出真正的执行优先级。

因此应区分两类“优先级”：

| 优先级 | 所有者 | 含义 |
|---|---|---|
| 意图优先级 | Visual | 当前需求对用户有多紧迫，例如屏幕空白、主动上滚、后台预热 |
| 执行优先级 | Scheduler | 在所有频道和请求之间下一批实际执行谁，即现有 P0/P1/P2、foreground/background 和公平轮转 |

视觉层不能直接操作 Scheduler 队列，也不能自行把请求实现成 P0/P1/P2。Scheduler 不能凭 DOM 几何猜用户意图，更不能覆盖视觉层声明的前台阻塞关系。

视觉层不能传递像素、`scrollTop`、估算行高或“再取一页”这类实现细节。Scheduler 也不能决定是否滚动、恢复哪个 DOM 节点或是否跟随底部。

两层之间的合同是：

| 方向 | 内容 | 不包含 |
|---|---|---|
| Visual → Data | 焦点、可见性、意图、紧迫度、语义范围/锚点、需求生命周期、已读 frontier | 像素、DOM、虚拟列表索引、页大小、数据源、并发数 |
| Data → Visual | 投影版本、已释放的行、供水状态、操作终态 | 滚动命令、动画、布局补偿 |

这是一个反馈闭环，不是视觉层单向调用数据层：

```text
用户动作 / Surface 状态
        │ 语义意图与紧迫度
        ▼
HistoryScheduler
        │ 全局排队、数据源选择、预算与供水结果
        ▼
ChannelReplica / PresentationModel
        │ 新的展示材料与操作终态
        ▼
ViewSession / ViewportController
        │ 是否满足意图、是否产生下一段需求
        └───────────────────────────────▶ Scheduler
```

数据到达只表示“新的展示材料可用”，不表示“屏幕应该移动”。是否继续提出需求也由尚未满足的用户意图决定，而不是组件看到 `hasOlder` 后自行循环拉取。

## 3. 五层架构

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Data Plane                                               │
│ ChannelReplica + HistoryScheduler                           │
│ 事实副本、按需供水、跨频道智能调度                          │
└───────────────────────────┬─────────────────────────────────┘
                            │ projection snapshot / demand
┌───────────────────────────▼─────────────────────────────────┐
│ 2. Presentation Model                                      │
│ ConversationProjector                                      │
│ 账本事实 → 稳定、有序、有身份的展示对象                     │
└───────────────────────────┬─────────────────────────────────┘
                            │ PresentationRow[]
┌───────────────────────────▼─────────────────────────────────┐
│ 3. View Session                                            │
│ 每频道的阅读意图、锚点、未见尾部、当前 Surface/Context      │
└───────────────┬──────────────────────────┬──────────────────┘
                │                          │
┌───────────────▼──────────────┐ ┌────────▼──────────────────┐
│ 4. Surface Shell             │ │ Viewport Controller       │
│ Desktop / Mobile 页面拓扑    │ │ 时间线唯一滚动语义所有者  │
└───────────────┬──────────────┘ └────────┬──────────────────┘
                │                          │ render contract
┌───────────────▼──────────────────────────▼──────────────────┐
│ 5. Render Adapters                                         │
│ VirtualTimeline / Markdown / Preview / Editor / Terminal    │
│ DOM、测量、绘制；不持有业务和阅读真相                       │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Data Plane

沿用现有实现。它回答：

- 当前有哪些事实；
- 哪个频道应优先供水；
- 历史从哪里取、取多少；
- 一个前台需求何时满足、耗尽、取消或失败。

它不属于视觉层，视觉重构不得把 reservoir、cursor 或调度优先级搬进 React 组件。

### 3.2 Presentation Model

`ConversationProjector` 将频道副本投影成稳定的阅读对象，而不是让 React 直接消费账本行：

```ts
type PresentationRow = {
  id: string;              // 跨增量投影稳定
  seqLow: number;
  seqHigh: number;
  kind: 'turn' | 'notice' | 'progress' | 'attachment' | 'boundary';
  actorID?: string;
  contentRevision: number; // 内容确实变化时才增加
  layoutClass: 'compact' | 'normal' | 'rich' | 'reserved';
  settled: boolean;        // 已完成、原则上不再自动变高
  body: unknown;
};
```

规则：

- 一个 Agent turn 是一个展示对象；内部 request、progress、tool、response 是其结构，不是无条件拆成多条消息。
- 日期、未读线和系统提示是显式 boundary/notice，不由 DOM 邻接关系临时推导。
- row identity 不因过滤、prepend 或异步更新改变。
- 折叠默认值在首次生成展示对象时确定；不能挂载后测量正文再改变决定。
- 已 settled 的 row 不因后台事实或重新挂载改变尺寸类别。
- 该层不引用 React、DOM、Virtuoso 或 viewport。

### 3.3 View Session

`ViewSessionStore` 保存非权威、可丢弃的本地交互状态。每个频道一份：

```ts
type ChannelViewSession = {
  primarySurface: 'conversation' | 'tasks';
  context: null | { kind: string; key: string; sourceRowID?: string };
  conversation: {
    mode: 'following' | 'browsing' | 'loading-before' | 'restoring';
    anchor: null | { rowID: string; offset: number; seq: number };
    unseenTail: number;
    scope: 'mine' | 'all';
    actorFilter: string[];
    foldOverrides: Record<string, boolean>;
  };
};
```

它是阅读会话，不是数据真相：

- 可以存内存或浏览器本地存储；丢失后可安全回到底部。
- 不写账本，不影响 History Scheduler 的权威 cursor。
- 切频道、打开预览、从移动端返回时用于恢复人的位置。
- Composer 草稿由 Composer 自己持有，只通过稳定端口做频道切换快照，不进入全局逐字状态。

### 3.4 Surface Shell

Surface 是占据主要视觉区域、拥有自身滚动容器和生命周期的产品平面：

- Conversation Surface
- Tasks Surface
- Context Surface：thread、turn、文件预览、成员、频道信息
- Files Surface
- Terminal Surface
- Navigation Surface

桌面和移动端复用同一 `ViewSession`，由同一个 `SurfaceShell` 输出明确的 `desktop / compact / mobile` 页面拓扑：

```text
DesktopShell                      MobileShell
┌──────┬───────────┬────────┐     ┌─────────────────┐
│ Nav  │ Primary   │Context │     │ 当前单一 Surface│
│      │ Surface   │Surface │     │ Nav/Chat/Preview│
└──────┴───────────┴────────┘     └─────────────────┘
```

桌面端 Context 可以覆盖或并列，但不得改变 Conversation 的内部滚动语义。移动端 Context/Preview 是全屏导航目的地，不是把桌面侧栏压到窄屏或堆到消息下面。

只有 Shell 可以根据 viewport 断点选择页面拓扑。业务 Surface 可以用 container/media query 调整自己内部的密度和排版，但不得据此重组整个页面。

### 3.5 Render Adapters

渲染适配器只负责把稳定模型变成 DOM：

- `VirtualTimelineAdapter`：可见范围、DOM 复用、行高测量；
- `MessageBodyRenderer`：Markdown、代码、Mermaid、附件；
- `PreviewRenderer`：文件和媒体预览；
- `ComposerEditorAdapter`：Tiptap/ProseMirror；
- `TerminalAdapter`：xterm。

第三方库必须被适配器隔离。产品组件不能依赖 Virtuoso 的 `firstItemIndex`、内部 scroll 修正时序或 DOM 结构。

## 4. Viewport Controller

`ConversationViewportController` 是时间线唯一的滚动语义所有者。任何子组件都不得直接写 `scrollTop`。

### 4.1 状态机

```text
首次打开且无恢复锚点
          │
          ▼
      following ──用户向上滚──▶ browsing
          ▲                          │
          │                          │ 接近历史水位
   回到底部/发送消息                 ▼
          │                   loading-before
          │                          │ 投影提交
          │                          ▼
          └──────────────────── restoring
                                     │ 锚点恢复完成
                                     ▼
                                  browsing
```

状态转换由用户意图和数据操作终态驱动，不由某一帧的 `atBottom` 几何值猜测。

### 4.2 唯一允许的滚动动作

Controller 可以命令 Adapter：

```text
followTail()
captureAnchor(rowID, offset)
restoreAnchor(rowID, offset)
scrollToRow(rowID, align)
```

禁止：

- `FoldableBody`、图片、Markdown 或消息卡直接写 `scrollTop`；
- CSS scroll anchoring 和虚拟列表同时充当所有者；
- 历史加载代码使用临时 DOM transform 修正而 Controller 不知情；
- 根据“页面此刻离底部 2px”覆盖刚刚发生的用户向上滚动。

Adapter 可以执行像素操作，但必须来自 Controller 的一个明确事务。

### 4.3 历史供水事务

```text
1. 上方 prefetch sentinel 进入阈值
2. Controller 在当前可见 row 上捕获语义锚点
3. Controller 调用 ensureBefore(anchor.seq, viewSpec)
4. Scheduler 决定立即释放 reservoir、本地读取或远端读取
5. PresentationModel 发布新 revision
6. Adapter prepend 新 rows 并完成测量
7. Controller 恢复同一个 rowID + offset
8. 操作闭合，回到 browsing
```

视觉层只发一个需求。Scheduler 内部扫描了多少页、是否提升后台批次、是否来自 IndexedDB，对视觉层透明。

### 4.4 Live 到达事务

在 `following`：

- Presentation 尾部更新；
- Adapter 在同一绘制批次跟随尾部；
- read frontier 在真正展示后推进。

在 `browsing/loading-before/restoring`：

- Presentation 尾部可以更新；
- viewport 不移动；
- `unseenTail` 增加；
- 用户点击“回到最新”后才转入 following。

这与 Scheduler 的 `observeLive` 不冲突：live 活跃度可以影响其他频道的预热优先级，但不能替用户作出滚动决定。

## 5. 内容高度合同

虚拟 IM 最难的不是行很多，而是行高会变。统一合同如下：

1. 文本和确定尺寸的内容首帧即稳定。
2. 图片、视频、iframe、Mermaid 在加载前提供宽高比或预算占位。
3. 流式内容只能使当前未 settled 的尾部 row 生长。
4. 历史 row settled 后，不因自动折叠、延迟语法高亮或组件重挂改变布局策略。
5. 用户主动展开/收起产生 `layoutChange(rowID, cause=user)`；Controller 根据当前 mode 保护锚点。
6. 非用户异步变化产生 `layoutChange(rowID, cause=content)`；浏览历史时保护锚点，跟随尾部时保护底部。

行高只由 `VirtualTimelineAdapter` 内的 Virtuoso 根据稳定 `row.id` 和真实 DOM resize 测量。上层不缓存像素高度，更不能把历史测量反写成 `min-height` 或 `contain-intrinsic-size`；折叠、预览等本地呈现变化必须允许同一行收缩。数组下标不能作为行身份。

## 6. 空间与响应式合同

### 6.1 每个 Surface 只有一个 overflow owner

Shell 提供可用矩形；Surface 内部声明唯一滚动区。祖先和子孙不能同时承担同一方向滚动。

```text
App viewport        overflow: hidden
Workspace           min-width/height: 0
Conversation        layout container
Timeline viewport   overflow-y: auto   ← 唯一纵向 owner
Composer             Timeline 同级，不覆盖其内容
```

### 6.2 Header

- Header 高度由 Shell token 固定，而不是由内部按钮撑开。
- 桌面与移动使用不同 Header composition。
- 移动端低频动作进入菜单，但点击面仍满足触控尺寸。
- Header 内容溢出只能截断或进入菜单，不能增加整行高度。

### 6.3 Preview

- 桌面侧栏按容器宽度适配，主内容不读取其内部最小宽度。
- 移动端 Preview 占据完整可用 viewport，内部内容 `max-inline-size: 100%`。
- 表格、代码、原尺寸图片在 Preview 自己内部滚动或缩放，不能撑宽 App。
- 关闭 Preview 恢复来源 Surface、row anchor 和焦点。

### 6.4 动画

允许自动动画：opacity、transform，以及明确导航的 Surface 进入/退出。

禁止自动动画：Timeline 高度、Header 高度、Composer 占位、消息行尺寸、prepend 补偿。`prefers-reduced-motion` 必须得到等价静态行为。

## 7. React 组件归属

落地结构：

```text
App
├─ DataRuntime                         # wire、replica、scheduler
├─ PresentationRuntime                 # projector、view sessions
└─ AppFrame
   ├─ SurfaceShell                    # desktop / compact / mobile topology
   ├─ NavigationSurface
   ├─ ConversationSurface
   │  ├─ ConversationHeader
   │  ├─ ConversationViewport
   │  │  └─ VirtualTimelineAdapter
   │  │     └─ PresentationRowView
   │  └─ ComposerSurface
   ├─ TasksSurface
   └─ ContextSurface
```

依赖方向恒为：

```text
Data → Presentation → Session/Controller → Surface → Adapter/Primitive
```

反向只能走声明过的事件端口，不能 import 上层状态。

`App` 只装配端口；`AppShell` 只组织 Surface；`Timeline` 不再同时承担 projector、history controller、virtualizer 和 message renderer。

## 8. 与智能调度的具体集成

视觉架构利用而不复制现有调度：

| 用户行为 | Visual 发出的事实 | Scheduler 行为 |
|---|---|---|
| 打开频道 | `focus(channel)` | 频道成为 P0；本地 tail 解码与远端供水按现有规则运行 |
| 离开频道 | 新频道成为 focus；旧 ViewSession 保存锚点 | 旧频道按 MRU/live/unread 降为 P1/P2，不由组件取消全部数据 |
| 接近顶部 | `ensureBefore(anchorSeq, viewSpec)` | foreground user-demand 抢占下一空闲执行位 |
| 快速连续上滚 | 同一 operation 延续需求 | reservoir 优先释放，需要时继续小批次读取 |
| 页面打开文件预览 | Conversation 不再可见，但 ViewSession 保持 | 当前频道焦点保持不变；Context 是否覆盖 DOM 不参与调度判断 |
| live 到达非当前频道 | 无滚动动作 | Scheduler 按 liveOrder/unread 参与后台预热 |
| 返回频道 | 恢复语义锚点；若数据缺口则 `ensureBefore` | 本地缓存和远端成为可互换 provider |

`HistoryDemandPort` 已把 `historyFor/loadHistory/markRead` 整理为稳定接口；频道焦点仍由 App 装配给现有 Scheduler，不另建调度器。

## 9. 性能预算

架构门禁：

- 打字时 `ConversationViewport` 和已稳定 row 不重渲。
- 一个 live frame 只更新受影响的尾部 row，不重投影完整历史窗口。
- 100k 历史事实下，DOM 业务行保持有界。
- 连续滚动主线程长任务不得超过 50ms；目标帧预算 16.7ms。
- 打开/关闭 Context 不重挂 ConversationViewport。
- 后台频道供水完成不发布无意义的全 App render。
- 所有 map → array 输出在 Presentation 层显式排序，DOM 顺序不依赖 Map/对象枚举偶然性。

## 10. 测试模型

测试不再只验证“某次没有抖”，而验证边界不变量。

### 10.1 纯状态测试

- following/browsing/loading/restoring 的全部转换；
- live 到达时只有 following 可以移动；
- 取消、耗尽、失败后 operation 必须闭合；
- 频道切换和 Context 返回恢复正确 ViewSession；
- PresentationRow identity 在 prepend、filter 和增量更新后稳定。

### 10.2 Data–Visual 合同测试

使用 fake `HistoryDemandPort`：

- 顶部一次交互只建立一个需求；
- Scheduler 返回空投影页时继续由既有 operation 判断，不由 DOM 重试风暴；
- 数据到达但投影未满足时不提前结束 restoring；
- 后台预热完成不移动任何 viewport。

### 10.3 浏览器几何测试

- 混合高度历史连续向上滚，锚点屏幕坐标保持在容差内；
- live 在 browsing 时尾部增长但当前可见 row 不动；
- 图片/Mermaid/代码加载前后遵守高度合同；
- 320、600、850、1280 宽度下 App 不横向溢出；
- 移动端 Preview 占满可用宽度，返回恢复来源 row；
- 打开 Context、文件或终端不重挂 ConversationViewport；
- Composer 连续输入期间 Timeline render 次数和长任务受预算约束。

## 11. 施工结果

本次重构没有改写数据层；以下工作作为同一次完整变更落地。

### 11.1 冻结合同

- 将本文五条体验不变量变成测试。
- 暂停向 Timeline 增加新的 `scrollTop`、DOM transform 和媒体查询补丁。
- 为现有 history scheduler 建立 `HistoryDemandPort` 适配层。

### 11.2 建立 View Session 与 Viewport Controller

- 从 Timeline 移出 follow-tail、unseen、history operation、anchor 状态。
- 所有滚动写入集中到一个 adapter command port。
- FoldableBody 删除滚动所有权，只报告显式 layout change。

### 11.3 稳定 Presentation Model

- 将 timeline projection 输出固化为 `PresentationRow[]`。
- 日期、连续关系、折叠策略、turn 结构不再在 render loop 中推导。
- 增量 revision 保证 live 只更新尾部对象。

### 11.4 隔离虚拟化

- 用 `VirtualTimelineAdapter` 包住 Virtuoso。
- 物理尺寸只使用 Virtuoso 自身按 row identity 管理的 keyed ResizeObserver，不建立平行行高缓存。
- 若 Virtuoso 无法满足 anchor transaction，再只替换 adapter，不影响上层。

### 11.5 Surface 与 Shell

- 建立统一 `SurfaceShell`，输出 desktop/compact/mobile 三种明确拓扑；共享 ViewSession，不共享页面排列。
- Preview、Files、Tasks、Terminal 归为明确 Surface。
- 页面级响应式规则收回 Shell；组件内部只保留自身密度和排版规则。

### 11.6 删除兼容补丁

- 删除 Timeline 中的临时 transform、重复几何判定和 competing anchor。
- 删除子组件直接 `scrollTop` 写入。
- 删除依靠 CSS 加载顺序和宽屏 DOM 重排得到的移动端覆盖规则。

## 12. 验收定义

视觉层重构完成不是“截图更好看”，而是同时满足：

1. 数据层仍是事实、供水和智能调度的唯一所有者。
2. Presentation Model 是账本事实到视觉对象的唯一解释层。
3. ViewSession 是每频道阅读意图的唯一所有者。
4. Viewport Controller 是时间线滚动语义的唯一所有者。
5. Render Adapter 是 DOM 几何的唯一执行者。
6. Shell 是桌面/移动空间拓扑的唯一所有者。
7. 任一层都不能通过读取或改写下一层内部状态来补偿自己的缺口。

一句话总结：

> 数据层智能地决定“什么内容何时可用”；视觉层确定地决定“人在看什么、屏幕是否应该动”。二者通过语义需求连接，不共享调度或几何状态。
