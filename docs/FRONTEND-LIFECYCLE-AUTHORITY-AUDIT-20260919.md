# 当前前端生命周期、数据与权威审计

基线：ea6735c（随后7dfa0f4只更新执行账）。这是当前源码入口清单与审查合同，**不是已全部审完的结论**。旧重构文档只提供设计意图；与当前用户要求、代码或真实证据冲突时逐项裁决，不沿用旧验收状态。

## 逐域清单

| 域及当前源码入口 | 必须维护的生命周期 / 数据 | 应有的权威边界（待逐调用链核实） |
|---|---|---|
| 身份：useAtollSession / identity / workspace-bootstrap-cache | 启动、session确认、登录、退出、失效；principal与缓存展示资料 | 服务端session确认身份；缓存不可自行授予访问权；旧异步结果不得恢复已退出身份 |
| 连接及访问：wire / useChannelDirectory / roster / channel-access | 连接epoch、server world、成员资格、授权、撤权、重连；Meta、目录 | 连接存在不等于频道授权；Meta不等于正文；未知不等于空或拒绝 |
| 同步：sync-session / useChannelFeed | attach、缺口、catchup、取消、失败恢复；coverage、head、generation | 同步义务不因某次请求完成而消失；max seq不能代替完整coverage |
| 持久缓存：feed-cache | open、owner/world选择、读写事务、提交、取消、trim、恢复；正文与coverage | 同一事务验证owner/world并提交；内存发布必须在有效提交之后；缓存不授予当前网络权限 |
| 正文事实：channel-replica / fold / fold-admission | live/cache/history合流、重复、冲突、终态、trim；canonical envelope及closure | 唯一事实归并规则；compact closure只能证明闭合，不能冒充完整答复 |
| 历史供给：history-scheduler / history-demand | 排队、执行、buffer、release、需求进展、取消、失败；reservoir、游标、budget | 远端EOF、buffer耗尽、需求满足分开；有未满足需求必须推进或显式阻塞/失败 |
| 展示投影：timeline-projection / conversation-presentation / history-presentation-admission | filter/scope变化、候选、提交、替换；source revision、row identity | 投影是事实与展示选择的派生结果；零匹配不能直接证明源为空；发布不能丢失未消费义务 |
| 阅读：reading-session / useReadingSession / view-session | activation、initial、following、browsing、导航、恢复、接管；语义意图及epoch | 用户意图由Reading决策；后台数据不得擅自导航；一次用户接管使旧导航失效 |
| 列表：FollowingTailList / LegendMessageList / navigation coordinator | host交接、测量、准入、resize、回收；DOM、尺寸证书、滚动位置 | 几何执行与导航决策分离；所有写入有来源；旧测量/命令不能作用新身份 |
| 布局与内容选择：Surface / Composer / MessageLayoutState | mount、输入增长、展开折叠、focus、selection、IME、viewport变化 | 内容选择不应伪造导航；浮层不应通过遗留observer重写阅读空间；预备DOM不得产生业务副作用 |
| 通知：notification-policy / cursors / activity | 相关事件到达、去重、确认、持久化、重载；频道attention high-water | 与本人相关资格统一；确认改变权威状态，不是临时隐藏；历史重放不等于新到达；物理已读不是通知确认 |
| 等待与控制：waiting-presentation / work-items / task-controls | 请求、processing、terminal、取消、重启、历史补证；任务身份和命令权限 | lifecycle事实与正文完整度分开；展示存在不授予操作权；完整终态不能被旧page覆盖 |
| 发送与编辑：useSubmissions / outbox-store / request-owner | admission、attempt、durable接受、传输、receipt、canonical到达、retry、编辑锁 | 稳定消息身份与每次尝试分开；授权在提交时有效；旧continuation不能覆盖新attempt；receipt不产生新导航 |
| 文件及资源：FilesPanel / ArtifactsView / channel-file-transfer / resources | 选择、上传、取消、跨频道切换、下载、预览；目标和资源引用 | 所有入口使用绑定目标的操作生命周期，不能只覆盖Composer附件；迟到结果不能写新目标 |
| 能力及管理：agent-probe-lifecycle / capabilities / ui-words / governance | 探测、超时、失效、重试、管理命令、响应；能力快照 | 超时/未知不是空能力；频控和在途归属明确；不得让连接抖动放大请求 |

## 每域必须交付的审计证据

1. 创建与销毁条件；身份键；合法状态转移；失败、取消、替换、重试如何终结或继续。
2. 每个权威字段的全部写入点、读取者及持久化位置；区分事实、用户意图、派生投影、UI反馈。字段同名不等于同一语义。
3. 所有await/订阅/计时器/observer/render提交的过期校验；检查旧结果还能否越权写入。
4. 上游给了什么，下游还欠什么；谁持有未完成义务，谁负责唤醒；禁止层层局部done而整体停住。
5. 幂等、容量、资源释放和数据保留；重复与乱序不能改变既有终态，取消不能误伤其他消费者。
6. 离线、弱网、卡住的IDB、后台标签、撤权、换频道/过滤、零匹配、迟到正文、窗口变化；每种情况必须有确定动作或明确可见的失败原因。
7. 旧控制路径是否真的无生产调用；删掉类名或新增包装不算移除第二权威。

## 当前已知结论与待审

- 已证违约：远端EOF但reservoir148未消费、短列表2行且整体idle；e52a41a/ea6735c修复两个确定断点。尚不能据此证明整个需求模型的持续推进性质。
- 新诊断候选被root拒绝：任意三行门不能判underfill；有预取buffer不代表当前欠展示；未知hasOlder不能直接解释为权威EOF。
- 三域并行只读审查：数据/供给、阅读/布局、业务/通知/操作。root核对跨域接缝，并将每条发现归为已合问题、候选未合、设计缺口或旧文档冲突，不按报告条数累加bug。
- 测试用于验证机制实现及反例；通过数不是权威唯一、生命周期完整或全系统交付的证明。
