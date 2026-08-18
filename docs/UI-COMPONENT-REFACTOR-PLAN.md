# atoll-web UI 组件层重构设计与施工计划

状态：DG-1、R-1～R-6 与最终验收审计全部完成
日期：2026-08-17
产品基线：[USER-INTERACTION-SPEC.md](USER-INTERACTION-SPEC.md)
系统基线：[BUILD-SPEC.md](BUILD-SPEC.md)
测试基线：[TESTING.md](TESTING.md)

## 0. 文档定位

本文是 UI 组件层重构的唯一权威文档，包含目标设计、施工顺序、验收证据和当前状态。

这条重构轨道与产品阶段 A–E 分离：

- 阶段 A–E 说明产品能力是否完成；
- 本文说明已经完成的产品能力如何迁移到可维护、可复用、可验证的 UI 组件架构；
- 本文不重新定义后端协议、用户旅程或产品视觉；
- 施工不按单个控件停下来逐项确认，而按本文定义的完整迁移波次推进。

## 1. 目标与非目标

### 1.1 目标

1. 建立稳定的 UI 基础组件层，统一右侧面板、标签、表单字段、选择菜单和确认交互。
2. 消除业务组件对 DOM 子节点数量、全局 CSS 偶然覆盖和浏览器原生弹层的依赖。
3. 将复杂页面拆为“应用编排、领域控制器、产品组件、基础组件”四层。
4. 保留当前产品外观与用户旅程，同时修复已经确认的布局、可达性和错误处理缺陷。
5. 建立能够证明视觉未漂移、窄屏不越界、键盘可操作的自动化验收。

### 1.2 非目标

- 不重新设计品牌、配色、字体、阴影、圆角和整体密度；
- 不改变桌面三栏信息架构；
- 不改变产品阶段 A–E 的后端能力映射；
- 不引入新的状态管理框架或 UI 组件库；
- 不借重构新增后端接口、产品入口或业务功能；
- 不为了组件复用把不同产品语义强行合并成一个万能组件。

## 2. 视觉与行为冻结线

### 2.1 必须保持

- `styles.css` 当前变量表达的颜色、字体和基础尺寸；
- 左栏深色频道导航、中栏账本、右栏浅色详情/管理区；
- 标题、卡片、标签、主按钮、危险按钮的现有视觉语言；
- 桌面端三栏比例和当前 1050 / 900 / 640px 响应式意图；
- 消息区占满中栏、输入区固定在底部；
- 右侧管理内容关闭后返回原频道上下文；
- 产品写操作的提交、账本确认和 OBS 收敛反馈。

### 2.2 允许修正

- 原生 `<select>` 改为网页内部选择菜单；
- 右侧面板在窄屏错误换行、裁切或越界；
- 两标签面板只占三分之二、无标签面板滚动行错误等结构缺陷；
- 假 `alertdialog`、缺失焦点返回、Esc 不可关闭等可达性缺陷；
- 错误未进入组件错误区、非法 JSON 抛出到事件循环等行为缺陷；
- 长文本、空列表、加载、错误和 disabled 状态的不一致细节。

### 2.3 视觉基线证据

施工前在当前工作树建立以下 Playwright 截图基线：

| 视口 | 场景 | 必须覆盖 |
|---|---|---|
| 1280×720 | `multi-channel` | 三栏工作台、消息账本、输入区、名册 |
| 1280×720 | `actor-governance` | 频道概览、成员、危险操作 |
| 1280×720 | `space-administration` | 四个空间管理标签 |
| 1280×720 | `resource-workflow` | KV、文件与附件 |
| 850×720 | `actor-governance` | 右侧抽屉覆盖中栏且不越界 |
| 600×720 | `actor-governance` | 收窄左栏、成员菜单、底部输入可达 |

截图允许差异只包括已登记的缺陷修正。未登记的颜色、字号、间距、宽度和信息层级变化视为回归。

## 3. 当前问题清单

### 3.1 结构问题

- `App.jsx` 同时负责身份、OBS、WS、feed、缓存、提交、定时器、下载、面板路由和页面渲染；
- `ChannelGovernance` 同时承载频道概览、创建、成员编排、确认和退役；
- `SpaceAdministration` 同时承载 Actor 模板、频道模板、Overlay、Profile、设备和一次性密钥；
- 四种右侧产品面板复制 header/nav/scroll DOM，却没有共享面板壳；
- `Timeline` 和 `ActorDetails` 各自生成动态字段，没有共享字段渲染器。

### 3.2 UI 基础设施问题

- 没有 `SidePanel`、`PanelTabs`、`SelectMenu`、`FormField`、`InlineConfirmation`；
- `.governance-panel` 被空间、资源和自动化面板复用，名字和职责均错误；
- 面板 CSS 假定永远存在三段子节点和三个标签；
- 原生 `<select>` 会触发浏览器/系统层菜单，无法保证位于网页边界内；
- 确认卡声明 `alertdialog`，但没有对应的焦点和关闭行为；
- 全局 `styles.css` 同时承载 token、布局、组件和阶段追加样式。

### 3.3 测试问题

- E2E 主要证明业务值能够提交，没有证明真实点击后的菜单边界；
- `selectOption()` 绕过真实用户展开菜单的过程；
- 没有组件级键盘、焦点和关闭行为测试；
- 没有稳定的多视口视觉回归基线；
- 没有静态规则阻止受约束区域重新引入原生 `<select>`。

## 4. 目标分层

```text
src/
├─ app/
│  ├─ AppShell.jsx
│  ├─ RightPanelHost.jsx
│  └─ hooks/
│     ├─ useAtollSession.js
│     ├─ useChannelFeed.js
│     ├─ useChannelDirectory.js
│     ├─ useSubmissions.js
│     └─ useLocalAutomation.js
├─ model/                       现有纯模型，继续保持无 React
├─ net/                         现有网络客户端，继续保持无 UI
├─ protocol/                    现有协议层，继续保持无 UI
└─ ui/
   ├─ primitives/
   │  ├─ SidePanel.jsx
   │  ├─ PanelTabs.jsx
   │  ├─ PanelCard.jsx
   │  ├─ FormField.jsx
   │  ├─ SelectMenu.jsx
   │  └─ InlineConfirmation.jsx
   ├─ channel/
   │  ├─ ChannelOverviewPanel.jsx
   │  ├─ ChannelMembersPanel.jsx
   │  └─ ChannelDangerPanel.jsx
   ├─ space/
   │  ├─ ActorTemplatesPanel.jsx
   │  ├─ ChannelTemplatesPanel.jsx
   │  ├─ ChannelConfigurationPanel.jsx
   │  └─ DevicesPanel.jsx
   ├─ resources/
   │  ├─ KeyValuePanel.jsx
   │  └─ FilesPanel.jsx
   ├─ automation/
   │  └─ ChannelAutomationPanel.jsx
   ├─ timeline/
   │  ├─ Timeline.jsx
   │  ├─ ApprovalCard.jsx
   │  └─ DynamicFields.jsx
   └─ roster/
      ├─ Roster.jsx
      ├─ ActorDetails.jsx
      └─ CapabilityForm.jsx
```

目录是职责目标，不要求一次性机械搬动所有文件。每次迁移必须先建立新组件契约，再删除旧实现，禁止长期维护两套并行 UI。

## 5. 基础组件契约

### 5.1 `SidePanel`

职责：提供所有右侧面板共同的标题、关闭入口、可选标签区和唯一滚动内容区。

```jsx
<SidePanel
  ariaLabel="频道管理 c0"
  eyebrow="CHANNEL CONTROL"
  title="频道管理"
  tabs={tabs}                 // 可选，0/2/3/4 项均成立
  activeTab="members"
  onTabChange={setTab}
  onClose={onClose}
>
  {content}
</SidePanel>
```

约束：

- `tabs` 缺失时不生成空网格行；
- 标签列数由实际数据决定，CSS 不猜测子节点数量；
- 内容区永远是 `minmax(0,1fr)` 对应的唯一滚动容器；
- 宽屏作为右栏，窄屏作为站内抽屉；
- 抽屉不得增加 document 横向滚动；
- 关闭按钮始终可见并有可访问名称；
- 打开和关闭时保留调用方定义的焦点返回目标。

### 5.2 `SelectMenu`

职责：替代产品界面中的原生单选 `<select>`，菜单始终属于网页 DOM。

```jsx
<SelectMenu
  ariaLabel="选择 Principal"
  value={principal}
  placeholder="选择用户"
  options={[{ value: 'alice', label: 'Alice', disabled: false }]}
  onChange={setPrincipal}
/>
```

约束：

- controlled value，不私自保存业务选择；
- 菜单宽度不超过拥有它的字段和面板；
- 在受约束面板中采用 contained 展开，不调用系统原生菜单；
- 支持点击、Tab、Enter、Space、上下方向键、Home、End、Escape；
- 打开时设置活动选项，选择或 Esc 后焦点返回 trigger；
- 选项支持 disabled、空状态和长文本省略；
- 业务代码只能传数据和回调，不得重复实现菜单 DOM；
- 除明确豁免外，`src/ui` 禁止直接出现 `<select>`。

### 5.3 `PanelTabs`

- 接收 `{id,label,disabled}` 数组；
- 宽度充足时使用实际数组长度分配空间，宽度不足时在标签自身区域横向滚动，不压缩成不可辨认的省略号；
- 每个标签保留完整可访问名称和原生 `title`，四标签在 320px 视口仍可选择；
- 支持左右方向键移动；
- 只负责导航状态，不拥有业务表单状态；
- 标签切换后的焦点和滚动位置行为由产品面板明确决定。

### 5.4 `FormField`

- 统一 label、说明、required、错误和控件关联；
- 不解析业务 JSON，不决定 payload；
- error 与具体输入通过 `aria-describedby` 关联；
- input、textarea、SelectMenu 使用同一尺寸和焦点样式；
- 动态审批和 Actor 能力复用同一个字段 renderer。

### 5.5 `InlineConfirmation`

当前视觉保持为面板内确认卡，不改为覆盖整个页面的模态框。

- 不再伪装成没有完整行为的 `alertdialog`；
- 出现时焦点进入标题或取消按钮；
- Escape 等价取消；
- 确认/取消后焦点返回触发操作；
- 明确 normal / danger 两种动作；
- 频道 Actor 与设备操作共用该组件。

### 5.6 `PanelCard`

- 只提供视觉容器、标题和可选 header action；
- 不拥有请求、错误或表单状态；
- 所有 card 必须 `min-width:0`，长内容不得撑开面板；
- 列表、表单、状态卡通过显式 variant 表达，不依赖父组件名称覆盖。

## 6. 状态归属

| 状态 | 归属 | 示例 |
|---|---|---|
| 网络连接与会话 | `app/hooks` | wire、OBS client、登录失效 |
| 频道账本与 cursor | `useChannelFeed` + model | feed queue、fold、read cursor |
| 频道目录与名册 | `useChannelDirectory` + model | channels、access、roster |
| 提交与控制恢复 | `useSubmissions` + model | pending、uncertain、cancel state |
| 面板选择 | `RightPanelHost` / 对应面板容器 | roster/governance/resources |
| 标签选择 | 产品面板容器 | members、devices、files |
| 表单草稿 | 最接近表单的产品组件 | name、purpose、JSON 文本 |
| 展开、焦点、活动选项 | 基础组件 | SelectMenu open、active option |
| 账本/OBS 收敛计算 | model selector | creationConvergence |

硬性规则：

- 基础组件不得 import `model/`、`net/` 或 `protocol/`；
- 产品组件不得直接创建网络 client；
- `AppShell` 不解析业务 payload，不生成管理命令；
- model 不引用 React 或 DOM；
- 表单解析错误必须被拥有该表单的产品组件捕获并显示。

## 7. CSS 架构

目标结构：

```text
src/styles/
├─ tokens.css       现有变量，不改变视觉值
├─ base.css         reset、字体、focus-visible
├─ app-shell.css    三栏与响应式导航
├─ primitives.css   SidePanel、Tabs、Card、Form、Select、Confirmation
├─ timeline.css
├─ composer.css
├─ roster.css
└─ features.css     少量产品专属布局
```

迁移规则：

1. 先复制现有规则并建立截图基线，再按组件移动，不在搬迁时顺手重新设计。
2. 禁止选择器依赖“第二个子节点就是 nav”或固定标签数量。
3. 每个滚动区域必须明确 `min-width:0`、`min-height:0` 和唯一 overflow owner。
4. 全局只保留 token、reset 和 app shell；组件样式不得靠加载顺序覆盖正确性。
5. 响应式由 app shell 和 SidePanel 统一负责，业务面板不得各写一套 viewport media query。
6. z-index 使用固定层级：base、sticky、drawer、menu、toast；不得随意写魔法数字。

## 8. 错误、异步和数据边界

- JSON 解析、字段校验和 command 构造在产品组件的 `try/catch` 内完成；
- 基础组件只呈现 error，不解释业务错误码；
- receipt、feed、OBS 三阶段状态继续由现有 model 计算；
- 切换标签或面板不得清除已提交请求的账本事实；
- 关闭面板可以丢弃未提交的局部草稿，但必须由产品组件显式决定；
- OBS 刷新不得重置用户正在编辑的字段；
- 选项数据刷新后，失效 selection 必须显示为失效并阻止提交，不能静默提交陈旧 ID。

## 9. 测试设计

### 9.1 组件级

为基础组件增加 DOM 交互测试，覆盖：

- SelectMenu 打开、选择、Esc、方向键、焦点返回、disabled 和长列表；
- PanelTabs 0/2/3/4 项布局与键盘切换；
- SidePanel 有/无 tabs 时滚动容器正确；
- InlineConfirmation 的进入、取消、确认和焦点返回；
- FormField 的 label、description 和 error 关联。

施工时评估并引入最小测试依赖；测试依赖不得进入生产 bundle。

### 9.2 浏览器级

- 所有选择测试必须先真实 click 展开，再点击 option，禁止用 `selectOption()` 绕过 UI；
- 320、600、850、1280 四档视口验证 panel、menu、composer、导航和 document 边界；
- 断言 `documentElement.scrollWidth <= innerWidth`；
- 断言菜单四边位于所属面板/字段内；
- 断言浮层打开前后相邻按钮和输入区位置不变；
- 断言窄屏下新建频道、空间管理、退出和频道操作仍可达；
- 断言 Actor 详情使用明确 Grid 区域，能力表单不以负 margin 覆盖能力列表；
- 每个右侧面板至少有一条滚动到底部仍可操作的用例；
- 保留阶段 A–E 业务 E2E，不因组件迁移降低业务覆盖。

### 9.3 静态门禁

最终状态必须满足：

```bash
! rg '<select' src/ui
! rg 'governance-panel' src
! rg 'role="alertdialog"' src/ui
```

如果未来确实需要原生 select 或真正模态 dialog，必须在本文登记豁免和原因。

### 9.4 视觉回归

- 对第 2.3 节场景使用 `toHaveScreenshot`；
- 基线审查以布局、层级、颜色和密度为主，不绑定动态时间文本；
- 动态 Mock 使用固定 seed 和关闭真实时间 pulse；
- 每个施工波次都比较截图，不等到最后统一发现漂移。

## 10. 施工波次

这里使用“设计门 / 施工波次”命名，避免与产品阶段 A–E 混淆。

### 设计门 DG-1：架构基线

交付物：

- 本文；
- 现状问题与目标组件契约；
- 视觉冻结线；
- 迁移和验收规则。

完成条件：设计与 `USER-INTERACTION-SPEC`、`BUILD-SPEC`、`TESTING` 无冲突。

### 施工波次 R-1：基础组件与视觉基线

- 建立截图基线；
- 实现 SidePanel、PanelTabs、PanelCard、FormField、SelectMenu、InlineConfirmation；
- 添加组件级交互测试；
- 只建立 primitives，不迁移业务语义。

验收：primitives 测试通过，截图基线已人工审阅，生产视觉尚未变化。

### 施工波次 R-2：统一右侧面板

- 迁移 ChannelGovernance、SpaceAdministration、ChannelResources、ChannelAutomation；
- 清除 `.governance-panel`；
- 清除右侧面板原生 select；
- 修复无 tabs、两 tabs、三 tabs、四 tabs 的结构差异；
- 统一确认卡和错误区。

验收：阶段 D/E 浏览器测试、三档视口边界和右侧面板截图通过。

### 施工波次 R-3：拆分产品组件

- 拆分频道概览、成员、危险操作；
- 拆分 Actor 模板、频道模板、配置和设备；
- 拆分 KV、文件和自动化；
- 所有解析错误进入对应表单错误区。

验收：单个产品组件只有一个主要用户任务；阶段 D/E 功能闭环不变。

### 施工波次 R-4：动态字段统一

- Timeline approval 与 Actor capability 共用 DynamicFields / FormField / SelectMenu；
- 清除 `src/ui` 中所有未豁免原生 select；
- 保持 schema、typed payload、风险确认和编辑中状态不被刷新重置。

验收：阶段 C 浏览器测试、键盘测试和静态 select 门禁通过。

### 施工波次 R-5：App 编排层拆分

- 抽离 session、directory、feed、submission、automation hooks；
- 建立 RightPanelHost；
- AppShell 只组合页面区域和 controller 输出；
- 删除嵌套右侧面板三元表达式。

验收：`App.jsx` 不再拥有领域解析和具体面板 JSX；阶段 A–E 全部通过。

### 施工波次 R-6：CSS 收口与最终审计

- 按第 7 节拆分样式；
- 删除旧选择器和死样式；
- 执行静态门禁、全量测试、生产构建和视觉回归；
- 更新 BUILD-SPEC、TESTING 和本文件状态。

验收：第 11 节完成定义全部有当前证据。

## 11. 完成定义

只有同时满足以下条件，UI 组件层重构才能标记完成：

1. 六个施工波次全部完成，没有两套并行组件；
2. 产品阶段 A–E 的单元、Mock、浏览器测试和生产构建全部通过；
3. 第 2.3 节截图基线无未解释视觉变化；
4. 所有右侧面板在 320、600、850、1280px 下完整可达且无 document 横向滚动；
5. `src/ui` 没有未豁免原生 select、旧 governance panel 和假 alertdialog；
6. App、复杂面板和动态字段符合第 4–6 节边界；
7. 键盘能够完成标签切换、选项选择、确认和关闭；
8. BUILD-SPEC、TESTING 与实际目录、命令和验收证据一致；
9. 真实浏览器人工 smoke 至少覆盖一次 macOS 窄窗口选择菜单；
10. 工作树没有因重构遗留的临时兼容层、死 CSS 或跳过测试。

## 12. 当前状态

| 项目 | 状态 | 证据 |
|---|---|---|
| 现状盘点 | 完成 | 第 3 节 |
| 目标架构 | 完成 | 第 4–8 节 |
| 测试设计 | 完成 | 第 9 节 |
| 迁移计划 | 完成 | 第 10 节 |
| DG-1 一致性评审 | 完成 | 第 13 节 |
| R-1 基础组件与视觉基线 | 完成 | 6 个 primitives、7 条组件测试、10 张视觉基线；Vitest 100 条和 build 通过 |
| R-2 统一右侧面板 | 完成 | 四种面板统一使用 SidePanel；无假 alertdialog；D/E 回归通过 |
| R-3 产品组件拆分 | 完成 | 频道 3 个、空间 4 个、资源 2 个任务组件；非法 JSON 在所属表单内处理 |
| R-4 动态字段统一 | 完成 | DynamicFields 供 capability/approval 共用；`src/ui` 无原生 select；C 回归通过 |
| R-5 App 编排拆分 | 完成 | AppShell、RightPanelHost、session/directory/feed/submission/automation hooks；App 809→356 行 |
| R-6 CSS 与审计 | 完成 | 11 个职责样式文件；静态门禁通过；补充 3 条组件布局/响应式浏览器门禁；production build 通过 |

### 12.1 布局补充审计

组件规范化同时包含布局契约，不能只验证组件被拆分：

- SelectMenu 与 @成员菜单均脱离文档流，打开不得推动后续控件；
- ActorDetails 以 Roster 的 Grid 行定位，保留名册头部操作，不使用固定 `66px` 偏移；
- CapabilityForm 拥有独立 Grid 行和内部滚动，不再使用 `120px padding + -100px margin` 叠放；
- 320px 下频道头操作转为三列紧凑布局，左栏的新建、空间管理和退出入口不得隐藏；
- PanelTabs 在空间不足时横向滚动，完整标签仍能聚焦和点击。

对应自动化证据：`tests/browser/layout-responsive.spec.js`。

### 12.2 频道创建与管理入口拆分

- 左栏“新建频道”进入无标签的单任务创建面板，只展示父频道上下文、创建字段和收敛进度；
- 顶部“管理频道”只展示当前频道概览、成员和危险操作，不再夹带创建表单；
- 两个任务复用 `ChannelOverviewPanel` 的领域逻辑，但使用独立 panel state 和明确的 `mode`，不得再次合并为同一入口；
- 对应自动化证据：`D-BR-00` 和 `channel-create.png` 视觉基线。

## 13. DG-1 一致性评审

| 权威要求 | 设计响应 | 结论 |
|---|---|---|
| `USER-INTERACTION-SPEC §2.2` 桌面三栏 | SidePanel 只替换右栏骨架，不改变三栏信息架构 | 一致 |
| `USER-INTERACTION-SPEC §2.2` 窄屏逐层进入并可返回 | SidePanel 窄屏为站内抽屉，关闭入口和焦点返回属于组件契约 | 一致 |
| `USER-INTERACTION-SPEC §2.4` 消息区占满中栏、输入固定底部 | 视觉冻结线明确禁止改变 Workspace/Composer 结构 | 一致 |
| `USER-INTERACTION-SPEC §3.1` 写操作三阶段反馈 | 收敛继续由 model selector 计算，基础组件不吞并业务状态 | 一致 |
| `USER-INTERACTION-SPEC §17` 键盘、焦点和操作可达 | SelectMenu、PanelTabs、InlineConfirmation 定义完整键盘与焦点契约 | 一致且增强 |
| `BUILD-SPEC §2` App 只做编排 | R-5 抽离 session/directory/feed/submission/automation，AppShell 只组合输出 | 一致且修复现状偏差 |
| model/net/protocol 不依赖 UI | 第 6 节明确保持无 React/DOM 依赖 | 一致 |
| `TESTING §1–2` 阶段 A–E 全量回归 | 每个施工波次保留现有测试，最终继续以 `npm run test:all` 为业务门禁 | 一致 |
| Mock 确定性和真实浏览器验收 | 视觉测试使用固定 scenario/seed，最终保留 macOS 窄窗口人工 smoke | 一致且增强 |
| 用户要求保持基本视觉设计 | token、布局、卡片和控件视觉被冻结；只允许登记缺陷修正 | 一致 |

DG-1 结论：目标架构没有改变产品能力、用户旅程或基础视觉，可以进入 R-1。R-1 开始前必须先生成第 2.3 节截图基线，不能先改组件再补拍“基线”。
