# 当前执行状态（2026-09-18）

本页记录本轮监督裁决，不代表完整版本通过。产品基线 `2746d9e`。

## 已提交

- `fb87acd`：历史物理页跨 yield 原子发布。
- `1ac3141`：零行筛选供给显示加载及失败重试。
- `41f9c92`：离线零行视图继续读取深层本地缓存；主树相关 77 项通过。
- `2746d9e`：实时 coverage 补齐 Meta gap 后恢复 current；Reading 单持有未接受的阅读回执。主树相关 141 项、build 通过。独立 detached 同提交 N1–N4 4/4、N4 重复 20/20、build 通过；只清当前筛选的 exact identities，过滤外通知保留，物理 cursor 不推进。

## 未关闭与当前动作

| 项目 | 已证事实 | 当前动作 |
|---|---|---|
| 吸底时点击状态闪屏 | layout-choice/fold/details 被错误归类为 Reading navigation，导致 following 被冷 browsing 容器替换；多种 live-sibling bridge 均被 actual paint 否决 | Presentation choice 统一保持原 mode/adapter；native input 与 focused edit 才取得 browsing，不逐按钮补 transition |
| 浏览态 progress 与展开交错闪屏 | 正式测量撤走 normal-flow 行导致高度塌陷、native clamp；与吸底交接是两条链 | 单树原位测量候选冻结，性能 owner 独立审核，尚未合入 |
| 进入后上滑反跳 | 旧恢复动作在后续用户 input epoch 后提前完成 | 旧候选拒绝：全局 1px 门、输入单位遗漏、settled 永久等待；owner 修订，独立审核并行 |
| 冷频道完整弱网链 | 深缓存缺陷已提交；断线不 abort probe、sync 错误反馈及 IDB 阻塞远端启动另有候选 | 独立候选验证、待审；不能把缓存修复称为整个冷频道关闭 |
| 历史平滑接入 | 慢网 Loading 到真实高度过渡有证据；旧 bridge 依赖 transition 事件可永久留层 | 修动画完成/取消与 activation 退出，未准入 |
| 嵌套 child progress | child 变化未可靠发布到可见 root 的增量签名 | 模型 owner 隔离修复与回归，不以全量重建替代依赖修正 |
| 文档/设备 | 文档拓扑过时；Chromium 移动模拟有限通过，真机不可用 | 修正文档对 native-armed 与 content-control 的区别；不签真机通过 |

## 监督约束

实现与独立审查并行；root 负责裁决、精确合入与当前版本复核。20 分钟 durable 闹铃已续设；关键产物到达即处理，不等下一次闹铃。不前台轮询，不修改后端，不重启共享服务，不把隔离候选结果冒充主版本通过。
