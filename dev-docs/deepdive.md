# Atoll Web F1–F5 施工基线

本项目的深度设计已经由以下文档完成，本文件只负责把它们接入连续施工流程，不重复发明方案：

- `docs/FRONTEND-PRODUCT-IMPROVEMENT-MASTER-PLAN.md`
- `docs/FRONTEND-D1-OBJECT-NAVIGATION-SPEC.md`
- `docs/FRONTEND-D2-VISUAL-INTERACTION-SPEC.md`
- `docs/PRODUCT-INTERACTION-MASTER-PLAN.md`

## 关键决策

1. 保留 Atoll 的协议、fold、OBS、权限与恢复模型，改造发生在产品投影层。
2. 主区固定为 Dynamic / Artifacts / Tasks，Context 是独立详情表面，管理使用 Channel Context 或 Modal。
3. Artifact 和 WorkItem 必须由现有可信事实派生；Mock 可以补完整叙事，但不能伪装真实后端尚未提供的能力。
4. 使用 hash route 表达频道、主视图和稳定 focus；草稿、过滤器、弹层和敏感数据不进入 URL。
5. 沿用 Atoll 现有暖色、品牌红、Agent 蓝与五色品牌线，不复制参考产品配色。
6. F1–F5 顺序施工，每个波次保持现有 A–E 能力可达并运行相关测试。

## 不变量

- 系统 Actor 默认隐藏。
- 权限撤销后不泄漏其他频道缓存。
- 文件 ticket、daemon、path 不进入普通产品视图。
- 本地 timer 明确标注为本设备事实。
- Thread 没有正式关系事实时只提供回合详情，不伪造社交回复。

