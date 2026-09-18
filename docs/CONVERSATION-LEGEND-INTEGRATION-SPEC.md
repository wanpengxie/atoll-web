# Legend React DOM 接入规格（迁移设计关口）

状态：Legend迁移曾进入唯一生产链，但P0-4/C1真实Chromium 0/3失败，当前工作树已经安全回退Virtuoso；本文现为**失败迁移的设计与反证记录，不是当前生产状态或通过结论**。B4 已否决最初提出的
“关闭内建跟随 + 应用单一 tail issuer”作为通用 following 实现；B5 只对
“built-in 单 owner + 删除应用连续 tail writer”给出有界正证，但 imperative pending 输入次序与
fold 语义仍未闭合；任何未来重试若偏离本合同，必须先作为C1失败/架构反例处理，不能反向改写B4。版本固定为
`@legendapp/list@3.3.11`，Web 入口固定为 `@legendapp/list/react`。本文只使用
该版本公开 props/ref；不 fork、不调用私有 store、不做应用层锚差补偿，也不引入
第二个滚动控制器。

## 1. 结论与未决门

隔离实验已经给出足够理由进入接入设计，而不是继续轮换组件：

- 在与生产相同的 400 行自然高度数据、稳定 key 和静止触顶 +30 prepend 下，
  当前 Virtuoso 4.18.13 的同机阳性出现 1/1 实际 compositor 白帧；Legend
  3.3.11 为 0/3，并保持可见锚点（B1）。
- 锚点下方离屏行增长 28 px 时，Legend 0/3 不移动前台锚；当前 Virtuoso
  控制移动 28 px（B1）。
- native clamp 场景中，Legend 3/3 保留存活正文；当前 Virtuoso 控制在 native
  clamp 后再次过补偿并把正文推离视口（B1）。
- 实际 Markdown/FoldableBody、连续上滑、并发 history + tail stream、selection
  和频道 bookmark 均证明公共 API 足以覆盖大部分现有 UX（B2/B3）。
- 频道切换白帧是“新 activation 尚未首次呈现内容但没有状态反馈”，不是“新频道
  已呈现内容后又消失”。正常布局的初始化状态能覆盖这段生命周期，且首次真实
  消息 paint 后没有覆盖丢失（B3）。
- 关闭内建跟随并由应用在 data/size/viewport 信号调用公开 `scrollToEnd` 时，append
  与 stream 可以保持底部，但 viewport 600→520 后 Promise resolved 仍离底 80 px；
  该通用 following 映射未通过（B4）。
- 改为 built-in data/item/layout 单 owner 并删除应用连续 tail writer 后，同一矩阵
  距底为 initial 1 / append 1 / stream 0 / viewport 0 px；wheel 关闭授权后迟到
  resize 的前台锚变化为 0 且无 late write（B5）。

迁移仍有两个未闭证据门。其一，生产 `FoldableBody` 展开使行增长
1496.90625 px 时，Legend 固定了点击控件/行尾，行首从 -39.875 px 移到
-1536.875 px。展开本身是用户授权的布局变化，因此“行首移动 1497 px”不能单独
判为违约；反过来，“按钮没动”也不能单独判为通过。`展开全文` 的真实阅读目标是
从折叠预览末端连续进入第一个原先隐藏的正文。B2 没有记录这个语义点及其展开后
坐标，所以本轮只能判**待验证**。只有 Legend 公开机制能让该续读点保持可见，或让
用户只需沿正常阅读方向即可到达，同时保持按钮焦点和正文可选择，fold 门才通过；
不能加入应用 `scrollBy`/锚差回写来伪造通过。

其二，3.3.11 的公开 `scrollToEnd` 不是调用点同步写入：它先排入下一次 React
layout commit，数据/MVCP 尚在 settle 时还可能等待稳定帧后才实际滚动。现规格只有
调用前的 session 授权检查，没有证明这段等待中发生的新输入能撤销库内 pending
request。B2/B3启用了内建`maintainScrollAtEnd`，但未模拟真实following/browsing授权；
B4另行实测并否决了`maintainScrollAtEnd={false}` + 应用连续issuer。因此这两组都不能
关闭显式`scrollToEnd` pending与用户输入交错：必须先用公开API证明迟到请求不会越过
activation/input epoch；不能把`await`或Promise resolve后检查当成实际写入前的取消，
也不能把已否决的B4方案重新写成当前合同。

证据：

- `docs/evidence/frontend-mechanism-b/REPORT.md`：三项几何机制与 compositor 证据。
- `docs/evidence/frontend-mechanism-b2/REPORT.md`：真实行、流式、selection、展开和频道返回。
- `docs/evidence/frontend-mechanism-b3/REPORT.md`：activation 生命周期、严格消息视窗 oracle。

这些是 Linux HeadlessChrome 的隔离证据，不等于 Mac/Android 全体验结论。

## 2. 所有权不变式

接入必须维持三层职责：

1. `useReadingSession` 是唯一阅读策略 owner：决定 following/browsing、input epoch、
   history demand、bottom intent、bookmark 和 activation 世代。
2. Legend 是唯一几何 owner：测量动态行、为 prepend/resize 维护可见位置、执行
   initial placement 和唯一获准的 public ref 滚动。
3. 应用 adapter 只把当前 session 决策映射为公开 props/callback；它不计算
   prepend 高度、不遍历隐藏项补测、不写 `scrollTop`/`scrollBy`、不保存第二份锚。

任意自动回到底部都必须重新读取**当前已提交 activation**、input epoch、snapshot
revision、mode 和显式 intent。旧 Promise、旧 callback、旧 activation 都只能发出
“重新评估”信号，不能携带滚动授权。

## 3. 公共 API 映射

### 3.1 核心数据与行身份

```jsx
<LegendList
  data={snapshot.rows}
  keyExtractor={(row) => row.id}
  renderItem={({ item }) => (
    <MessageRow
      row={item}
      revision={rowRevision(null, item)}
      renderRow={renderRow}
    />
  )}
  extraData={renderEpoch}
  maintainVisibleContentPosition={{ data: true, size: true }}
  recycleItems={false}
/>
```

- `snapshot.rows` 仍是一个 React commit 中提交的稳定数组；prepend 必须保持旧对象
  身份与旧 `row.id`，新历史只加在数组开头。
- `keyExtractor` 只返回业务稳定 `row.id`；绝不回退到 index、容器编号或位置。
- `extraData` 是外部行 UI 状态的明确失效 token。B2 已证：只改变 fold override 而
  data item 身份不变时，Legend 的缓存行不会自动重渲染。`renderEpoch` 应由现有
  `rowRevision` 所依赖的外部状态生成，且 `MessageRow`/revision 继续限制未变化行的
  React 工作；不能每帧或每次 scroll 递增。
- 第一阶段固定 `recycleItems={false}`，保留 DOM/selection 身份。B2 中稳定 key 下的
  相邻 Markdown selection 保留了同一 text node；开启 recycling 必须另行证明不会
  改变 selection/焦点/ARIA 身份，不能随迁移顺手打开。
- `estimatedItemSize` 只能作为初始估计，不能写成固定尺寸；动态 Markdown、工具卡、
  图片、折叠和流式内容继续由 Legend 的测量负责。

### 3.2 history prepend

- 启用 `maintainVisibleContentPosition={{ data: true, size: true }}`；`data:true` 负责
  稳定首部增删，`size:true` 负责动态尺寸变化。
- 删除 Virtuoso 的 `firstItemIndex` 坐标。history commit 只提交稳定 key 的新
  `data`；应用不提交 shift 数、累计高度或外部锚差。
- 保留现有 native input ownership：只有真实向上滚动在 runway 内才能请求历史。
  Legend 的 start/scroll callback 只更新几何观察，不自行制造用户需求。
- history 返回、同一时刻 tail stream、行测量可以并发；仍必须是同一 activation
  的正常数据提交，不能冻结尾部或延迟正文来换取稳定。

### 3.3 一次性初始位置

每个 activation 只建立一次不可变 initial placement：

- following 且没有 bookmark：`initialScrollAtEnd={true}`。
- browsing bookmark 已在 snapshot：按稳定 ID 找 index，传
  `initialScrollIndex={{ index, viewPosition: 0, viewOffset: bookmark.rowViewportOffset }}`。
- bookmark ID 缺失时，继续用现有 successor/predecessor/seq 规则解析一个稳定行；
  若 snapshot 尚不含可解析行，保持 `reading.initializing` 并请求有界历史，不能先
  mount 错位置再命令式跳转。

initial props 在 activation 内不得因 append/prepend/resize 重建。不能用 mount 后
`scrollToIndex` 重试 bookmark；用户在首个 viewability 后产生 wheel/touch/key 输入，
现有 input epoch 立即使任何迟到的初始化工作失效。B3 的立即接管样本证明该边界可
实现：用户 `-320` wheel 后，可见锚保持新位置，后续库内 extent 修正没有 snap back。

### 3.4 回到底部与流式更新

B4 已否决第一版映射：`maintainScrollAtEnd={false}`，再由应用在 data、item-size、
viewport-layout 后调用 `legendRef.scrollToEnd`。该方案能处理 append/stream，却在
viewport 600→520 后让公开 Promise resolved 于离底 80 px，950 ms 内没有后续写。
同时，3.3.11 的 public call 可跨 React commit/稳定帧；应用在调用前通过的 epoch
授权无法在库实际写入瞬间重新验证。不能添加 current-offset 假取消、timer retry、
另一条反向写入或私有 pending guard 修补它。

连续 following 因此只剩一个待准入的公开方案：

```jsx
<LegendList
  maintainScrollAtEnd={authorizedFollowing ? {
    animated: false,
    on: { dataChange: true, itemLayout: true, layout: true },
  } : false}
/>
```

Legend 必须成为 data/item/layout 的**唯一**连续跟随 owner；删除应用针对 commit、
`onItemSizeChanged` 和 viewport 的 tail writer。ReadingSession 只决定当前 committed
activation 是否授权 `authorizedFollowing`，用户输入必须立即切到 browsing 并关闭它。
显式“回到最新”仍可调用一次公开 `scrollToEnd({animated:false})`，但该命令不能演变为
应用持续追尾 writer，也不能恢复任意消息导航。

B2/B3 始终开启 built-in follow，未模拟真实 following/browsing 授权，不能作为这一
替代的准入证据。B5 已补上有界 C1：app 连续 issuer 为 0，append/stream/viewport
均保持尾部；真实上滑关闭授权后，迟到 resize 不移动前台锚且没有 late write。
但其显式 latest Promise 比 wheel 早 10 ms settle，仍未覆盖“输入落在 imperative
pending 内”的次序。该次序及 fold 门通过前仍不授权生产迁移；不得回退到双 writer。

### 3.5 动态尺寸、fold 与 selection

- `onItemSizeChanged` 只增加 adapter 的 geometry revision、调度 bookmark/coverage
  观察，并在当前 session 允许时提示唯一 bottom issuer 重评估。
- 锚点下方增长不得引起 browsing 补偿；锚点上方增长由 Legend 的 size MVCP 处理。
- 不加应用 ResizeObserver 尺寸树、人工高度缓存或外部 scroll 修正。
- 现有 `FoldableBody` 点击只改变 Presentation choice，不取得 foreground navigation；
  following 保持 tail，browsing 保持原 adapter。展开是明确授权的局部布局事件，不要求
  整行行首或按钮二者机械地保持原坐标。定向 spike 必须在点击前
  标记折叠预览末端的最后可见正文和第一个被隐藏的正文，展开后验证二者构成连续的
  续读位置、按钮仍有焦点且全文可沿正常阅读方向到达。
- 3.3.11 的 `shouldRestorePosition(item,index,data)` 在公开
  [`mvcp.ts`](https://github.com/LegendApp/legend-list/blob/v3.3.11/src/core/mvcp.ts)
  中只参与 `dataChanged` 的 MVCP 锚选择；stable data + `extraData` 触发的 fold 是 item
  size change，它不能控制这次补偿。不得再把该 predicate 写成 fold 方案。可测试的
  范围只能是公开 size MVCP
  配置对这一次授权布局事件的表达能力；结果出来前不指定实现，也不加应用像素补偿。
- selection、pointer、wheel、touch、keyboard 监听继续绑定真实 DOM scroller；
  `recycleItems=false`、稳定 key 和现有 `MessageRow` memo 是第一阶段身份保障。
  selection 测试必须同时断言选区文本、anchor/focus text node `isSameNode` 和坐标。

### 3.6 scroller ref、CSS 与可访问性

- list ref 只用于 `scrollToEnd`；`refScrollView` 取得 Web DOM scroller。adapter 要接受
  `HTMLElement` 或公开 ScrollViewMethods，再用公开 `getScrollableNode()` 规范化，
  不能下钻内部 container。
- `.timeline-message-list` 仍是唯一 overflow scroller，`flex: 1; min-height: 0`；
  不在外层增加 `contain: strict`，不套第二个可滚容器。
- 保留现有 scrollbar、focus、region/aria-label 和 nested-scroll 判定。
- Legend 行容器的定位/transform/尺寸样式由库拥有；生产 CSS 只给消息正文和业务行
  样式，不能覆盖内部绝对定位或 visibility。

## 4. activation 初始化反馈

B3 要求将“数据是否可用”和“新 list 是否首次公开可见”分开：

1. snapshot 不可用：沿用完整 timeline `role=status`：`正在同步频道内容…`。
2. rows/bookmark 已就绪、但新 activation 的 `onViewableItemsChanged` 尚未报告非空：
   在现有 flex 布局中显示 34 px `role=status`：`正在恢复上次阅读位置…`。
3. 当前 activation、当前 snapshot revision 的 public viewability 非空后，在页面可见
   状态下等待下一 rAF；rAF 执行前重新核对同一 token 和非空内容，才移除状态并标记
   activation ready。

状态行是正常布局元素，不是覆盖层，也不保留旧频道假扮新内容。ready 只按 activation
初始化一次；同 activation 的 prepend、append、stream、resize 绝不能重置它。
切换 activation 或卸载必须取消旧 rAF，旧 callback 不得修改新 activation。

生命周期还必须显式覆盖三个分支：权威空频道直接进入正常空态，不能永远等待非空
viewability；同步失败进入可重试错误态，不能冒充 initializing；`document.hidden` 时
不得移除 initializing 状态，恢复 visible 后只复核当前 activation 的 viewability 和
paint，不重放 initial placement。同一 activation 的窗口 resize、移动键盘和焦点变化
只是布局重算，不创建新 activation 或新的初始滚动授权。

严格 oracle 以首个带新频道 row marker 的实际 compositor paint 为“内容开始”；
loading/status 像素永远不算消息覆盖。B3 中冷进入移除 34 px 状态导致锚 +34 px，
但发生在首次内容 paint 之前；已读返回和立即接管移除状态的锚变化均为 0。生产验收
必须继续分别记录 status paint、首次内容 paint、首次内容后的白帧/消息覆盖丢失。
B3 只覆盖三个固定场景各一轮；它支持这种状态生命周期，但没有证明权威空、错误、
hidden→visible、resize/键盘或 stale rAF，不能把该组结果写成完整生命周期已闭合。

## 5. 保留、替换与删除矩阵

| 当前能力/接口 | Legend 接入 | 处置 |
|---|---|---|
| `snapshot.rows`、稳定 `row.id`、`MessageRow`、`rowRevision` | `data`、`keyExtractor`、`renderItem`、`extraData` | 保留业务模型；适配公开 props |
| `useReadingSession` mode/input epoch/bottom intent/bookmark | 不进入库内部 | 原样保留为唯一策略 owner |
| `visibleBookmark`、native input handlers、nested scroll、coverage probe | 绑定 `refScrollView` DOM | 保留，选择器改为业务 `data-presentation-row-id` |
| `Virtuoso` import | `LegendList` from `@legendapp/list/react` | 替换 |
| `virtuosoRef` + DOM `scrollTo({top:scrollHeight})` | built-in `maintainScrollAtEnd`；显式 latest 才用一次 `legendRef.scrollToEnd` | 删除应用连续 tail writer 与 DOM 目标计算 |
| `firstItemIndex` | stable keyed `data` + MVCP data | 删除 Virtuoso 逻辑坐标 |
| `computeItemKey` | `keyExtractor` | 删除 transient `empty:index` fallback |
| `initialTopMostItemIndex` | `initialScrollIndex` / `initialScrollAtEnd` | 一次性映射 |
| `followOutput={false}` | session 授权的 built-in `maintainScrollAtEnd` | B5 有界准入；不得与应用 tail writer 并存 |
| `increaseViewportBy`、`overscan`、`minOverscanItemCount`、`defaultItemHeight` | 初期仅公开 `drawDistance`/`estimatedItemSize` 的保守值 | 不能逐项照搬；以实际挂载像素和性能验收定值 |
| `CommitAwareList`、`VIRTUOSO_COMPONENTS`、`context.onListCommit` | data commit、viewability、item-size/layout 信号 | 删除 Virtuoso commit shim |
| `atBottomStateChange`、`atTopStateChange` | DOM/public scroll observation及 viewability | 重建观察，不重建策略 |
| `rangeChanged` | `onViewableItemsChanged` | 只作观察/coverage，不作 history demand |
| `totalListHeightChanged` | built-in item/layout following + `onItemSizeChanged` 观察 | callback 不触发应用 tail write |
| Virtuoso 内部 DOM probes：`data-item-index`、`data-known-size`、`virtuoso-item-list` | 业务 row ID + public callbacks | 全删；测试不得绑定新库私有 DOM |
| `FIRST_ITEM_INDEX_ORIGIN` 与 prepend decrement | 无对应需求 | 全切换绿后从 presentation 删除 |

`conversation-presentation` 的 `firstItemIndex` 可在双适配过渡期暂时留为未消费字段；
最终迁移必须删除 origin、snapshot 字段、prepend decrement 及其测试，不能让新 adapter
继续携带 Virtuoso 假坐标。

## 6. 包锁变更

实现窗口只做显式、可审计的依赖替换：

1. dependencies 加精确 `"@legendapp/list": "3.3.11"`。
2. 只从 `@legendapp/list/react` 导入 React DOM 组件；禁止拿 React Native issue 或
   RN entry 当 Web 接入证据。
3. 新 adapter 与所有迁移 gate 通过前保留 `react-virtuoso: 4.18.13` 供对照。
4. 完成切换后删除 `react-virtuoso` 及 package-lock 中仅由它引入的节点；重新安装并
   检查 lock 中 Legend 精确版本。无 patch-package、resolution override 或源码 fork。

## 7. 测试迁移与验收

### 7.1 现有测试映射

- `tests/message-list-lifecycle.test.jsx`：把 Virtuoso prop harness 改成 Legend 公共
  callback/ref harness；继续覆盖 stale activation、input epoch、bottom intent 去重、
  history runway 和 geometry revision。
- `tests/setup.js`：删除全局 `react-virtuoso` sizing context mock；只建立公开 Legend
  DOM 几何环境，不模拟私有 store。
- `tests/timeline-reading-integration.test.jsx`：保持真实 `MessageList` + 原数据/session，
  改为验证公开 viewability/size 信号不会越过 ReadingSession。
- `tests/visual-interaction-contract.test.jsx`：从断言 `followOutput={false}` 改为断言
  session 授权的单一 built-in follow、MVCP data/size、stable key，以及不存在应用
  commit/size/layout tail writer。
- `tests/browser/fixtures/reading-lifecycle.jsx` 与对应 spec：删除 `firstItemIndex` 和
  `virtuoso-item-list` selector；用业务 row IDs、真实 scroller 和公开 lifecycle。
- `tests/browser/reading-viewport.spec.js`：保留 following/browsing、latest、history、
  stream、resize、selection、channel bookmark oracle，删除 Virtuoso commit 假设。
- `tests/browser/flicker-investigation.spec.js`：保留 compositor screenshot 与 DOM coverage
  的分列判定；改 adapter 后它是原故障回归，不应因换库删除。

### 7.2 必须通过的 gates

1. 固定自然高度 fixture：静止 +30 prepend、上滑同时 history+tail、无 prepend 控制，
   每项至少 3 次；DOM gap 与 compositor white 分开。
2. browsing 下：锚下方 +28 为 0 px、锚上方增长正确稳定、无尺寸变化控制为 0。
3. native clamp/fold：存活正文连续；生产“展开全文”以预览末端最后可见正文和首个
   隐藏正文为语义 oracle。展开后可连续续读、按钮保持焦点、全文可沿正常方向到达；
   单看 row top 或按钮坐标均不判通过/失败。fold size 不能借
   `shouldRestorePosition` 作假，仍是待验证门。
4. 同一 activation 的 Markdown 流式更新不抢 browsing；following 只由 session 授权
   的 built-in owner 保持底部；显式 latest 外不存在应用 tail writer。B4 中 viewport
   离底 80 px 的失败必须保持由 B5 方案回归为容差内。
5. selection 在 append/prepend/stream 后保持文本与 `Node.isSameNode`；点击、复制、
   nested scroll、键盘、屏幕阅读 region 不退化。
6. cold / read return / immediate takeover：status 可见；首个真实内容 paint 后没有
   白帧、消息覆盖丢失或回跳；bookmark 误差在既有容差内。
7. 不恢复任意消息导航或通用 cancel 门；用户只拥有现有“回到最新”。
8. 同机 Chromium 通过后，还需真实 Mac 与 Android 浏览器的惯性/合成验证；Headless
   通过不能代替目标设备。
9. 显式 latest 的唯一 imperative `scrollToEnd` request 在 data/MVCP settle 期间遇到
   新的 wheel/touch/pointer/key 输入必须失效，且不能在输入后迟到写入。B5 的 wheel
   比 Promise settle 晚 10 ms，此 pending 次序仍未通过，不能从最终不回跳外推。
10. activation ready 覆盖权威空、失败重试、hidden→visible、resize/移动键盘和旧 rAF
    失效；每项同时区分 status paint、首个消息 paint 与首个消息 paint 后覆盖。

任何目标行未物化、截图只见 loading、或 rAF DOM 覆盖但没有真实 compositor paint
时，该 case 都是不可判，不得报 pass。

## 8. 实施切片与文件所有权

建议由 main 在一次冻结窗口独占以下共享文件：

- `package.json`、`package-lock.json`
- `src/ui/timeline/MessageList.jsx`
- `src/styles/timeline.css`
- 必要时 `src/ui/Timeline.jsx`（只提取稳定 `renderEpoch`/activation status 接线）
- `src/model/conversation-presentation.js`（仅最终清理 `firstItemIndex`）
- `tests/setup.js`、MessageList/Timeline 定向单测和上述 browser fixtures/specs

本规格与 B1/B2/B3 evidence 由隔离实验 owner 维护；该 owner 不同时修改上述共享源码。
顺序固定为：依赖与 adapter 骨架 → 单一 issuer/initial lifecycle → history/size →
selection/stream → fold 阻断 gate → 原故障 compositor 回归 → 最终删除 Virtuoso。

若 fold gate 失败，立即停止在可回滚的 adapter 分支，不删 Virtuoso，也不以外部滚动
补偿扩大授权。若全部 gates 通过，仍需由 root 明确批准生产切换。
