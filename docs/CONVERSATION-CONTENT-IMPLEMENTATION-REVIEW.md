# W4 长内容生产实现评审与最小补齐设计

日期：2026-09-17  
范围：只读审查当前生产链，提出 W4 的最小可执行补齐设计；本文不批准生产改动，不把 Content 改造宣称为既有 prepend 白帧的根因或修复。

## 结论

当前链路已经有可靠的**消息级身份与阅读意图**，但还没有实现规范所说的长内容增量模型：

- 列表的一个虚拟项是一个完整 presentation row。对 turn 而言，它同时包含请求、过程文本、终态、thread、控制与日期边界；Markdown 语义块不是 Virtuoso item。
- 未改变的 presentation row 保留对象引用，`MessageRow` 与独立 `MarkdownContent` 实例可以跳过无关更新。可是一个正在增长的 Markdown source 仍会在每次更新中运行全文 normalize、Markdown/remark/rehype/KaTeX 管线；当前块匹配还会对每个新块线性扫描旧块。
- 当前 `data-reading-block-id` 是 render 期依据 tag、规范化文本、hash、重复序号及唯一 prefix-growth 猜出的 DOM 标记。它没有成为 React key，也没有进入 `initialTopMostItemIndex` 的恢复决策，因此不能证明 DOM 节点、原生 selection 或语义恢复稳定。
- Choices 的活动期外置状态、稳定 row 域和同步本地恢复已经接通；阅读 bookmark 也会低频采集 block/text 证据。但 Choices 的条件 revision/并发恢复尚未实现，bookmark 初始化只消费 message row 与 row-local pixel offset。

因此，**“每个 Markdown 块都拆成一个虚拟项”不是正确的默认补丁**。真正必须完成的是：稳定的 ContentPlan、明确的 invalidation、完成块复用、Choices/selection/restore 的真实消费链，以及对超长可分割内容的有界 DOM。普通短内容和不可安全切分的原子块可以继续是单项；只有经预算证明超限、且能保持语义的长内容才进入粗粒度连续 units。

## 1. 用户义务与实现手段不能混为一谈

| 性质 | 必须守住的合同 | 不是合同、不能拿来刷绿的实现指定 |
|---|---|---|
| 阅读 | 用户向上阅读时不被 live、历史、媒体或折叠更新无故拉走；存活阅读点在物理可行域内稳定 | 固定 `scrollTop`；任意全文改写/字体变化下每个字符逐帧固定 |
| 内容 | token、终态、修订继续实时进入；未闭合 Markdown 使前文语法失效时如实重算 | 停滚才提交、冻结已显示正文、把长内容隐藏到“复制”按钮后 |
| 性能 | 支持范围内输入保持有界主线程工作、DOM、内存和首次/更新延迟；快滚不能闪空 | “项数少”等于便宜；“块越碎越快”；用更大 overscan 掩盖 |
| 身份 | message/block/choice 身份不由 index、latest 或当前挂载位置决定；歧义时宁可 replacement | 仅给 DOM 写一个看似稳定的 `data-*` 就算身份完成 |
| 选择/复制 | 未改变内容尽量保留 DOM 节点、原生选择、焦点与复制语义；选择时禁止后台夺回 following | 虚构 Virtuoso 有 pin/always-render；跨任意已回收区域保证无限长 DOMRange |
| 几何 | React Virtuoso 是唯一列表几何 owner；Content 只提供真实 DOM 与稳定壳 | 应用尺寸树、隐藏测量列表、`scrollBy`、锚差/RAF 补偿、第二个虚拟引擎 |

规范的“超长消息按真实语义块形成连续单元”是一条候选架构约束，不等于“一块一 item”。它的产品目的，是同时获得有界成本、稳定语义恢复与未改写节点复用；如果拆分反而破坏选择、表格/代码语义或增加范围抖动，就没有履行该目的。依据见 [CONVERSATION-FRONTEND-REBUILD.md §6.1–6.3](./CONVERSATION-FRONTEND-REBUILD.md#61-%E9%98%85%E8%AF%BB%E8%BF%9E%E7%BB%AD%E6%80%A7%E7%9A%84%E5%87%86%E7%A1%AE%E5%88%A4%E6%8D%AE) 与 [CONVERSATION-IMPLEMENTATION-SPEC.md W4](./CONVERSATION-IMPLEMENTATION-SPEC.md#6-w4%E7%A8%B3%E5%AE%9A%E5%B1%95%E7%A4%BA%E5%92%8C%E7%9C%9F%E5%AE%9E%E5%A2%9E%E9%87%8F)。

## 2. 当前生产机制的准确图

### 2.1 whole turn 确实是一个虚拟项

`Timeline` 把 `projection.presentation` 直接交给一个 `MessageList`。`MessageList` 的 `data` 是 `snapshot.rows`，`computeItemKey` 是 `row.id`，每一项只有一个 `MessageRow` / `MessageLayoutScope`。`renderRow` 再在这个壳内展开完整 turn：request、多个 progress Markdown、terminal、thread、controls 与 day boundary。

```text
Presentation row (id = request/message id)
└─ one Virtuoso item / one MessageLayoutScope
   └─ whole turn DOM
      ├─ request Markdown
      ├─ progress envelope 1..n Markdown
      ├─ terminal / structured result Markdown
      ├─ thread / details / controls
      └─ optional day boundary
```

代码证据：

- [MessageList.jsx](../src/ui/timeline/MessageList.jsx#L827-L891)：一条 `snapshot.rows` 数据对应一个 `MessageRow`，stable key 为 row ID。
- [Timeline.jsx](../src/ui/Timeline.jsx#L1167-L1220)：完整 turn/standalone 在一次 `renderRow` 内生成，外层只有一个 `.timeline-virtual-item`。
- [Timeline.jsx](../src/ui/Timeline.jsx#L451-L466)：一个 agent turn 内多个 progress/terminal Markdown 都是这个 row 的子树。

这带来一个重要取舍：同一超长 turn 内原生 selection 不会仅因“块之间虚拟回收”而丢端点；但只要这个 row 在窗口中，整条 turn 的 DOM、解析与复杂块都要由浏览器承担。把它改为多 item 会降低单项成本，也会增加跨 item DOMRange 被回收的风险，不能只看一边。

### 2.2 Presentation 是 row 级增量，不是 block 级增量

[conversation-presentation.js](../src/model/conversation-presentation.js#L134-L169) 使用业务 ID、seq/content revision 与布局元数据形成 row signature；变化 row 会 `structuredClone` 并 `deepFreeze` 整个 entry。[增量路径](../src/model/conversation-presentation.js#L219-L269) 只重建 changed IDs，未变 rows 保持引用，顺序引用在 content-only revise 中也保留。

这已经满足两个基础条件：

1. 不相关消息不会因一个 token 全部换 identity；
2. `MessageRow` 的比较器可以用 row 引用与 render revision 跳过更新。

但 changed turn 的 body 仍是整 turn clone/freeze，没有稳定 AST/block plan。若一个 turn 已积累大量 progress/thread/terminal 内容，单 token 更新的模型成本仍至少与该 turn 的可克隆内容有关，不能称作 block-local O(1)。

### 2.3 Markdown 的真实复用与更新成本

| 层 | 已有复用 | 变化 source 的工作 | 结论 |
|---|---|---|---|
| row | `MessageRow` 比较 row 引用和 revision | changed turn 重渲染 | 保留 |
| 同 row 内不同 Markdown source | `MarkdownContent` 是 `React.memo`；progress envelope 以 envelope ID/seq 为 key | 只有 prop 改变的 source 必须执行 | 可复用，但 topology 改变时仍需实测 remount |
| 同一个流式 Markdown source | `normalizeMathMarkdown` 只按完整 text memo | `ReactMarkdown` + GFM/math/breaks + KaTeX 对完整 source 重新处理 | 没有完成前缀的 parser/render cache |
| block matcher | 能在当前挂载生命周期中复用 exact text 或唯一 prefix-growth ID | 每个块执行 `blockText`，再 `previous.filter`；代码推导最坏约为 O(text + B²)/update | 只是 ID 猜配，非 DOM 复用保证 |
| code | 无完成块缓存 | `Highlight` 对整个 code 重新 tokenize/render，按行/token 建 DOM | 大代码是独立成本中心 |
| Mermaid | source-keyed promise/result LRU，容量 48；实例化时重写 SVG 全局 ID | source 变化重新渲染；缓存命中可跳过 Mermaid 计算 | 这是可保留的成熟模式 |
| image | 首帧即有稳定 aspect frame，decode 只换像素 | src 变化重置 phase | 保留稳定壳 |

实现证据：

- [MarkdownContent.jsx](../src/ui/MarkdownContent.jsx#L18-L52) 的 matcher 与 [render path](../src/ui/MarkdownContent.jsx#L95-L150)。
- [CodeBlock.jsx](../src/ui/CodeBlock.jsx#L53-L76) 每次执行 `Highlight` 并映射全部 tokens。
- [MermaidBlock.jsx](../src/ui/MermaidBlock.jsx#L5-L87) 的有界 cache 与 [remount consumption](../src/ui/MermaidBlock.jsx#L94-L114)。

这里的复杂度是源码推导，不是 profiling 数值；在没有支持设备/负载预算前，不能凭它宣布用户已遇到某个阈值问题。

## 3. block identity、Choices、selection 与 restore 的实际接线

### 3.1 block ID 还不是稳定 Content identity

当前 matcher 的正面价值是：同一个已挂载 `MarkdownContent` 中，前插一个不同段落或对唯一末块续写时，测试能观察到相同 `data-reading-block-id`。但它有四个边界：

1. `data-reading-block-id` 只写到返回 DOM；它不是 ReactMarkdown 内部 sibling fiber 的 app-owned key。相同 attribute 不等于 `Node.isSameNode`，也不保证 DOMRange 存活。
2. exact-text 匹配是全局候选扫描，不使用局部 edit range、邻接或 parse-node ancestry。相同重复块重排时无法证明选中了原实体。
3. 旧 ID 被 exact match 认领后，新的同签名重复块仍可能由从 1 开始的 allocator 生成同一个 `${tag}:${hash}:1`，产生一次 render 内的重复 ID。现有测试未覆盖该反例。
4. matcher 状态只在组件 ref；Virtuoso 卸载后重新挂载会从空 previous 开始。未变化内容的 hash/ordinal通常可重现，但增长块无法从前一版继承身份，相关 Mermaid choice 也可能换 key。

现有 [markdown-content.test.jsx](../tests/markdown-content.test.jsx#L87-L98) 只断言 attribute 字符串跨前插/增长不变；它没有断言节点身份、重复块唯一性、卸载恢复或 selection。

### 3.2 Choices 已有正确 owner，但缺 revision 合同

`createMessageLayoutStore` 在 Timeline 生命周期中创建，key 是 `[rowID, name]`，而不是 DOM mount/index/latest。它已接入：

- Mermaid diagram/source；
- progress details；
- thread call / thread collection；
- collaborator child expansion；
- narration expansion。

row 回收不会删除 store 值；选择发生时会先令 ReadingSession 取得 content control，再同步写入 principal-scoped `viewSessions`。fold 是另一组稳定业务 key（request/response/message ID），`foldDefaults` 只在实体首次成为 tail 时采样；以后失去 latest 不会自动收起，显式 override 优先。这些都应保留。

缺口是：[view-session.js](../src/model/view-session.js#L140-L175) 对 reading 有 activation/revision 条件写，对 conversation preferences/Choices 只有同步 localStorage whole-object write。当前启动没有异步“晚恢复”竞态，所以不能声称已经发生晚恢复覆盖；但跨 tab/并发旧写仍可能最后写赢，且默认 choice 未显式落成带 revision 的记录。补齐 W4 时应给每个 choice record `choiceRevision` 与 touched/source，而不是给整个 preferences map 另做无条件 merge。

### 3.3 selection 的已有保护与未证边界

已有保护：

- stable `row.id` 与 `MessageRow` memo 可以保留未改变 row 的 DOM；
- 鼠标内容选择一旦形成移动，会把 ReadingSession 改为 browsing，并明确设置 `canFollowTail:false`、`canRequestHistory:false`；append 不可借 selection autoscroll 重新取得 following（[MessageList.jsx](../src/ui/timeline/MessageList.jsx#L699-L717)）；
- 浏览器测试覆盖了可见稳定内容上的 selection，以及选择 autoscroll 到尾后 append 仍保持 browsing（[reading-viewport.spec.js](../tests/browser/reading-viewport.spec.js#L318-L369)）。

未证边界：

- 同一流式 `MarkdownContent` 更新时，attribute ID 不保证 text node/fiber 不被替换；选择落在已完成前缀仍可能被扰动。
- Virtuoso 没有本项目已证实的 pin/always-render API。跨 item 选择的端点被滚出窗口后，原生 DOMRange 不能凭 stable data key 穿越卸载。
- 现有 C2/C4 fixture 证明的是可见稳定行与 append，不是“跨多个超长 production Markdown chunks、继续反向滚动、同时 source 改写”。

因此粗粒度 chunks 要减少 active-tail 更新波及 completed prefix，但 chunks 不能碎到让正常复制更容易跨回收边界。若公共组件在目标选择轨迹上确实无法保活端点，应把它记录为组件能力缺口；不得补一个隐藏 DOM 镜像或自定义滚动引擎。

### 3.4 restore 采集到了 block，但初始化没有消费它

`visibleBookmark` 在 settled/lifecycle 等低频时机采集 `blockID`、text offset/context 与 row offset，避免热滚动路径遍历文本（[MessageList.jsx](../src/ui/timeline/MessageList.jsx#L121-L163)）。但 `initialLocation` 只依次解析：

1. `messageID`；
2. successor / predecessor；
3. nearest seq；
4. 存活原 row 的 `rowViewportOffset`。

它没有使用 `blockID` 或 text context（[MessageList.jsx](../src/ui/timeline/MessageList.jsx#L190-L217)）。所以当前可恢复“同一 whole row 内相同像素深度”，无法在恢复前内容已经重排时声明回到同一语义块。

这不是要求挂载后用 DOM 差值二次纠正。可执行的公共边界是：若一个长 message 已有稳定 content units，在首次挂载前把 bookmark 的 block/context 解析为 unit ID，再将该 unit 的 index/offset 交给 `initialTopMostItemIndex`；失败则沿既有 message/successor/predecessor fallback。whole-row 短消息继续使用现有 row offset。

## 4. 三类实际内容、当前阻塞与正确粒度

| 内容轨迹 | 当前成本/风险 | 适合的单位 | 当前阻塞 |
|---|---|---|---|
| A. 普通 turn：短请求，若干独立 progress，数 KB prose/短代码，随后 terminal | presentation 只更新一个 row；未变 progress `MarkdownContent` 可 memo，changed source 全文 parse 通常仍有限 | 保持一个 Virtuoso item；内部使用稳定 ContentPlan blocks | 尚缺 block 真实 key/identity 与测量预算，但没有证据要求拆列表项 |
| B. 单一超长、append-dominant 流式 Markdown：数百段/列表项，active tail 持续增长，读者停在已完成前缀 | 每个 token 对完整 source normalize/parse/plugins；matcher 最坏 B²；整个 row DOM 常驻；selection 在 completed prefix 仍受同 source reconciliation 影响 | 从 live 首次出现就使用粗粒度、append-only content units；sealed prefix 不再 repartition，active tail 单独更新 | 必须先有 parser plan、依赖 invalidation 与稳定 unit ID；不能在跨阈值时突然重挂 whole row；Virtuoso 跨 unit selection 要实测 |
| C. 不可任意切分的 rich/atomic：巨大 code fence、宽表格、Mermaid/KaTeX、稳定比例图片 | code highlight/token DOM、表格列布局、异步 diagram/math/font/media 都可能高成本/改高度；按段落硬切会破坏语义/复制/布局 | 一个 atomic unit；复用 source+parser/config revision 缓存与稳定壳。只有内容语义允许时才在 AST 级切分 | 若单个 atomic block 本身超过支持预算，现有公开方案没有凭空消除成本；必须单列 capability/budget，不能假装拆外层 row 已解决 |

“数 KB/数百段”在表中只是 workload 形状，不是发布阈值。真正阈值必须由支持设备、实际字体宽度、内容类型和交互预算校准并固化；本文不伪造毫秒或字符上限。

## 5. 最小可执行补齐设计

### 5.1 先建立 ContentPlan，不先改几何

给每个 Markdown source 建立不可变 `ContentPlan`：

```text
ContentPlan {
  dataKey, messageID, sourceID,
  contentRevision, parserConfigRevision,
  blocks: [{ blockID, kind, sourceRange, dependencyIDs,
             state: active | sealed, renderRevision, costClass }],
  changes: { inserted, updated, replaced, removed }
}
```

要求：

1. 对 previous AST/plan 与新 source 先求局部 edit range；以存活 parse node、邻接、type、content 证据匹配。offset 只定位，不作 ID。
2. 重复块/重排无法消歧时生成新 ID 并产生 `replaced`，绝不把旧 Mermaid/choice 错套到新块。
3. append-only 时只让 active tail 与被 parser dependency 影响的前块 invalid；未闭合 fence/list/definition 能回溯时，如实扩大 invalidation，不冻结事实。
4. plan 成为 Presentation 的不可变内容，而不是 `MarkdownContent` mount ref；row 卸载/重挂仍拿同一个 plan。
5. parser/async 结果必须携带 `dataKey + contentRevision + parserConfigRevision`；受宽度/字体影响的结果再带 `layoutRevision`。过期结果丢弃候选，不丢 source 事实。

可使用现有 Markdown/remark 公共解析栈建立 plan；不能依赖 ReactMarkdown 内部 key 或 fork。若需新增直接 parser dependency，应显式锁定，而不是悄悄依赖 transitive package。

### 5.2 让 block ID 成为 React 身份，并缓存 sealed blocks

渲染层由 app-owned `blocks.map(block => <ContentBlock key={block.blockID} ... />)` 控制 sibling identity。每个 block 只消费自己的 source slice 与 parse environment：

- sealed 且 revision/config 未变的 block 保留 object/React key，`memo` 跳过；
- active block 或 dependency invalidated block 重算；
- Mermaid 继续复用现有容量 48 的 source cache；code/prose/math 的 cache 也必须有容量、版本与 eviction，不建立无界 AST/element cache；
- cache 保存纯解析/渲染候选，不保存 DOM、尺寸或 scroll 状态。

完成这一步后删除：

- render 期 `committedBlocksRef/createBlockMatcher`；
- 以 text hash/duplicate ordinal 作为权威 identity 的路径；
- “attribute 相同即节点稳定”的测试假设。

保留：

- row 级 immutable presentation 与 `MessageRow` memo；
- 分立 progress envelope key；
- stable image shell；
- Mermaid promise/result LRU；
- 低频 bookmark 的文本 context（它仍是 ID 失败时的语义 fallback）。

### 5.3 列表单位：普通/原子 whole-row，超长可分割内容 coarse units

第一阶段先以 ContentPlan 优化内部复用并量化三类 workload。只有 B 类证明 whole-row 超过支持预算时，才把其 coarse sealed chunks 投影为多个 presentation units；不是每个 AST block 一个 item。

为避免“长到阈值后突然重挂整个消息”，分段模式必须在该 source 第一次以 live/streaming 身份出现时确定，并在该 presentation lifetime 内不反向 compact：

- live/streaming long-form source 从第一个 unit 开始按 plan 追加；第一个 unit 的 key 从首次展示起就稳定；
- unit 可包含多个完整 top-level blocks，达到经基准确定的内容成本预算后 seal；以后只 append 新 unit，不重新切已 sealed unit；
- cold-loaded settled 内容在 publish snapshot 前一次生成稳定 units；
- code fence、table、diagram/math 等 atomic block 不跨 unit 切断；单一 oversized atomic 明确记录例外成本；
- message 的业务根身份仍是 `messageID`；unit identity 是 `messageID/sourceID/unitID`。视觉上用 continuation 样式和重复的可访问上下文表达同一消息，不能伪造成多条消息。

此处有一项必须在实现前做界面结构决策：header/request/footer controls 如何在多 unit 中保持固定语义与 DOM identity。最小安全规则是稳定的 header/root unit 与稳定的 content unit keys，不在 stream 中把 controls 从旧 unit 搬到新 unit；若无法在现有 DOM/CSS 下做到，应停在 ContentPlan 层报告阻塞，而不是用 conditional wrappers 每次重组整棵 turn。

### 5.4 公开 Virtuoso 下的唯一几何接入

多 unit 方案只使用已经允许的公开边界：

- `data = presentation.units`；
- `computeItemKey = unit.id`；
- 真实历史 head prepend 时，`firstItemIndex` 与 data 同批变化；message 内新增 unit 不伪装成历史 prepend，不改 `firstItemIndex`；
- 初次恢复时，先在 immutable plan/snapshot 中解析 bookmark 到 unit index，再一次性交给 `initialTopMostItemIndex`；挂载后不做语义反向 scroll；
- intrinsic DOM/ResizeObserver 由 Virtuoso 测量，Content 不读写祖先 `scrollTop`、不缓存 item height；
- fold/Mermaid/详情等用户动作沿现有 `takeContentControl` 先切 browsing，再改变 DOM；following 时的唯一回底 issuer不新增分支；
- 不嵌套第二个 virtualizer，不建 spacer/尺寸树，不用隐藏副本、`scrollBy`、anchor diff 或 RAF retry。

需要明确：这套接入能把 stable unit 交给组件，不能保证 Virtuoso 4.18.13 已知的 prepend paint/range 问题自动消失。W3 白帧、below-anchor resize 与 fold clamp 仍是独立验收门。

### 5.5 Choices 与 restore 的最小补齐

- choice key 从 `[rowID,name]` 扩展为稳定业务域 `[principal,channel,messageID,choiceName,targetBlockID?]`；UI store 可继续用当前作用域封装，不让 DOM mount 持有事实。
- 每条 choice 持 `choiceRevision`、`touchedByUser` 与合法 default version。首次进入域只填空值；失去 latest、回收或晚到默认都无写权。
- 持久恢复只填未 touched 的缺项；保存用 expected revision 条件写。跨 tab 冲突至少拒绝旧 revision，不再 whole-object 无条件覆盖。
- block replacement 时，只有明确 surviving mapping 才继承 block-scoped choice；歧义 replacement 使用合法新默认并保留旧记录供审计/清理，不能错套。
- bookmark 首选 exact unit/block ID；失败用 textBefore/textAfter/block edges 在 ContentPlan 中只读解析；再失败沿 message→successor→predecessor→seq 的既有降级。所有解析均在首次 Virtuoso mount 前完成。

## 6. 验收：必须证明什么

### 6.1 模型与组件测试

1. **身份/歧义**：前插、删除、局部续写、重复相同段落、重复块交换、未闭合 fence 改写；survivor 保 ID，歧义产生 replacement，同一 plan 内 ID 唯一。
2. **真实节点复用**：对未变 sealed block 断言 `Node.isSameNode`，而不只比较 `data-reading-block-id`。在 active tail 更新时，completed prefix 的 focus/selection 端点不被替换。
3. **增量范围**：记录 parser/render counters。append-only 更新不得重新渲染所有 sealed blocks；语法回溯 fixture 必须只重算真实 dependency closure，不能为过测试错误局部化。
4. **异步过期**：旧 content/parser/layout revision 的 Mermaid/math/highlight 候选不能覆盖新 block；缓存容量与 eviction 可观察。
5. **Choices**：row/unit 卸载重挂、失去 latest、late restore、跨 tab stale write、block replacement；用户选择不丢、不被默认覆盖，也不错误继承到歧义块。
6. **restore**：exact unit、block context fallback、message 删除后的 successor/predecessor；初始化只发生一次，无 post-mount scroll writer。

### 6.2 三类真实浏览器轨迹

| 轨迹 | 必须观测 |
|---|---|
| A 普通 turn 对照 | row/item 数、DOM nodes、parse/render counters 不因新架构显著退化；fold/Choices/remount、append selection 与现有行为一致 |
| B 超长流式 prose | 读者停在 completed prefix，active tail 连续更新；未变节点与 selection 存活，工作量只随 active/invalidation 范围增长；向上浏览叠加 live 与 history prepend 时逐帧文本点、DOM coverage 和真实 compositor paint 分列 |
| C rich/atomic | 大 code/table、Mermaid、KaTeX、图片 decode/失败、字体/宽度变化；内容/复制保真，stale async 不提交，choice 回收后恢复，单原子例外成本单列 |

共同检查：

- stable keys、`data` 与真实 head prepend 的 `firstItemIndex` 同批；
- browsing 时无新增应用 scroll writer，following 只走现有唯一回底；
- selection 的 browser `getSelection()`、anchor/focus node、复制文本同时断言；
- restore 从冷挂载开始，不能先错误位置再补；
- DOM/range 与 compositor screenshot 按动作窗口分列，rAF gap 不冒充 paint；
- 桌面与真实 Android 惯性/IME 分开验收，窄桌面不代替 Android。

发布前必须基于支持设备与真实 fixture 冻结数值预算：单次 active update 主线程时间、mounted DOM/text/token 数、cache memory/entry cap、first meaningful content 与 selection/fold input latency。本文只给出复杂度目标，不凭空设毫秒：

- append-only update 与 active chunk + dependency closure 成正比，而不是 settled source 总长度；
- sibling row/progress/sealed chunk 保持引用与 render counter 不变；
- 常态 mounted content 随 Virtuoso viewport + 固定 buffer 有界，atomic oversized 例外单列；
- block matching 不再存在对所有 previous blocks 的逐块 filter。

## 7. 决策卡

**现在可直接复用**

- immutable row presentation、stable message ID、changed-row-only publication；
- `MessageRow`/独立 `MarkdownContent` memo；
- external MessageLayoutStore、stable fold IDs、first-tail default 语义；
- Mermaid 有界 source cache、image stable frame；
- selection 取得 browsing ownership、低频 detailed bookmark；
- 单一 Virtuoso adapter、stable `computeItemKey`、公开 initial location、唯一 bottom issuer。

**最小应补**

1. ContentPlan 与 parser dependency/invalidation；
2. app-owned stable block React keys、sealed block cache、async revision gate；
3. Choices record revision/late-restore CAS；
4. block/context 在首次 restore 中的实际消费；
5. 只有经预算证实的 B 类使用 coarse stable Virtuoso units。

**应删除/禁止**

- render-ref text hash matcher 作为权威身份；
- 只测 attribute、不测 DOM node/selection 的身份断言；
- 每 token 全文处理被称作“真实增量”；
- block-per-item 一刀切、nested virtualizer、应用尺寸/锚补偿；
- 用 W4 改造宣告 W3 白帧已解决。

**实施前仍需回答的有界问题**

1. 从真实支持负载得到 normal/long/oversized-atomic 的数值预算与分段成本阈值；
2. 选择公开 Markdown AST/parser API并显式锁定依赖，验证 source ranges 与 GFM/math dependency；
3. 冻结多 unit 的 header/footer/a11y DOM 结构，确保 stream 中不搬移稳定 controls；
4. 用生产 Content + Virtuoso 轨迹验证跨 coarse units 原生 selection。若公共组件确实回收端点，记录能力缺口并请求单独架构授权，不能在 W4 内暗建保活/滚动引擎。

在这四项回答前，最合理的第一实现切片是 **ContentPlan + stable keyed sealed blocks（仍保留 whole-row geometry）**。它修复已由代码确认的 identity/重复匹配/全文重渲染缺口，同时不把尚未验证的多 item tradeoff 扩散到列表几何；随后由三类基准决定是否启用 B 类 coarse units。
