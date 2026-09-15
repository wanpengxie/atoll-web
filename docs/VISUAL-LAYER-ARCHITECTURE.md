# Atoll Web 视觉层架构（历史入口）

> 2026-09-15 的第一版已被本轮完整复核取代。第一版引入的 `ViewportLayoutPort`、DOM 锚点轮询和多次像素补偿会与 Virtuoso 自己的布局系统竞争，已经删除。

交互运行层总设计与真实施工状态是：

[IM 交互运行层总设计](./IM-INTERACTION-RUNTIME-ARCHITECTURE.md)

当前视觉专项权威文档是：

[视觉与交互完成规格](./VISUAL-INTERACTION-COMPLETION-SPEC.md)

后续视觉与交互修改必须以该文档的不变量、行为矩阵、施工清单和禁止回归项为准。数据连接、缓存与 History Scheduler 的语义另行设计，不再混进视觉层。
