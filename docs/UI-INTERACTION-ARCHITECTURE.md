# atoll-web UI 交互架构

状态：首轮工作台改造已施工
日期：2026-08-18
参考产品：GenSpark GenTeam
上位产品规范：[PRODUCT-INTERACTION-MASTER-PLAN.md](PRODUCT-INTERACTION-MASTER-PLAN.md)
组件规范：[UI-COMPONENT-REFACTOR-PLAN.md](UI-COMPONENT-REFACTOR-PLAN.md)
分层设计基准：[GENSPARK-DESIGN-BENCHMARK.md](GENSPARK-DESIGN-BENCHMARK.md)
前端改进总计划：[FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md](FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md)
D1 对象与导航规格：[FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md](FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md)
D2 视觉与交互规格：[FRONTEND-D2-VISUAL-INTERACTION-SPEC.md](FRONTEND-D2-VISUAL-INTERACTION-SPEC.md)

## 1. 文档定位

本文定义 atoll-web 的产品表面如何组织，不重新定义 Atoll 协议和后端能力。

组件规范回答“控件如何复用”，本文回答：

- 用户当前的主任务在哪里；
- 什么内容与主任务并列，什么内容接管主任务；
- 短事务、局部操作、持续详情和危险确认分别使用什么容器；
- 账本事实默认展示到什么深度；
- 桌面和窄屏如何保持同一用户旅程。

## 2. 设计结论

atoll-web 不是后端调试器，也不是隐藏账本事实的普通聊天工具。默认界面必须优先呈现人能理解的协作事实，协议细节通过渐进展开保留。

核心原则：

1. 导航稳定：频道切换不与频道管理混在一起。
2. 主任务唯一：中栏始终是当前频道的主要工作内容。
3. 详情有来源：Actor、任务、消息和管理详情进入统一上下文区。
4. 卡片有成本：普通消息保持平面，只有结构化对象、审批、附件和错误获得边界。
5. 状态可解释：工作中、等待、失败和终态必须可见，但完成后的协议过程默认折叠。
6. 窄屏逐层进入：空间不足时替换当前层，不压缩三栏。

## 3. 产品表面决策矩阵

| 用户任务 | 容器 | 示例 | 禁止 |
|---|---|---|---|
| 一级导航 | Channel Rail | 频道、空间中的可发现频道 | 用弹窗切频道 |
| 频道主视图 | Workspace Tabs | 账本、文件、任务 | 把三者堆成标题栏按钮 |
| 持续上下文 | Context Pane | 成员、Actor 详情、资源、任务、管理 | 小弹窗承载长列表 |
| 短创建事务 | Modal | 新建频道的输入阶段 | 与频道管理共用入口 |
| 局部对象操作 | Popover | 频道操作、消息操作 | 永久占据标题栏 |
| 高风险确认 | Inline Confirmation | 退役频道、终止 Actor | 直接执行或浏览器 alert |
| 窄屏次级任务 | Full-screen Layer | 资源、成员、管理、Actor 详情 | 小抽屉挤压主区 |

首轮施工已完成 Channel Rail、Workspace Tabs、Context Pane、Popover 和 Full-screen Layer。当前“文件/任务”标签仍只打开 Context Pane，不符合主视图标签的空间契约；该问题及后续对象模型见分层设计基准。新建频道 Modal 与创建收敛 Pane 的混合流程保留为后续施工项。

## 4. 工作台信息架构

```text
Channel Rail
└─ Workspace
   ├─ Channel Header
   │  ├─ Channel Identity
   │  ├─ Members
   │  └─ Channel Actions
   ├─ Workspace Tabs
   │  ├─ 账本
   │  ├─ 文件
   │  └─ 任务
   ├─ Primary Content
   └─ Composer
└─ Context Pane
   ├─ Roster
   ├─ Actor Details
   ├─ Resources
   ├─ Scheduled Tasks
   └─ Channel Governance
```

“文件”和“任务”在首轮仍以 Context Pane 展示，避免伪造没有完整内容模型的主页面；当资源和任务模型具备聚合查询后，再迁入真正的主视图。

## 5. 账本呈现语法

### 5.1 普通协作条目

- 使用平面行，不使用聊天气泡；
- 身份、时间和类型形成稳定元信息行；
- 正文与身份左边缘对齐；
- 自己与其他成员不通过左右气泡区分，避免把群体账本伪装成私聊。

### 5.2 运行中任务

- “正在处理”与当前状态可见；
- 取消、调整方向和打断只在实际可用时出现；
- provisional response 中的状态与 process 在运行期间可见，避免用户误以为卡死。

### 5.3 已完成任务

- 终态结果直接可见；
- provisional response 中的阶段和工具过程默认折叠为“过程记录 N”；
- 原始 JSON 和脱敏详情继续按需展开；
- 失败结果保持高对比错误边界。

### 5.4 独立对象

审批、结构化终态、附件、错误和需要继续操作的任务控制允许使用卡片。普通文本和 Actor pulse 不使用卡片。

### 5.5 瞬时状态

Mock 或后端明确标记 `payload.transient=true` 的同类型、同发送者状态只展示最新一条。它用于在线、工作中和演示进度，不影响请求、响应、审批、业务事件或系统叙事的账本保留。

## 6. Context Pane 契约

- 桌面宽屏与主账本并列；
- 900px 以下接管 Channel Rail 右侧的全部工作空间；
- 640px 以下覆盖整个视口；
- 必须有标题、关闭入口和唯一滚动区；
- 关闭后返回账本，不改变频道；
- 同一时刻只允许一个上下文任务；
- Actor 详情保留成员刷新能力；
- 后续线程、消息详情和任务详情必须复用此容器，不再创建新的抽屉体系。

## 7. 响应式状态机

### ≥ 1050px

频道导航、账本、上下文三栏并列。

### 641–900px

频道导航保留；打开上下文后，上下文接管主工作空间。

### ≤ 640px

默认显示紧凑频道导航和账本；打开上下文后形成全屏任务层，通过关闭按钮返回。

所有状态必须满足 `documentElement.scrollWidth <= innerWidth`。

## 8. 视觉语言

- 使用暖白和低对比边界，减少大面积深色导航；
- 强调色只用于主要动作、危险和真实选中状态；
- 主导航选中使用柔和背景与左侧标记，不使用高饱和整块胶囊；
- 默认字体以清晰的 sans 为主，技术字段继续使用 mono；
- 右栏和左栏属于同一暖色表面，中栏使用白色突出工作内容；
- 保留 Atoll 顶部品牌色带，不复制参考产品品牌皮肤。

## 9. 已推翻的假设

1. “拆成组件就代表 UI 已规范化”：错误。组件必须服从产品表面和响应式状态机。
2. “三栏缩窄后没有横向滚动就算响应式”：错误。可见不代表可用，次级任务必须逐层接管。
3. “所有频道能力都应作为标题栏按钮”：错误。低频操作进入 Popover，主视图使用稳定 Tab。
4. “账本事实必须全部默认展开”：错误。事实必须可达，但完成后的技术过程不应抢占阅读主线。
5. “自己发送的消息应像私聊一样靠右”：错误。群体账本应保持统一阅读轴。

## 10. 后续施工顺序

1. 新建频道采用 Modal 输入、Context Pane 展示四阶段收敛；
2. 建立消息/任务详情 Pane 与来源返回；
3. 将文件和任务升级为真正的主视图，而非只打开 Context Pane；
4. 增加频道内搜索与全局 `⌘K` 搜索；
5. 将 Mock pulse 升级为多 Actor、有条件变化和产物演进的叙事场景；
6. 增加消息 Hover 操作和任务创建入口。

## 11. 验收证据

- 1280px：频道、账本、成员三栏并列；
- 800px：Context Pane 完整接管工作区；
- 600/320px：Context Pane 为全屏任务层；
- 长任务：过程和控制可见；
- 已完成任务：终态可见、过程默认折叠；
- 审批：决定、截止时间和处理结果保持可见；
- 全量阶段 A–E E2E、视觉基线和 production build 必须通过。
