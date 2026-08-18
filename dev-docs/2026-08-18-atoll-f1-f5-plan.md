# Atoll Web F1–F5 实施计划

状态：F1–F5 已全部完成；F6 后续收口也已于 2026-08-18 完成，下一步为发布审查与真实部署边界验证。

## 施工顺序

| 波次 | 目标 | 核心产出 |
|---|---|---|
| F1 | 主工作区语义 | 三主视图、Context Host、hash route、响应式表面 |
| F2 | 产物与文件 | Artifact 索引、来源、预览、上传进入草稿 |
| F3 | 动态与回合 | 平面消息、过程分层、回合详情、消息操作、Composer |
| F4 | 工作任务 | WorkItem 索引、任务主视图、创建与详情、自动动作归类 |
| F5 | 管理与活动 | 成员优先 Channel Context、创建 Modal、Activity/Operation Center、搜索返回来源 |

## 验证命令

- 单元测试：`npm test`
- 浏览器测试：`npm run test:browser`
- 构建：`npm run build`
- 全量：`npm run test:all`

每个波次先运行相关测试；F5 后执行全量、视觉与真实浏览器验收。
