# 连续施工规则

1. 以 `dev-docs/feature-list.json` 为机器可读进度，以产品总计划和 D1/D2 为规格来源。
2. 不覆盖或回滚当前工作树中已有改动；在同一实现上增量施工。
3. 未经用户明确要求不创建提交，避免把工作树中既有改动错误归入新提交。
4. Feature 只有在实现和对应验证均成立后才能设为 `passes: true`。
5. 每个波次完成后更新 `claude-progress.txt`、`feature-list.json` 和 `.claude/CLAUDE.md`。
6. F1–F5 全部完成前不得宣告总目标完成。

