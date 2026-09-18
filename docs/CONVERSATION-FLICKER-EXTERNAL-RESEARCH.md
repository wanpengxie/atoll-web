# 历史 prepend 闪白：外部证据卡

日期：2026-09-17。范围：只读检索官方 issue、PR、release、源码和真实聊天接入文档；未改生产代码、依赖或测试，未运行新 demo。

## 结论

这不是一个此前无人遇到的现象。公开资料中有三条已经合并发布的相邻根因，分别证明：

1. prepend 后若内部 offset/range 仍用旧估算，组件会渲染一帧错误的可见区；
2. 即使 scroll 数值、最终锚点和 DOM 观测都正确，若 `scrollTop` 写入早于 row transform/render commit，浏览器仍可显示一帧 flash；
3. 新 scroll target 若在滚动 extent 增长前写入，会被旧 `scrollHeight` clamp，并留下可见空区。

Atoll 的 `Virtuoso 4.18.13` 样本与第 1、2 条的提交时序最接近：未知高度 prepend 的初始估算补偿后，第二次实测修正先移动 scroll，替换 range/rows/List 后约 25–43ms 才提交。已有 data、`firstItemIndex`、stable key 和应用 writer 反证排除了接入层错配。但公开材料里没有找到一个同时满足“异步未知高 prepend + 持续快速上滑 + rAF DOM 始终覆盖 + CDP 捕获整帧全白”全部条件的同一报告；因此不能把浏览器 checkerboarding 当作已证根因。

当前可复核的本地基线是 [执行检查单 §9.10.13](./CONVERSATION-EXECUTION-REVIEW-LEDGER.md) 和 [list demo v2 报告](./evidence/list-demo-comparison-v2/REPORT.md)。v1 临时 `test-results` 已被清理，不作为现存证据路径。

## 高匹配公开案例（最多五条）

### 1. TanStack Virtual #1176：prepend 后一帧错误 range

- 原始证据：[PR #1176](https://github.com/TanStack/virtual/pull/1176)、[React Virtual changelog](https://github.com/TanStack/virtual/blob/main/packages/react-virtual/CHANGELOG.md#3141)。
- 版本/平台：框架无关的 `virtual-core`；2026-06-01 合并，随 `@tanstack/react-virtual 3.14.1` / `virtual-core 3.16.1` 发布。
- 触发：`anchorTo: 'end'`、动态尺寸、prepend。
- 已证根因：数据变化后的当前 render 仍以旧 estimate-based positions 计算 visible range；`_willUpdate` 到下一阶段才纠正，所以错误 items 会存在一帧。
- 已验证修复：在 `setOptions`/render pass 内先同步内部 `scrollOffset`，让 `calculateRange/getVirtualItems` 当次就返回正确行；layout effect 只负责把浏览器 scroll 同步到同一状态。
- 与 Atoll 差异：它是 end-anchor API，报告的是 visible jump，不是 CDP 整帧白；但“逻辑 range 必须先于 DOM scroll 对齐”与 Atoll 第二次实测补偿的缺口直接同类。

### 2. TanStack Virtual #1227/#1239：scroll 数值正确仍会单帧 flash

- 原始证据：[issue #1227](https://github.com/TanStack/virtual/issues/1227)、[修复 PR #1239](https://github.com/TanStack/virtual/pull/1239)、[3.14.9 release](https://github.com/TanStack/virtual/releases/tag/%40tanstack%2Freact-virtual%403.14.9)。
- 版本/平台：macOS、React 19、`react-virtual 3.14.6` / `virtual-core 3.17.4` 的复现；2026-07-22 合并，2026-07-28 随 `react-virtual 3.14.9` / `virtual-core 3.17.7` 发布。
- 触发：向上滚动，视窗上方动态行因图片/字体/富文本重新测量，真实高度不同于 estimate。
- 已证根因：维护者的 instrumentation 显示 DOM scroll 与 tracked scroll 的 skew 始终为 0、补偿数值和最终锚点均正确，`overflow-anchor:none` 也不改变问题。ResizeObserver 中先同步写 `scrollTop`，但 item transforms 的通知/提交是异步的，paint 可以落在“新 scrollTop + 旧 transforms”之间。
- 已验证修复：只有实际发生即时 scroll write 时才同步 notify，使 transforms 与 scroll write 落在同一 paint；无 scroll write 和 iOS 延迟补偿仍走较便宜的异步路径。PR 有 active upward-scroll 回归覆盖。
- 与 Atoll 差异：它是 above-viewport resize，不是 prepend；公开结果称 flash/jump，并未给出 CDP 全白帧。但它最直接证明 rAF/数值正确不足以证明 compositor 连续。

### 3. TanStack Virtual #1237：extent 必须先于 scroll target

- 原始证据：[PR #1237](https://github.com/TanStack/virtual/pull/1237)、[3.14.8 changelog](https://github.com/TanStack/virtual/blob/main/packages/react-virtual/CHANGELOG.md#3148)。
- 版本/平台：React adapter 的 `directDomUpdates` 模式；2026-07-20 合并，随 `react-virtual 3.14.8` / `virtual-core 3.17.6` 发布，并在官方 React chat example 手工验证。
- 触发：end-anchored “load older” prepend；新 total 与 offset 已计算，但 size container 的 height 在另一个 layout effect 才更新。
- 已证根因：先向旧、较短的 `scrollHeight` 写新 `scrollTop`，浏览器将它 clamp，顶部保持 whitespace，直到下一次 scroll 才重新协调。
- 已验证修复：先增长 size container，再执行 `_willUpdate` scroll sync；item positions 随后写入。
- 与 Atoll 差异：只影响该库的 `directDomUpdates` 与 at-end 场景，Atoll 当前白帧不是 stale-extent clamp 的同一分支；它提供的是明确的 prepaint 排序不变量。

### 4. Stream React Chat：应用测量合同错误也会 blink/white area

- 原始证据：[Stream React Chat troubleshooting](https://getstream.io/chat/docs/sdk/react/troubleshooting/)。
- 版本/平台：React Web `VirtualizedMessageList`，文档未绑定单一版本。
- 触发/根因：自定义 Message 的垂直 margin 参与视觉高度，却不在外层元素的 `getBoundingClientRect()` 测量内，会导致 erratic blinking/white areas。
- 实际处理：避免行的垂直 margin，并用典型单行高度配置 `defaultItemHeight` 以减少重算。
- 与 Atoll 差异：这是应用接入测量合同问题，不是持续输入下的内部 commit 时序。Atoll 已观测所有 slot 有 ID、无 hidden/opacity、原 row 绝对 index 不变，且 demo v2 去掉外层 strict contain 和重 DOM probe 后仍稳定复现。因此这条是必要的差分检查，不是本例解释，也不能据此用固定高度“修复”自然长文。

### 5. Chromium/Gecko：DOM 存在不等于当前 compositor 有可显示 tile

- 原始证据：[Chromium RenderingNG architecture](https://developer.chrome.com/docs/chromium/renderingng-architecture)、[Chromium checkerboarding metrics](https://chromium.googlesource.com/chromium/src/tools/%2B/0bfe5f534e59fe206ba39c435fb089b1b5fd01c7/metrics/histograms/metadata/compositing/histograms.xml)、[FrameData flags](https://chromium.googlesource.com/chromium/src/%2B/HEAD/cc/trees/frame_data.h)、[Mozilla APZ checkerboarding](https://github.com/mozilla/gecko-dev/blob/master/gfx/docs/AsyncPanZoom.rst#checkerboarding)。
- 平台/机制：Chromium 与 Gecko 的 Web 渲染架构。compositor scroll 可与 main-thread layout/paint 并行；Chromium 明确统计已经显示的 checkerboard frames，并区分 visible tile 尚未 raster 与尚未 record。Gecko 也明确说明高速滚动超出有限 displayport 会暴露未绘制区域，而无限 displayport 会造成无界内存。
- 与 Atoll 的关系：Legend v2 在 `scrollBy(+5940)` 和持续 wheel 后出现 CDP 全白，但相邻 rAF 的 mounted/visible DOM coverage 非空；这与 async scroll/raster lag 相容。
- 证据边界：现有 CDP screencast 只证明最终屏幕像素为白，没有采集 `checkerboarded_needs_raster` / `checkerboarded_needs_record` 或 cc/viz tile trace。它仍可能是组件提交了错误 range/transform 后被 compositor 忠实显示。因此本轮只把 checkerboarding 列为待判机制，不宣称浏览器 bug。

## 对当前样本的责任分层

| 层 | 已证 | 未证 |
|---|---|---|
| 应用数据/身份 | prepend 的 data + `firstItemIndex` 同提交；stable key、row IDs、revision 连续；应用 issuer write 为 0 | 无 |
| 组件范围/提交 | Virtuoso 第二次实测修正先 scroll，旧 range 被整体移出视窗，新 range/rows/List 后提交；公开 #1176/#1239 证明这类阶段错序能产生一帧错误内容/flash | Legend/Virtua 是否具有完全相同内部根因 |
| 浏览器 compositor | CDP 捕获真实整帧白；重探针和外层 `contain:strict` 均不是 Legend 复现的充分原因 | 白帧是否带 Chromium checkerboard need-raster/need-record 标志 |
| 应用样式/测量 | 当前样本无 empty slot、undefined row、hidden/opacity、long task；Stream 的 margin 类问题不匹配 | 真实 Mac 用户页面是否还有另一个独立样式触发 |

## 有证据支持的处理路线

### 路线 A：把每一次补偿做成组件内部的同一 prepaint transaction

机制：不仅初始 prepend estimate，后续真实测量 correction 也必须先发布正确的内部 offset、range、row transforms 和必要的 container extent，再在同一 layout/RO-to-paint 周期写 scroll；实际写 scroll 时同步触发 adapter render。依据是 #1176、#1237、#1239 三个已发布修复。

用户与性能边界：保留“历史插入后同一语义内容坐标”的必要补偿；持续 wheel 期间以执行当刻的 live viewport/input 重新基准，不能把用户导航误当成取消补偿的理由。同步工作只限真正写 scroll 的 correction，不把所有测量都改成同步，也不恢复外部反向写、遮罩或固定内容。

最小验证：原 4101–4105 固定控制全部重跑；要求 fast+prepend 与 stationary+prepend 的 compositor white 都为 0，same-fast/no-prepend 继续为 0；同时断言 anchor/visible IDs、revision、`firstItemIndex`、issuer writes 和 DOM budget。必须保留 paint oracle，不能只看 rAF。

### 路线 B：若 adapter 无法同步 render，增加第二阶段 renderer acknowledgment

机制：真实测量 correction 先标记 pending，并请求目标 range/rows；renderer 在 layout commit 确认新 range 已可见后，组件才在同一 prepaint 阶段应用必要 scroll。等待期间继续吸收 native input，并在 ack 时从 live scroll 重新计算，而不是重放旧 delta。它是 Virtuoso #1493 首次 estimate handshake 的推广，也符合 #1176 的“logical range first, DOM scroll second”。

用户与性能边界：这不是取消补偿、停止用户滚动或冻结消息。风险是 ack 延迟时短暂保留旧坐标，需有 bounded pending 状态、频道/数据 epoch 取消与 selection 保持；若公共 API 无法表达该握手，就属于上游组件修订范围，不能在应用层猜高度模拟。

最小验证：在目标 range commit 人为延迟一帧且 wheel 持续的条件下，确认旧内容仍连续、新 range ack 后只应用一次重基准补偿；补充 channel switch/unmount、selection、100k 有界物化和 iOS/Android 实机惯性测试。

### 条件路线 C：只有 cc/viz trace 证实 checkerboarding 后，才做有界预物化/预栅格

机制：在必要的大幅 correction 前，先让目标相邻 range 进入一个有界的 extra paint window，待 commit/raster 可用再执行同一 prepaint scroll；窗口按一次批次/一至两视窗设硬上限，而不是无限 overscan。

用户与性能边界：会增加短时 DOM、paint 和 GPU tile 成本；不应隐藏列表、固定旧截图或阻断 wheel。由于 v2 的 DOM coverage 已非空，这条目前只是条件方案，不是默认修复。

最小验证：先在 Chromium trace 中同时采集 cc/viz frame、need-raster/need-record、tile preparation、main commit 与 CDP frame token。仅当白帧与 checkerboard flag 对齐，且路线 A/B 后仍存在时，才比较有界窗口前后的白帧率、GPU/内存与长任务。

## 回归 oracle（before 应如何失败）

两个维度必须分开计数：

- `compositorPaint.failureCount`：CDP frame 的全白/连续大空带。当前生产 fixture 的 prepend 4101/4102/4103/4105 各失败，4104 同速无 prepend 为 0；这是一等失败条件。
- `domContinuity.failureCount`：rAF 中 visible IDs、viewport coverage、empty slot、row error、hidden/opacity。它可以为 0 而 compositor oracle 失败；Legend v2 heavy-probe 的四种 fast+prepend 组合全部 3/3 paint fail，rAF coverage holes 仍为 0。

回归还必须记录输入、history arrival、data revision/row IDs/`firstItemIndex`、list range/rows commit、所有 scroll writer、container extent 与 CDP frame 顺序。通过条件是 compositor 与 DOM 两个 oracle 都为 0，并且语义锚、继续滚动、selection 和有界 DOM 不退化；“最终位置正确”或“下一帧恢复”都不算通过。

## 本轮检索边界

定向检查了 TanStack Virtual 的 prepend/range/resize 已合并修复和 release，Chromium/Gecko 的异步滚动与 checkerboarding 官方资料，W3C scroll anchoring 约束，以及 Stream React Chat 的真实接入故障。没有泛搜选库，也没有把无 issue 当作无 bug。W3C scroll anchoring 在 scroll offset 为 0、transform/尺寸变化等 suppression trigger 下并非通用保证，因此不能用 `overflow-anchor:auto` 替代组件事务。公开检索未找到满足本例所有条件并附同类 compositor trace 的单一案例；上述结论只覆盖本轮边界。
