# 前端 D2：视觉系统与交互原型规格

状态：设计完成，尚未施工
日期：2026-08-18
上位计划：[FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md](FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md)
对象与导航：[FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md](FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md)
参考研究：[GENSPARK-DESIGN-BENCHMARK.md](GENSPARK-DESIGN-BENCHMARK.md)

## 0. 规格定位

D1 已经定义用户对象和导航语义，D2 定义这些对象如何被看见、理解和操作。

本文完成：

- Atoll 产品专属颜色、排版、间距、边线、圆角、阴影、图标和动效规则；
- App Shell、Dynamic、Artifacts、Tasks、Context Pane、Modal 和 Operation 的视觉层级；
- Hover、Focus、Selected、Disabled、Loading、Stale、Uncertain、Failed 等状态；
- 1280、800、600、320 和 200% 缩放的布局规则；
- 键盘、焦点、对比度、动态内容和 reduced motion 契约；
- 高保真交互原型及其覆盖范围；
- F1–F6 施工所需视觉验收门槛。

本文不修改生产代码，也不改变 D1 的事实和对象边界。

## 1. 视觉方向

### 1.1 产品气质

Atoll 应呈现：

- 可信：状态稳定、边界克制、结果可追溯；
- 专业：高信息密度但不暴露协议噪音；
- 协作：人、Agent、工具在同一阅读轴上平等出现；
- 温和：长期工作界面不使用大面积纯黑或高饱和色；
- 精确：错误、审批、未知和危险动作具有明确语义差异。

不采用：

- 大面积渐变和玻璃拟态；
- 每个对象一张悬浮卡；
- 用大量彩色胶囊表示普通元信息；
- 依靠阴影代替布局层级；
- 大号营销标题和装饰插画占据工作空间；
- 暗色侧栏与亮色主区的强烈割裂；
- 为“AI 感”加入持续闪烁和无意义动画。

### 1.2 参考产品的取舍

借鉴 GenSpark：

- 全局、频道、主工作区、上下文的稳定表面关系；
- 平面消息阅读轴；
- 文件作为来源消息的产物；
- Tasks 作为主视图；
- Context Pane 和 Modal 的任务分工；
- 低噪音 Hover 操作。

不借鉴 GenSpark 的品牌色、灰阶和明暗主题。参考产品只提供交互结构证据，不能成为 Atoll 视觉皮肤的来源。

保留 Atoll 自身：

- 顶部五段品牌色线，但降低存在感；
- 暖色纸张感导航；
- 账本、未知结果和分阶段收敛的可信表达；
- human、agent、tool 的能力差异；
- 技术诊断使用 mono，并保持脱敏。

## 2. 颜色系统

颜色以现有 `src/styles/tokens.css` 和已经稳定的工作台暖色体系为唯一基线。D2 只规范 token 的使用边界，不重新设计一套颜色；当前产品为 Light-only，Dark Theme 在形成独立品牌方案前不进入 F1–F6。

### 2.1 基础表面

| Token | Atoll 基线 | 用途 |
|---|---|---|
| `canvas` / `--bg` | `#d4c5a9` | 应用外部背景、登录环境 |
| `global-rail` / `--surface` | `#f5f0e8` | 全局导航 |
| `channel-rail` | `#fbf8f1` | 频道导航、Context 环境层 |
| `workspace` | `#ffffff` | 三主视图 |
| `raised` | `#ffffff` | Modal、Popover、可操作对象 |
| `hover` | `#f2ecdf` | 行 Hover |
| `selected` | `#e9e0cf` | 当前频道、选中对象 |
| `input` | `#fffefd` | Composer、Field |

表面数量不得继续增加。局部功能不能自创背景色形成新“页面”。

### 2.2 文本与线条

| Token | Atoll 基线 | 用途 |
|---|---|---|
| `text-primary` / `--text` | `#2e2419` | 正文、标题 |
| `text-secondary` / `--text-muted` | `#7a6e5e` | 时间、说明、非关键状态 |
| `text-disabled` / `--text-dim` | `#a89e8e` | 禁用 |
| `line-subtle` | `#ece7dd` | 内容分隔 |
| `line-structural` | `#e8e0d1` | 栏和表面分隔 |
| `line-control` | `#dcd3c4` | 输入和可操作对象边界 |
| `focus` / `--accent` | `#e4002b` | 键盘焦点 |

普通消息不使用 line。只有对象、控制和结构边界使用线条。

### 2.3 强调与语义

| Token | Atoll 基线 | 用途 |
|---|---|---|
| `accent` / `--accent` | `#e4002b` | 主要动作、当前导航细标记 |
| `accent-soft` / `--accent-bg` | `rgba(228, 0, 43, .09)` | 人类身份、弱强调 |
| `agent` / `--agent` | `#0072ce` | Agent 身份与信息 |
| `agent-soft` / `--agent-bg` | `rgba(0, 114, 206, .09)` | Agent 弱强调 |
| `success` / `--online` | `#00a651` | 已确认、在线、可用 |
| `warning` / `--warning` | `#e59600` | stale、等待、临近截止 |
| `danger` / `--danger` | `#e4002b` | 拒绝、失败、危险动作 |

规则：

- `accent` 不是所有按钮的默认背景；
- Agent 身份使用 `--agent` / `--agent-bg`，不为每个 Agent 自创新颜色；
- success 只在已有确认事实时使用；
- uncertain 使用 warning，不使用 danger；
- danger 只表达明确失败、破坏性动作和拒绝；
- 状态同时使用文字或图标，不只依赖颜色。

### 2.4 品牌色线

应用根部保留 3px 五段色线：红、橙、黄、绿、蓝。它只作为 Atoll 身份，不参与状态编码，不随页面重复出现，Modal 和 Pane 不复制。

## 3. 排版系统

### 3.1 字体

- Sans：`Avenir Next`, `Segoe UI`, `PingFang SC`, system sans；
- Mono：`SFMono-Regular`, `Consolas`, `Liberation Mono`, monospace；
- Serif 不再用于工作台主标题，只可保留登录品牌展示。

### 3.2 字级

| 角色 | Desktop | Compact | 字重 |
|---|---:|---:|---:|
| 页面/频道标题 | 18px | 17px | 600 |
| Context 标题 | 16px | 16px | 600 |
| 正文 | 15px | 15px | 400 |
| 控件 | 14px | 14px | 500 |
| 元信息 | 12px | 12px | 400 |
| 技术标识 | 11px | 11px | 500 mono |

最小可见字级为 11px。不得用 8–10px 全大写 eyebrow 承担必要信息。

### 3.3 行高与阅读宽度

- 正文行高 1.55；
- 紧凑列表 1.35；
- 标题 1.2；
- 消息正文最大阅读宽度 760px；
- Composer 可扩至主工作区可用宽度；
- 结构化表格不强行套正文宽度。

### 3.4 文本层级

```text
对象标题 / 人名
正文或主要状态
来源、时间、类型
技术标识与诊断
```

同一区块最多四级；不能同时使用颜色、字号、粗细、胶囊和边框重复强调同一层级。

## 4. 间距与尺寸

### 4.1 间距标尺

使用 4px 基础网格：

| Token | 值 | 用途 |
|---|---:|---|
| `space-1` | 4px | 图标与短标签 |
| `space-2` | 8px | 行内元素、小控件 |
| `space-3` | 12px | 消息内部、表单字段 |
| `space-4` | 16px | 主内容边距、对象间距 |
| `space-5` | 20px | 区块间距 |
| `space-6` | 24px | 主区段 |
| `space-8` | 32px | 空态和大分组 |

禁止出现没有语义原因的 13、17、19、27px 间距。

### 4.2 结构尺寸

| 表面 | 目标值 | 可调整范围 |
|---|---:|---:|
| Global Rail | 52px | 48–56px |
| Channel Rail | 264px | 248–304px |
| Context Pane | 360px | 320–420px |
| Header | 56px | 52–60px |
| Workspace Tabs | 40px | 38–44px |
| Channel row | 40px | 38–44px |
| 最小点击目标 | 36px | 触屏关键动作 44px |
| Composer 初始高度 | 96px | 80–180px 自动扩展 |

Context 的实际宽度由内容和窗口决定，预览型 Pane 可比成员型 Pane 更宽，但同一时刻仍只有一个 Context。

### 4.3 圆角

- 4px：小状态、代码、轻量标签；
- 6px：按钮、频道行、紧凑控件；
- 8px：文件行、任务对象、输入；
- 12px：Modal、较大 Popover；
- 14px：仅原型外部产品窗口，不进入生产 App 根层。

普通页面大区不使用圆角。

### 4.4 阴影

- Workspace、Rail、Context 不使用阴影，只使用结构线；
- Popover：`0 10px 30px rgba(45,35,25,.14)`；
- Modal：`0 24px 70px rgba(30,24,18,.22)`；
- 拖拽对象：轻量 2–8px 阴影；
- Dark theme 降低彩色阴影，只增加黑色透明度。

## 5. 图标系统

- 生产使用统一 16/20px 线性 SVG 图标集；
- stroke 宽度和端点统一；
- 不混用 emoji、Unicode 箭头、文本字符和不同图标库；
- 文件类型允许使用简洁类型缩写作为预览占位；
- 图标按钮必须有 aria-label 和 tooltip；
- 危险动作图标不能脱离文字单独表达影响。

D2 原型使用字符仅作为线框替代，不是最终图标资产。

## 6. App Shell

### 6.1 Global Rail

- 背景比 Channel Rail 深一级；
- 只有全局目的地，无频道局部动作；
- 当前目的地使用弱背景，不使用大面积强调色；
- 账户固定在底部；
- 图标密度稳定，不显示长标签；键盘焦点和 tooltip 补充语义。

### 6.2 Channel Rail

- Header 只显示产品/空间身份和创建；
- 搜索是紧凑跳转控件；
- “我的频道”和“空间”分组；
- 当前频道使用 selected 背景和 2px accent 左标；
- unread 使用实心小计数，当前频道使用柔和版本；
- unavailable、stale、approval 等只显示一个最高优先级提示；
- 行级更多操作 Hover/Focus 出现，不永久挤压名称。

### 6.3 Channel Header

左侧：窄屏返回、频道名、成员/同步摘要。

右侧：频道内搜索、成员、更多操作。SEQ 不作为默认标题栏主元素；进入诊断或同步详情后查看。

### 6.4 Workspace Tabs

- Dynamic、Artifacts、Tasks 使用文字和底线；
- 不使用胶囊分段控件；
- active 状态同时有文字对比和 2px 底线；
- 未读/待处理计数只在存在时出现；
- 切换不触发 Context，也不保留 Composer 占位。

## 7. Dynamic 视觉与交互

### 7.1 普通消息

```text
avatar  name  AI?  time  proactive?
        body
        inline artifacts / structured result
        actions on hover/focus
```

- 无背景和边框；
- Hover 使用极弱整行背景；
- avatar 34px；连续同一发送者可在 D2 后续评审是否合并，但不影响可访问名称；
- 人与 Agent 不按左右区分；
- AI 标识使用弱标签，不使用品牌蓝色大胶囊；
- 主动行为显示 `主动`/`PROACTIVE` 弱标签。

### 7.2 WorkTurn

运行中：

- 当前阶段使用一个 8px 状态点和人类可读文案；
- 展示最新有效进展和“过程 N”；
- cancel/steer/interrupt 在 Hover 或当前 active turn 下可见；
- 不让每条 activity 单独占据主线。

完成：

- terminal 紧跟请求或作为同一消息块结果；
- 文本终态不套卡；
- 文件、表格、审批和失败使用对象边界；
- 过程折叠为一行，进入 Context 查看完整证据。

### 7.3 系统事件

- 使用小圆点、弱色文本、单行；
- 相邻同类系统事件可合并；
- 重要权限/成员变化可以较强提示，但仍不伪装成人类消息；
- raw type 只在诊断展开。

### 7.4 消息操作

Hover/Focus 浮现：回复/Thread（能力支持）、创建任务（能力支持）、保存（事实支持）、更多。

- 操作条贴近消息右上，不改变消息高度；
- 键盘聚焦消息时同样显示；
- 触屏通过更多按钮打开 Bottom Sheet/Popover；
- 不支持的能力不显示，不能长期 disabled 充数。

### 7.5 日期、未读和新动态

- 日期分隔使用文字居中 + 两条 subtle line；
- 未读边界使用 accent 细线和“未读”；
- 用户离开底部时，新动态按钮固定在 Composer 上方但不覆盖正文；
- 回到底部后按钮消失；
- 同步边界使用小状态行，不占用永久 Banner。

## 8. Composer

### 8.1 外观

- 独立完整输入表面，1px control line，8–10px 圆角；
- 文本区和工具栏在同一边界内；
- 初始两到三行，可自动增长至上限；
- 超过上限后只滚动文本区；
- 主发送按钮使用 accent，disabled 使用中性弱色。

### 8.2 内容结构

```text
target / reply context / attachment drafts
multiline editor
attach · format · emoji             send · send options
```

- target 必须始终可见；
- reply/source context 可移除；
- 附件显示名称、大小、上传状态和移除；
- advanced capability 字段使用可展开区域，不与普通消息输入混在一行；
- 错误贴近对应附件或字段，不使用页面顶端统一错误替代。

### 8.3 状态

| 状态 | 表达 |
|---|---|
| offline/stale | 编辑器保留，发送禁用，底部解释 |
| denied/retired | 草稿可复制，编辑/发送禁用 |
| uploading | 附件行展示进度，不锁死文本编辑 |
| waiting confirmation | 附件显示“已上传，等待入账” |
| submit accepted | 消息进入主线 pending，不清空其他频道草稿 |
| uncertain | 原消息原位恢复入口 |

## 9. Artifacts 视觉与交互

### 9.1 主视图

- 使用主工作区，不放进 320px 右栏；
- Header 为标题、数量/状态摘要和 Upload；
- 第二行为搜索与三个以内的高价值过滤；
- 默认列表比卡片网格更适合文件名、来源和版本；图片类型可提供紧凑网格切换，非 D2 必需；
- 行点击打开预览，更多菜单承载下载、附加、来源和诊断。

### 9.2 Artifact row

```text
preview  name                              state
         author · source · time
         version · type · size
```

- preview 48–64px；
- 名称单行，超长省略但 tooltip/详情完整；
- 来源显示可理解摘要，不显示 request id；
- state 只展示异常或等待，available 可以用弱文字；
- version 使用“基于 v1”关系，不制造彩色徽章。

### 9.3 上传

Upload 的默认结果是进入 Dynamic 草稿：

- 选择文件后切回 Dynamic；
- Composer 顶部展示附件；
- 用户补充消息/目标；
- 发送后建立 Operation；
- ticket/daemon/path 只在失败诊断出现。

### 9.4 Artifact Context

- Preview 是视觉主角；
- 元数据、来源和版本放在预览下方；
- footer 固定高价值动作：查看来源、下载；
- 其他动作进入更多；
- 预览加载骨架保持稳定尺寸；
- 不支持预览时显示类型图标、元数据和下载，不显示空白大框。

## 10. Tasks 视觉与交互

### 10.1 主视图

- For me / All 是一级视图选择；
- 状态和类型是次级过滤；
- 默认按“需要你处理、进行中、恢复事项、自动动作”语义分组；
- Completed/Failed 使用过滤查看，不与 active 混成无限时间线；
- New task 只有 task capability 时显示。

### 10.2 WorkItem row

```text
type icon  title                         primary action/status
           assignee · state · source
           due/waiting/local scope
```

- approval 和 recovery 比普通 active 更高优先级，但不依靠巨型红色卡片；
- urgent 使用左边语义线和文字；
- automation 明确显示“本设备”；
- blocked/uncertain 使用 warning，failed 使用 danger；
- 点击整行打开 WorkItem Context。

### 10.3 New task Modal

- 任务描述为第一字段，支持自然语言；
- 来源消息以只读摘要显示；
- 负责人和截止为次级字段；
- 不把 JSON 和后端 capability 名称显示给普通用户；
- 多 provider 时显示可理解的执行者选择；
- 提交后 Modal 关闭，Operation 负责收敛，不在 Modal 中长期等待。

## 11. Context Pane

### 11.1 表面

- 与 Channel Rail 同属环境层，但内容密度更高；
- Header 56px，包含来源返回、标题和关闭；
- Body 唯一滚动；
- Footer 只在存在高价值持续动作时出现；
- Pane 与 Workspace 通过 structural line 分隔，不使用大阴影。

### 11.2 类型变化

| Context | 视觉主角 | Sticky action |
|---|---|---|
| Turn | 状态、过程、终态 | 控制任务 |
| Artifact | 预览 | 来源、下载 |
| WorkItem | 描述、状态、来源 | 审批/更新/恢复 |
| Participant | 身份、能力、当前任务 | 调用能力 |
| Channel | 成员、权限 | 添加参与者/保存设置 |

### 11.3 中窄屏

- 中屏 Context 替换 Workspace；
- 窄屏 Context 全屏；
- Header 返回来源比“×”更重要；
- 从详情打开另一个详情时替换内容并维护短 trail；
- 返回后恢复主视图滚动和焦点。

## 12. Modal、Popover、Menu 和 Select

### 12.1 Modal

- 只用于短创建/确认事务；
- 最大宽度由任务复杂度决定，普通表单约 440–560px；
- 移动端使用有安全边距的全宽或 Bottom Sheet；
- 打开时 focus 进入标题/首字段；关闭恢复触发按钮；
- Escape 关闭可逆事务，高风险确认按明确规则；
- 提交后不在 Modal 里展示长期收敛。

### 12.2 Popover/Menu

- position overlay，不参与父布局；
- 优先向可用空间展开，最小保留 8px 视口边距；
- 内容超高时自身滚动；
- 点击外部和 Escape 关闭；
- 关闭后恢复触发按钮；
- 不使用原生 `<select>` 承载需要定制位置的大型候选列表。

### 12.3 Select

- 控制本身高度稳定；
- popup 使用 portal/overlay；
- 打开不改变按钮、表单或 Pane 高度；
- 支持键盘上下、Home/End、Enter、Escape；
- 当前项、Hover 和 Focus 不只靠背景色区分；
- 320px 下宽度受视口限制，不越界。

## 13. 状态表达

### 13.1 Loading

- 首次加载使用与真实内容同形骨架；
- 缓存恢复时直接显示缓存并在边界说明同步；
- 不清空整页显示大 Spinner；
- 超过合理时间后切为可解释 waiting，而不是无限动画。

### 13.2 Stale

- 使用工作区顶部薄提示或 Header 同步状态；
- 内容保持可读；
- 写入口原位禁用并说明；
- 不把 stale 涂成整页黄色。

### 13.3 Uncertain

- 使用 warning 图标/线条和“结果待确认”；
- 展示已知事实：是否发出、是否 receipt、是否进入数据面；
- 恢复入口靠近对象；
- 不使用 success 或 failure 图标。

### 13.4 Failed

- 错误标题使用人类语义；
- error code 使用 mono 次级显示；
- detail 折叠；
- 恢复动作明确；
- 不把所有失败升级为全局 Toast。

### 13.5 Partial

- 用步骤/检查点显示哪些已完成、哪些未知；
- 例如频道创建：已入账、已 OBS、membership 未出现、serving 等待；
- 已完成事实使用 success，未知使用 warning，明确失败使用 danger；
- 不用单一百分比掩盖非线性收敛。

### 13.6 Denied/Retired

- denied 优先防泄漏，切换为专用访问表面；
- retired 在权限允许时保留历史，但明显只读；
- Composer 不消失，改为只读说明和草稿复制入口；
- 危险状态不能只靠顶部 Banner，相关动作都必须收敛。

## 14. 响应式视觉规则

### 14.1 1280px 及以上

```text
52 Global | 264 Channel | flexible Workspace | optional 360 Context
```

- Workspace 最小可读宽度约 520px；
- Context 打开时可以并列；
- 消息正文控制宽度，不拉满超宽屏；
- Artifacts 列表使用额外空间展示来源和版本。

### 14.2 800px

```text
52 Global | 248–264 Channel | remaining Workspace
```

- Context 打开后替换 Workspace；
- Header actions 收进更多菜单但搜索/成员优先保留；
- Artifacts 来源可换行；
- Tasks 主要动作不被压出视口。

### 14.3 600px

```text
Workspace only
Context replaces Workspace
```

- Global/Channel Rail 隐藏；
- Header 显示返回频道；
- 三个主 Tab 保留；
- Composer 适配软键盘；
- Context、Modal、Select 不越界；
- Artifact/Task 行从三列改为两行。

### 14.4 320px

- Header 只保留返回、频道名、一个更多入口；
- Tab 文案保持完整，不改成难懂图标；
- 过滤两列或纵向堆叠；
- 文件预览缩小但名称和来源仍可读；
- Context footer 动作堆叠或 1 主 1 次；
- 长 technical id 断行或省略，不撑宽页面；
- `documentElement.scrollWidth <= innerWidth`。

### 14.5 200% 缩放

按 CSS 像素可用宽度进入中/窄屏状态；不得保持桌面四栏然后横向滚动。文本放大后：

- 频道名、任务标题和文件名允许两行；
- 控件文字不裁切；
- Sticky Composer/Footer 不覆盖内容；
- Modal 允许页面纵向滚动；
- Focus ring 完整可见。

## 15. 动效

| 场景 | 时长 | 曲线 | 目的 |
|---|---:|---|---|
| Hover/Press | 100–140ms | ease-out | 控件反馈 |
| Context 进入 | 160–200ms | ease-out | 表面关系 |
| Modal 进入 | 160ms | ease-out | 短事务 |
| 状态点变化 | 180ms | ease-out | 状态确认 |
| 新条目插入 | 120ms | ease-out | 定位变化 |

禁止：无限 pulse、弹跳、背景流光、逐字导致整页重排。运行中状态可以使用低频透明度变化，但 reduced motion 下完全静态。

## 16. 无障碍与键盘

### 16.1 焦点顺序

```text
Global → Channel Rail → Header → Tabs → Main Content → Composer → Context
```

Context 在中/窄屏替换主区时，焦点进入 Context 标题；关闭回到触发对象。宽屏并列时不强制 trap，Modal 必须 trap。

### 16.2 焦点样式

- 2px focus 色，2px offset；
- filled accent 按钮使用内外双对比或浅色 ring；
- 不移除浏览器焦点而没有替代；
- Hover 才出现的操作在 `:focus-within` 同样出现。

### 16.3 动态内容

- 整个 Timeline 不使用高频 `aria-live=polite`；
- 仅 terminal、审批、明确失败和关键 Operation 状态进入克制 live region；
- 流式 provisional 不逐字朗读；
- 新动态按钮提供数量；
- Toast 自动消失前可暂停，重要事实必须在持久对象中可回看。

### 16.4 颜色和对比度

- 正文和控件达到 WCAG AA；
- 次级文本不用于必要状态；
- selected、error、success 同时有文本/边线/图标；
- Dark theme 分别验证，不通过简单反相生成。

## 17. D2 交互原型

原型覆盖：

- Global/Channel/Workspace 三层 Shell；
- Dynamic 平面消息、运行中状态、文件和结构化终态；
- Composer；
- Artifacts 聚合列表；
- Tasks 的审批、运行中、恢复和本地自动动作；
- Artifact、结构化产物、成员、审批、回合、恢复和自动动作 Context；
- New Task Modal；
- 900px Context 替换和 620px 单表面响应式；
- 当前 Light-only 品牌方案保持一致；暗色主题须经独立品牌设计后另行进入施工；
- reduced motion。

原型不是生产代码，也不代表 task/Thread 等后端能力已存在。所有展示使用 D1 允许的对象语义。

## 18. 原型评审结论

### 成立

1. 三主视图在同一 Channel Header 下切换，用户不会失去频道上下文；
2. Composer 只在 Dynamic 出现，Artifacts/Tasks 获得完整主区；
3. Artifact 以来源、作者、版本和状态组织，比 ticket 表单更接近用户目标；
4. Tasks 可以同时承载审批、运行中、恢复和本地自动动作，并通过类型保持真实差异；
5. Context 在宽屏并列、中屏替换、窄屏全屏的语义一致；
6. 普通内容去卡片后，文件、任务、审批等对象边界更清晰；
7. 暖色环境层和白色工作层保留 Atoll 气质，不复制 GenSpark 品牌。

### 需要在施工中验证

1. 264px Channel Rail 在真实中文长频道名下是否需要 280px；
2. Artifact Preview 对不同格式的真实加载成本；
3. 大历史下 Hover 操作和 Context 打开的渲染性能；
4. 软键盘环境下 Composer 的稳定性；
5. 100+ 成员 Select 的虚拟化和可访问性；
6. Dark theme 的第三方预览内容边界。

### 被拒绝

1. Files/Tasks 点击后打开右侧抽屉；
2. 默认右栏永久展示成员并压缩所有主视图；
3. 每个 provisional process 使用独立消息卡；
4. 文件上传首屏显示 daemon/path/ticket；
5. Tasks 首屏显示 duration/type/payload JSON；
6. Channel Header 永久显示 SEQ；
7. 为 human/agent/tool 分配三套互不一致的卡片风格。

## 19. F1–F6 视觉验收门槛

### F1

- 三主视图空间契约正确；
- Composer 只属于 Dynamic；
- Context Host 与主 Tab 分离；
- 1280/800/600/320 表面组合正确；
- 旧功能在过渡入口仍可访问。

### F2

- Artifact 列表、预览、来源、状态和版本符合本文；
- 上传默认进入 Composer；
- 无 ticket/daemon/path 默认暴露；
- 长文件名和不支持预览降级通过。

### F3

- 普通消息平面化；
- WorkTurn 主线与详情分层；
- Composer、消息操作和回合 Context 通过键盘与窄屏验收；
- 不支持 Thread 时不伪造回复关系。

### F4

- Tasks 使用 WorkItem 语义；
- approvals/runs/recovery/automation 可区分；
- task provider 缺失空态正确；
- uncertain/expired/blocked 状态不混淆。

### F5

- 成员优先管理流程；
- Channel Context 顺序正确；
- Activity/Operation 去重并可返回来源；
- 高风险动作保持明确确认。

### F6

- token 收口，无散落同义颜色/间距；
- Light-only 配色、200% 缩放与 reduced motion 完整；暗色主题不属于 F1–F6；
- 大历史、长列表和真实预览性能达标；
- 全量视觉基线经过人工检查；
- 删除旧右栏资源/定时器布局和重复 CSS。

## 20. D2 完成门禁

- 已定义颜色、排版、间距、尺寸、圆角、阴影、图标和动效；
- 已定义所有主表面和核心对象的视觉语法；
- 已覆盖 loading/stale/uncertain/failed/partial/denied/retired；
- 已覆盖 1280/800/600/320 和 200%；
- 已定义键盘、焦点、live region、对比度和 reduced motion；
- 已有可交互高保真原型；
- 原型遵守 D1 事实边界；
- 已明确各施工波次视觉门禁；
- 没有提前修改生产代码。

## 21. 下一步

D2 完成后，设计阶段 D0–D2 全部结束。

唯一下一步进入施工波次 F1：主工作区语义纠正。

F1 只负责建立真正的 Dynamic、Artifacts、Tasks Workspace View，分离 Context Host，加入可恢复导航状态，并让 Composer 只属于 Dynamic。F1 不提前实现完整 Artifact/WorkItem 索引，也不在同一波次重写所有视觉组件。
