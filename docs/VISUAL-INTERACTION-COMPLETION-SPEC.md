# Atoll Web 视觉与交互完成规格

> 状态：阅读视口执行层重构与受控验证完成，2026-09-16。用户仍反馈未完全解决，因此滚动问题保持未关闭。此前 Atomic Viewport 完成依据撤回。执行设计及验证边界见 [READING-VIEWPORT-REFACTOR.md](./READING-VIEWPORT-REFACTOR.md)。

## 1. 完成态

消息页面不是“数据数组加一个虚拟列表”，而是一段持续的阅读会话。完成态只有四个 owner：

1. `ConversationProjector` 把账本状态投影成稳定的 presentation rows。
2. `ViewSession` 保存用户当前在看什么：视图、筛选、折叠和语义阅读位置。
3. `ConversationViewport` 保存阅读意图：following、browsing、loading-before。
4. `VirtualTimelineAdapter` 独占有界渲染窗口、DOM 尺寸与物理滚动；消息时间线不再使用 Virtuoso。

消息列表、Composer 和等待队列属于同一块屏幕，但不是同一个布局系统。Shell 给消息 viewport 和 Composer 各自一条恒定边界：消息 viewport 到固定底线为止，Composer 固定悬浮在底部保留带中。Composer 和等待队列保持既有视觉、默认展开状态和操作入口；它们的内容与状态不参与消息 viewport 的动态尺寸计算。

数据到达只能改变 presentation rows，不能直接改变阅读位置。内容组件只能改变自身内容，不能寻找滚动父级、写 `scrollTop`、设置占位高度或启动锚点修正循环。

### 1.1 成熟 IM 的基准

本规格采用 Slack、Discord、Telegram 一类成熟消息产品共同的交互模型，而不是某个组件库的实现习惯：

- 对话是一段可恢复的阅读会话，不是一份每次更新都重新定位的列表。
- 尾随和历史阅读是两个互斥模式；新消息只在尾随时推动屏幕。
- 用户手势永远比程序导航优先，程序不得在滚动途中“纠正”用户。
- 历史 prepend、内容增高和输入框增高可以改变总高度，但不能改变用户正在看的语义邻域。
- 窄屏一次只做一件事；辅助内容以 Surface 切换进入，不把桌面布局压缩成不可用的分屏。
- 加载、错误、未读和发送状态有稳定落位，状态变化不挤动正文。

Atoll 与普通 IM 的区别是消息行会持续生长：agent progress、工具结果、折叠正文、图片和 Mermaid 都会改变旧 row 的高度。因此这里比普通文本聊天更严格——所有高度变化必须收敛到同一个虚拟布局系统。

## 2. 不变量

### V1 单一几何执行者

只有 `VirtualTimelineAdapter` 可以调用虚拟列表滚动 API。产品组件和 viewport 状态机不读写 `scrollTop`。原生滚动事件只能被解释为用户意图，不能触发反向物理纠正。

### V2 一次变化只有一个原子事务

- prepend、append、resize 共享 Adapter 的一次布局提交：提交前读取当前阅读锚点，准备并测量物化窗口，更新占位后只提交一次位置。历史请求不保存或恢复屏幕位置。
- 已经展示的 row 不得因随后补齐了它的前驱而改形：身份头一经展示即保持稳定；日期分界归属于新 prepend 的较早 row，而不是回头删改旧窗口头。
- 已经作为根展示的 request 不得在父 request 随历史到达后搬进父 thread；分页只允许增加前缀，不允许 remove + reparent 既有 row。
- 回到最新只执行一次显式尾部命令；新输入使未执行命令失效。
- 恢复阅读位置只接受 `rowID + offset`，尺寸缓存不包含可重放的 scrollTop。
- 展开、收起、代码和字体变化只由 Adapter 的 ResizeObserver 统一重测。远程图片与 Mermaid 在首帧获得稳定 frame，异步完成只替换 frame 内部像素，不改变 row 几何。
- 未物化区域允许估计滚动条长度；显示窗口在绘制前按真实 DOM 测量。估计不能作为已显示内容的最终几何。测量表变化、上下占位与阅读锚点必须一并提交。
- 数据 runway 与 DOM runway 分开：Scheduler 供给数据，Adapter 以视口范围维持有界 DOM 窗口，在用户接近边界时物化下一窗口，不随速度突增到六屏富文本。
- live publish 只重绘 `contentRevision` 或局部 UI revision 变化的 presentation row；不得因为父级生成了新的 render closure 就重绘整个已物化窗口。
- `latest` 只决定正文首次进入阅读会话时的默认展开形态。新消息到达后，原末尾长文不得因失去 `latest` 身份而自动收起；其稳定默认值随 ViewSession 保留，直到用户显式展开或收起。

禁止同步 + microtask + rAF 多次钉底，禁止 paint 后逐帧读取 DOM 再修正 `scrollTop`。
跨越虚拟窗口的语义导航使用一次原子定位，不播放经过大量回收行的长距离 smooth scroll。

### V3 用户输入拥有最高优先级

wheel、touch、pointer drag、PageUp/Home 等向上阅读动作立即进入 browsing。任何仍在排队的恢复或跟随命令不得把用户拉回去。

只有两种行为可以进入 following：用户带着向下意图真实到达尾部；用户点击“回到最新”。物理底部进入视口本身不够——列表缩短、正文收起和图片重测都可能制造这个几何结果，但它们不是用户意图。新数据、行高变化和组件重渲染不能隐式进入 following。

### V4 消息行高度变化无动画

消息行和 prepend 补偿不做尺寸动画。高度即时提交，避免虚拟列表在动画的每一帧重新测量。Composer 与等待区维持既有视觉合同，不在本条施工范围内。

### V5 视图换形是导航

频道、scope 或成员筛选改变会替换 presentation row 集合。这不是 prepend/append，必须使用新的 adapter identity；新视图明确定位到尾部，不能把旧列表的高度缓存和索引解释成新列表。频道返回只有在会话明确处于 browsing、有语义 row anchor，且 presentation row、content revision、layout class 与本地折叠状态的 geometry key 完全一致时，才可用 renderer measurement snapshot 加速恢复；否则回退到语义 anchor。following 只有“最新”一个合法位置，进入 following 时必须清除物理 snapshot，切回频道也始终定位尾部。编辑只改变一个既有 row，必须保留当前阅读位置，不能因此 remount 整表。

### V6 顶部边界稳定

接近顶部只发一个合并后的历史意图。真正耗尽历史后，继续上滑不产生视觉位移、加载状态切换或重复操作。正在 prepend 时，虚拟列表补偿不得被解释为“用户离开顶部”。

### V7 嵌套滚动有明确边界

消息正文不建立纵向滚动区。过程详情、代码和 Preview 可以有独立滚动区，但到达边界后应允许手势回到消息时间线；不能用 `overscroll-behavior: contain` 把用户困在内部滚动区。

### V8 移动端是一屏一个 Surface

窄屏（compact/mobile）Conversation、Files、Preview、Tasks、Terminal 是互斥的完整 Surface。打开一个辅助 Surface 必须关闭另一个的 active 状态，不得出现按钮显示“两块都开”而屏幕只展示一块。不得把桌面两栏或上下分屏压进窄屏。关闭 Preview/Files/Terminal 后恢复原 Conversation 阅读会话和合理的触发点焦点。

频道目录同样是独立的全视口 Navigation Surface。它可以覆盖仍挂载的 Conversation 以
保留测量和阅读状态，但必须脱离 Conversation/Workspace 的 Grid，独占自身尺寸、层叠、
滚动和头尾布局；隐藏工作区不得参与频道目录的布局计算。

### V9 消息视口与悬浮层边界

- 消息行不得测量或控制 Composer、等待队列和页面 Shell。
- Composer、等待队列也不得测量自身后回写 Conversation 的 margin、padding、viewport 高度或滚动位置。
- Conversation 的消息 viewport 到 Shell 规定的固定底线为止；底线以下是恒定的 Composer 保留带。最后一条消息在 viewport 内完整可见、可点击，列表不能继续滚入 Composer 背后。
- Composer 保留带是 Shell 的静态几何合同，不从 Composer 实际高度反推，也不随连接、发送、等待数量、折叠状态或文案变化。
- 消息 viewport 的固定底线比 Composer 基础高度额外高出 `32px`，作为最后一条消息的阅读与点击间距；该间距属于 Shell，不从悬浮栈测量。
- Composer 底边固定。编辑器内容可以在自身上限内向上生长，但不得挪动 Conversation，也不得触发联动位移动画。
- 连接、排队、发送失败等状态使用 Composer 内恒定高度的 state rail；状态切换只替换 rail 内容，不改变 Composer 外框位置或高度。
- Composer 与等待队列同属一个自下而上的悬浮栈。回复条、附件或编辑器内容使 Composer 自然向上生长时，等待队列由正常 CSS 布局始终贴住 Composer 顶边；不通过测量、CSS 变量或固定 `bottom` 猜位置。
- 等待队列出现、消失、展开、收起只改变悬浮栈自身，不改变消息 viewport 的固定底线。

### V10 导航是一次性命令

“查看来源”“回到最新”“恢复阅读位置”都有唯一 token，只能执行一次并显式消费。后续 live 更新、行高变化、切走再返回不能重放旧导航命令。编辑旧消息是当前 row 的状态变化，不是整表导航。

## 3. 用户行为验收

### 连续向上阅读

- 手指或滚轮不被程序反向推动。
- prepend 前后屏幕中的第一条可见语义消息不跳动。
- 到达最老消息后自然停住，不弹、不倒退、不反复显示加载状态。

### Live 到达

- following：新内容自然留在尾部。
- browsing/loading-before：当前内容完全不动，只累计语义上的“新动态”。
- 点击提示后一次跳到尾部并回到 following。

### 展开、收起与异步内容

- 点击的正文保持在同一阅读邻域，不留下旧高度空白。
- 展开和收起对称。
- 图片、Mermaid 从首帧起拥有稳定 frame；解码、绘图和代码高亮完成后不改变外框，也不启动自定义滚动补偿。
- 用户在内容变化期间滚动时，用户输入立即接管。

### 切换频道、筛选和 Surface

- 切频道没有旧 DOM 残影。
- scope/成员筛选不复用旧虚拟高度缓存。
- 移动端 Preview/Files 占满可用屏幕，返回 Conversation 时恢复其会话。
- 移动端打开频道导航时保留 Conversation 的物理 viewport，不把虚拟列表临时测成零尺寸；焦点进入导航并在关闭后回到入口。

### Composer

- Composer 与等待队列维持既有视觉、默认展开状态和操作入口。
- Composer、等待队列、连接状态和发送状态不得改变消息区几何。
- 状态 rail 恒定占位；有无状态文本时输入面板的位置相同。

### 键盘、触摸与可达性

- Timeline 自身可聚焦；方向键、PageUp/PageDown、Home/End 与滚轮、触摸共享同一套 browsing/following 语义。
- 普通消息按钮不应被误判为滚动。展开/收起、过程列表和 inline details 只改变
  Presentation choice，保持动作前的 following/browsing；只有真实滚动、selection 位移、
  focused edit 等拥有阅读位置的动作取得 browsing。
- 触摸目标至少 44px；hover 才出现的关键动作在无 hover 设备上必须常显。
- 虚拟列表本身不作为 live region，避免滚动回收 DOM 时把旧消息重新朗读；状态使用独立的 `role=status/alert`。

## 4. 行为矩阵

| 当前模式 | 事件 | 屏幕行为 | 模式结果 |
|---|---|---|---|
| following | live append | 尾部自然跟随 | following |
| following | row resize / 展开收起 | 同一 Following DOM 从尾侧自然布局；不伪造导航 | following |
| following | 用户向上输入 | 立即停止程序跟随 | browsing |
| browsing | live append | 屏幕不动，累计“新动态” | browsing |
| browsing | row resize / 展开收起 | Adapter 统一测量并保住当前阅读锚点 | browsing |
| browsing | prepend | Adapter 在 paint 前完成一次语义锚点事务 | browsing |
| browsing | 带向下意图到达真实尾部 | 清空“新动态”并标记已读 | following |
| browsing | 收起内容使物理底部进入视口 | 屏幕不被继续钉底 | browsing |
| 任意 | 点击“回到最新” | 一次定位尾部 | following |
| 任意 | scope / 成员筛选 | 新列表 identity，明确到尾部 | following |
| browsing | 编辑当前旧消息 | 原 row 原地变化 | browsing |
| 任意 | 查看来源 | 一次定位目标 row，随后消费命令 | browsing |
| 任意 | 打开移动端 Files/Preview | Conversation 隐藏但不销毁 | 原会话保留 |

## 5. 实现边界

```text
ConversationViewport                 VirtualTimelineAdapter
--------------------                 ----------------------
following / browsing                 rowID → measurement table
unseen count                         bounded materialized window
history intent                       single layout commit
session anchor              command  rowID / offset / alignment
user intent observation    <-------  range / top / bottom / input
```

Viewport 不接收 DOM。Adapter 以 rowID 执行可取消导航；普通 resize 和数据更新走同一个布局提交机制，不发导航。

## 6. 本轮施工清单

这里的勾选表示实现已经落位并经过统一代码验证；最终体感仍以真实设备验收为准。

- [x] 删除 viewport 内全部直接 `scrollTop` 写入和逐帧锚点修正。
- [x] 删除 `ViewportLayoutContext` 以及正文组件的局部布局事务。
- [x] 本轮重构：移除 Virtuoso 自动滚动路径，prepend/resize/append 收敛成单一布局提交；生命周期测试和隔离浏览器逐帧检查通过。
- [x] range/start/top 观察只进入同一个合并控制器，不各自创建加载流程。
- [x] scope/filter 进入 adapter identity；编辑沿用当前 identity 和阅读位置。
- [x] “新动态”按新 presentation 内容计算，不把 prepend 算进去。
- [x] Composer 与等待队列改为固定悬浮层；删除两套高度 ResizeObserver、CSS 变量回写和联动 FLIP 动画。
- [x] Composer 状态收敛到恒定高度 rail；Shell 为 Conversation 与 Composer 划定恒定底部边界，并在 Composer 基础高度之上保留固定 `32px` 阅读间距；不使用列表 Footer 假造尾部留白，也不随外围状态重排。
- [x] 历史分页投影单调：既有根 request 不因较早父 request 到达而重挂。
- [x] 图片和 Mermaid 使用首帧稳定 media frame；异步完成不改变 row 外部几何。
- [x] ViewSession 仅在 browsing + 语义 anchor + geometry key 完全一致时复用 renderer measurement snapshot；following 清除 snapshot 并恢复最新。
- [x] 末尾长文的初始展开形态进入 ViewSession；live 到达不再通过 `latest` 改写既有 row 高度。
- [x] 本轮重构：有界窗口按实际视口供给，异构测量与真实自然换行文本的窗口回收、锚点检查通过。
- [x] 清理嵌套纵向滚动的手势陷阱。
- [x] 移动端 Files/Preview 改成单 Surface 全屏拓扑。
- [x] 窄屏 Files/Terminal active 状态互斥，各 Surface 自带关闭出口并恢复焦点。
- [x] 增加纯状态、组件合同与静态边界测试；不依赖浏览器像素脚本证明正确性。

历史验证记录：曾有 111 个文件、630 项测试通过，但它们不足以证明滚动稳定。本轮验证记录见 READING-VIEWPORT-REFACTOR.md，不能继承历史完成结论。

## 6.1 与交互运行层总设计逐项对账

总基线是 [IM-INTERACTION-RUNTIME-ARCHITECTURE.md](./IM-INTERACTION-RUNTIME-ARCHITECTURE.md)，不是已经被推翻的第一版视觉文档。

| 总设计项 | 本轮结论 | 实现边界 |
|---|---|---|
| P0-1 Sync Session | 后续专项已完成 | 视觉专项未改该边界；完成实现与不变量见 `SYNC-DATA-ARCHITECTURE.md` |
| P0-2 Atomic Viewport | 实现与受控验证完成；真机待验收 | `ConversationViewport` 只持语义；`VirtualTimelineAdapter` 独占物理滚动；prepend/resize/append 共用实测布局提交 |
| P0-3 Content Height | 消息区完成 | 删除消息正文的局部 layout port；异步 media 首帧定框；正文 resize 只有 Adapter 一套测量；Composer/等待区维持既有合同 |
| P0-4 Declarative History Demand | 明确后置 | 当前仍是有限 `open()` operation，不冒充持续 demand |
| P0-5 Local-first Submission | 明确后置 | 本轮不把现有 pending/outbox 宣称为 IndexedDB local echo |
| P1-1 Presentation Model | 稳定视觉模型已落位；完整计算增量化后置 | row identity/revision 稳定，token delta 不重扫；结构变化仍可能顺序扫描 |
| P1-2 统一导航事务 | 完成 | channel/scope/filter rebase；source/latest/restore 单 token 单消费；仅 browsing 会话可用匹配的 measurement snapshot 加速，following 始终恢复最新 |
| P1-3 跨生命周期连续性 | 明确后置 | 当前 ViewSession 为可丢弃内存态，不承诺刷新或跨设备恢复 |

### 被撤回的完成判断

`firstItemIndex + layoutEffect` 并非原子事务，库内跨帧补偿仍会继续。函数式 followOutput 返回 false 也不等于关闭库内全部定位分支。本轮移除这些执行路径，改用当前阅读锚点和实测窗口的一次位置提交。之前“用户看不到中间帧”的断言未经真实几何验证，撤回。

### 所有权核对

| 状态/动作 | 唯一 owner | 不再拥有它的层 |
|---|---|---|
| ledger → presentation rows | `ConversationProjector` | render loop、DOM |
| 每频道 scope/filter/fold/anchor | `ViewSession` | Router、Scheduler |
| active Surface/Context route | App routing + `SurfaceShell` | `ViewSession`（已删除未读取的副本） |
| following/browsing/loading | `ConversationViewport` | 渲染测量回调、正文组件 |
| DOM 测量与物理滚动 | `VirtualTimelineAdapter` | Viewport、Timeline、FoldableBody |
| desktop/compact/mobile 拓扑 | `SurfaceShell` + Shell CSS | 各业务 Surface |
| 消息行高度 | row DOM + Adapter | Composer、等待区、页面 Shell |

## 7. 明确不接受的回归

- 因新消息、进度更新或图片加载而突然回尾。
- prepend 后倒退几行、停住、二次补偿或反复弹顶。
- 展开再收起留下上一高度的空白。
- 切换筛选后沿用旧列表的高度缓存。
- 来源跳转在下一批数据到达时再次执行。
- 移动端文件或终端只得到半屏宽度。
- 用 timeout、重复 rAF、无语义的固定 overscan 或屏蔽触摸事件掩盖问题。

## 8. 非目标

- 本视觉专项不改变 WebSocket attach、IndexedDB、缓存 epoch 或 history wire；这些边界随后由 `SYNC-DATA-ARCHITECTURE.md` 独立重构，不能反向侵入视觉合同。
- 不改变 History Scheduler 的批次、并发、重试和预热策略。
- 不实现跨设备阅读位置或离线 outbox。
- 不通过无语义调大 overscan、延迟、timeout 或增加补偿次数掩盖几何冲突；DOM runway 只能由 renderer 根据实际 viewport 与已测量窗口决定。
