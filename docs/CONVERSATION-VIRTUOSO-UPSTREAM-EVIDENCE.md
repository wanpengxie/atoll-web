# Virtuoso 向上滚动 / prepend 上游证据卡

日期：2026-09-17。范围：只读核验 `petyosi/react-virtuoso` 官方 issue、PR、release、文档及源码；没有运行新实验，没有修改生产代码、依赖或配置。结论只针对通用 `Virtuoso`，不把其他组件或 Message List 的行为混写进来。

## 结论

Virtuoso 上游不仅有相似报告，而且有一个直接命中“prepend 后整帧空白”的已发布修复：[#1493](https://github.com/petyosi/react-virtuoso/pull/1493)。它证明旧实现把 `deviation` DOM 提交与补偿 `scrollBy` 分在相邻帧，足以让整个 transcript 空一帧；4.18.13 以 renderer layout-effect acknowledgement (`deviationCommitted`) 修复了这一次握手。

但 Atoll 已经使用 4.18.13。该 PR 的 owner 在合并说明中明确限定：修复只覆盖 prepend compensation handoff，不能消除新物化未知高度行在“先影响 normal flow、后测量并补偿”中的全部瞬态；其 mixed-height stress 仍观察到约 85px 调整，`skipAnimationFrameInResizeObserver` 也未消除。4.18.13 源码也把两条路径分开：

- `beforeUnshiftWith` 的首次估算补偿进入 `pendingPrepend -> deviationCommitted -> scroll`，必要时下一 rAF fallback；
- `prevTotalCount === totalCount` 的已挂载行实测高度修正计算 `newDev = totalHeight - prevTotalHeight` 后直接进入 `scrollByWith(-offset)`，不等待 renderer acknowledgement。

这与本地已证顺序一致：首次估算 `scrollTop 0 -> 3960` 后，二次实测修正先到 `8880`，约 25ms 后 range 才替换。因此 #1493 并未被“漏装”；本例更像其 owner 明示仍未覆盖的第二阶段，而不是应用 data / `firstItemIndex` / key 错配。截至 2026-09-17，官方 `main` 与 `react-virtuoso@4.18.13` 的该源码文件内容相同（两次只读抓取 SHA-256 均为 `2cab256ec767f24930626fce99e02a159113b3dd77719ea26147b8ca09622b17`），本轮未发现更新版本已经修复第二阶段。这里是限定检索结果，不表述为上游绝无其他方案。

## 五条高匹配官方证据

| 证据 | 版本 / 状态 | 上游原意与证据 | 与 Atoll 的关系和差异 |
|---|---|---|---|
| [PR #1493](https://github.com/petyosi/react-virtuoso/pull/1493)、[4.18.13 changelog](https://virtuoso.dev/react-virtuoso/changelog/) | 2026-09-05 合并为 `d3c437e`，已随 4.18.13 发布 | PR 的帧级复现是 main 20/20 各空一帧、修订后 0/20。修复保持“先让 deviation 到 DOM，再 scroll”的必要次序，但改为 layout-effect ack，使两者在同一 paint 前完成。PR 明说同值重叠 prepend 仍走 rAF fallback，空帧没有被消除。 | 直接证明 Virtuoso 自身的提交时序可以造成 transcript 整帧白；但 Atoll 已在该发布版，且本地阳性发生在首次 ack 之后的二次实测修正。 |
| [#1493 owner 合并说明](https://github.com/petyosi/react-virtuoso/pull/1493#issuecomment-5552394662) | `petyosi`，OWNER，2026-09-05 | owner 明确说普通列表采用 normal document flow，新向上物化行实际高度偏离估算时，浏览器可能先移动后续行，再测量/补偿；prepend 100 后 mixed-height stress 仍有约 85px 瞬态。`skipAnimationFrameInResizeObserver` 未消除；同步 layout-effect measurement 只降低位移，并带来同步 layout 的性能/正确性成本，需要单独工作。 | 这是对“4.18.13 是否已经全修”的直接否定证据。85px 是其 stress 观察，不是 Atoll 数值；Atoll 的 CDP 白帧和 4920px 二次修正仍是本地独立证据。owner 推荐 chat 使用 Virtuoso Message List，但这只构成迁移候选，不是当前通用列表的零成本配置修复。 |
| [Issue #1373](https://github.com/petyosi/react-virtuoso/issues/1373)、[owner 回答](https://github.com/petyosi/react-virtuoso/issues/1373#issuecomment-4142499131) | Virtuoso 4.18.3，2026-03-27 closed；无关联 PR / release | 报告标题和复现是“scroll up and prepend new data”时 flicker。owner 要求使用 `skipAnimationFrameInResizeObserver`，并提醒 webpack warning；当天关闭。没有 reporter 验证、paint trace 或归因提交。 | 是官方直接同类报告及维护者 workaround，但不能写成已发布修复。更晚的 #1493 owner 观察已经证明该 flag 对二次未知高瞬态并不充分；Atoll 本地还观察过 RO loop / fold 波动，所以它最多是受控诊断变量。 |
| [Issue #1096](https://github.com/petyosi/react-virtuoso/issues/1096)、[owner 回答](https://github.com/petyosi/react-virtuoso/issues/1096#issuecomment-2262255320)、[#1049 的时序权衡](https://github.com/petyosi/react-virtuoso/issues/1049#issuecomment-2017352562) | 4.7.7 起出现；owner 指向 4.9.0 新 flag；Chrome/Windows 与 Firefox/Android | 首次向上物化 `initialTopMostItemIndex` 之前的 variable-height 元素会 blink/jump。owner 指向 `skipAnimationFrameInResizeObserver`，同时要求考虑 #1049；#1049 中 owner 解释同步响应 item resize/refill 是合法设计，若统一推迟到 rAF 会让滚动更迟钝。 | 证明未知高度首次物化与向上滚动的测量时序是已知问题，且同步/异步不是无代价开关；它不是 prepend，也没有 compositor 白帧证据。 |
| [Issue #1405](https://github.com/petyosi/react-virtuoso/issues/1405)、[owner 定位](https://github.com/petyosi/react-virtuoso/issues/1405#issuecomment-4441537359)、[未合并 PR #1397](https://github.com/petyosi/react-virtuoso/pull/1397) | 2026-05；issue 当前 open，PR closed/unmerged | 未先滚动就点击 Header 内 Load Older 时，variable-height prepend 位置改变；owner 定位为 Header 中按钮让第一个 prepended item 被渲染。#1397 曾提议在 scrollDirection 仍为 DOWN/static 时强制触发 deviation，但维护者要求 MRE 并解释当前跳过是有意设计，未合并。 | 这是“静止时 prepend”邻近路径，但 Header 是决定性触发条件。Atoll 未依赖 Virtuoso Header 渲染首个新增行，且 active-upward 与 stationary-at-top 均可白，所以不能把它当成本例根因或现成修复。 |

补充的不同问题：复杂行高速滚动出现空区时，维护者在 [Discussion #389](https://github.com/petyosi/react-virtuoso/discussions/389) 建议 scroll-seek placeholder，后引入 `increaseViewportBy`；[Issue #914](https://github.com/petyosi/react-virtuoso/issues/914) 也用更大 `increaseViewportBy` 缓解 reverse-scroll flicker。这些是有限预渲染/降低暴露概率的策略，不是 #1493 二次实测 correction 的 range/scroll 提交修复。

## 源码责任边界

官方 4.18.13 源码：[upwardScrollFixSystem.ts](https://github.com/petyosi/react-virtuoso/blob/react-virtuoso%404.18.13/packages/react-virtuoso/src/upwardScrollFixSystem.ts)。

1. 同一 `totalCount` 的尺寸变化分支在 `prevTotalCount === totalCount` 时以 `totalHeight - prevTotalHeight` 得到 `deviationOffset`；满足向上滚动状态后，订阅者直接调用 `scrollByWith(-offset)`。这个分支没有订阅 `deviationCommitted`。
2. prepend 分支另由 `beforeUnshiftWith` 计算估算 offset，创建 `pendingPrepend`，发布 `deviation`，再由 `deviationCommitted` 或下一 rAF 调 `compensatePrepend()`。
3. 因而 4.18.13 的已发布修复只给首次 prepend handoff 加了 prepaint ack，没有把随后 item measurements 产生的 same-total-count correction 纳入同一协议。这是源码范围结论；本地 4105 trace 才是“该分支在 Atoll 白帧前实际发生”的行为证据。

## 官方配置的真实边界

| 配置 / 文档 | 官方说明 | 本例能下的结论 |
|---|---|---|
| [`skipAnimationFrameInResizeObserver`](https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/#skipAnimationFrameInResizeObserver) | 不经 rAF 直接报告尺寸；可能提升性能/减轻 flicker，也可能触发浏览器 ResizeObserver loop warning。 | #1373 的维护者 workaround，但 #1493 owner 已实测不能消除二次未知高瞬态。不能直接上线，也不能只屏蔽 warning；若再验，必须同时断言白帧、RO loop、fold、tail 增长与输入响应。 |
| [`increaseViewportBy`](https://virtuoso.dev/react-virtuoso/api-reference/virtuoso/#increaseViewportBy) / `overscan` | 人为扩大 viewport 或分块多渲染行，适合慢内容并减少部分 rerender / fast-scroll 空区。 | 可降低目标 range 未物化或 tile 未就绪的暴露概率，代价是更多 DOM/layout/paint/memory；不会改变 same-total-count correction 先 scroll 的顺序，不能当根因修复。 |
| `defaultItemHeight` / `heightEstimates` | 用显式默认值或逐项估算减少 probe / 初始 layout shift，最终仍以实测替换。 | 只有存在可信估算时可降低 correction 幅度；聊天长短高度不可预测，猜固定高度会把误差转移到后续补偿，不是闭环。 |
| [Troubleshooting](https://virtuoso.dev/react-virtuoso/troubleshooting/) 的 margin / `LogLevel.DEBUG` | item margin 不含在 RO `contentRect`；debug log 用于发现正常 render 外的意外尺寸变化。 | 应作为接入差分检查与诊断，不是万能修复。现有样本已排除 empty/hidden/row-error、data/index/key 错配及应用 scroll writer，但真实生产内容仍应保留 margin/late media 审计。 |

## 对本例的最小下一验证

不改生产的前提下，最有信息量的下一步不是盲调 buffer，而是把相同 fixed seeds 的事件分成两道 ack：

1. 保留 4.18.13 的首次 `pendingPrepend/deviationCommitted` 事件；单独标记 same-total-count `deviationOffset` 的产生、执行时 live input/scrollTop、目标 range 请求与 List layout commit。
2. 在隔离补丁里仅让“实际发生的二次实测 correction”等待目标 range/List 的 before-paint acknowledgement，并在执行时以当刻 viewport/输入重基准；这仍然执行维护语义锚所必需的补偿，不因用户正在导航就简单取消。
3. 用现有 4101–4105 oracle 判定：fast+prepend 与 stationary+prepend 的 CDP compositor white 必须为 0，same-fast/no-prepend 继续为 0；同时保证 semantic anchor、继续滚动、selection、100k 有界 DOM、fold 和 tail+28 不退化。DOM rAF coverage 与 compositor paint 仍分开计数。

若只允许公开配置对照，可做一次有限的 `skipAnimationFrameInResizeObserver` 与小/中 `increaseViewportBy` 矩阵；前者用于判断 RO 调度贡献，后者用于区分 unrendered/raster 暴露，但任何一项只有“白帧少了”都不能证明提交时序已修。不能禁用用户滚动、冻结旧消息、遮罩白帧、施加应用反向补偿或无限增大 buffer。

## 当前结论强度

- **已证上游组件缺陷及已发布修复范围**：#1493 直接复现并修复首次 prepend handoff 的整帧白。
- **已证仍有限制**：owner 明示新物化未知高度行的 measurement/layout sequence 仍可瞬态移动；4.18.13/main 源码第二阶段不走 ack。
- **本地行为已证、上游尚未发布同路径修复**：Atoll 二次实测 correction 先 scroll、range/List 后到并出现 CDP 白帧。本轮定向查到的官方 main/release 没有覆盖它。
- **未证**：该第二阶段是所有浏览器/设备上用户闪烁的唯一原因；真实 Android 尚无设备证据；加 buffer、换 Message List 或开启 skipRAF 会在 Atoll 自动解决。
