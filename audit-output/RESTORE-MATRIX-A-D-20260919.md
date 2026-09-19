# `fae8b70` top-level Vitest A–D migration report

基线：`fae8b7010afd1b3a950bc455ba6a577b65378cda`。当前审计头：`e5f90f3`。
范围为 `tests/` 顶层 basename A–D 的 `*.test.js` / `*.test.jsx`，不含
`tests/browser/`。

## 完整 case ledger

基线包含 **42 套件、365 条声明**（含 3 条 `it.each`）。逐用例记录在
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md)：每行都有基线
文件/精确名称、用户能力、架构不变量、当前公开 owner、基线 setup/action/observable
锚点、当前结果和 disposition/evidence。不存在 suite 级摘要代替 case 的情况。

当前逐 case 计数：**237 PASS / 12 REGRESSION / 116 BLOCKED**。

- `PASS`：在当前公开 owner 上有等价行为证据，迁移到现有测试/owner。
- `REGRESSION`：当前 owner 已被保留断言复现为红，形成产品缺口 packet；不得改断言求绿。
- `BLOCKED`：尚未找到当前公开 owner 的等价证据，形成产品缺口 packet；绝不表示能力废弃，也不删除/skip。

## 强制撤回的旧结论

以下能力不再按“旧 API 删除”结案，ledger 中明确保留为 BLOCKED/product gap，直到产品
owner 或当前公开 owner 证据出现：

- `control-actions.test.js`：跨刷新 principal 隔离、sending→uncertain 恢复和可序列化错误。
- `dynamic-form.test.js`：JSON Schema typed fields、后端控制词 payload。只有“resolve
  帧字段闭集”可由当前协议 vocabulary 证据迁移；用户可操作动态表单仍是 gap。
- `cursors.test.js`：未读/read/notification/viewport cursor 的 monotone/high-water、
  principal/world 验证、边界 clamp 等可靠性约束。已迁移的 live-arrival 子集仍逐行列证据，
  未覆盖的行保持 BLOCKED；没有恢复旧 cursor API/store。

## 产品系统 surfaces

### Activity Center

当前 `feature-search`/rail 只覆盖可见频道搜索和 Agent activity projection。跨频道
Operation Center 的事实索引没有公开 owner；`activity.test.js` 的 Operation 去重和
搜索覆盖行在 ledger `AD-002`–`AD-004` 保持 BLOCKED。不得恢复旧 `activity.js` 第二份
事实 store。

### node version/update

`channel-list.test.jsx` 的 `AD-202`、`AD-203` 保持 BLOCKED：当前
`WorkspaceLayout`/`WorkspaceApp` 没有 node update port/UI。`VersionIncompatible` 只
是协议终止页，不能冒充节点升级能力，也不恢复旧 `update` prop/store。

### channel restart

当前公开 owner 是 Composer command port。ledger `AD-348` 迁移到
[`composer-command-port.test.js`](../tests/composer-command-port.test.js)：`/restart`
发给 channel system actor，目标 Agent 在 `payload.member`，无目标/权限时拒绝；未恢复
旧 AppShell 转发或 Agent 自重启路径。

## 验证与边界

本分区新增的 Composer/capability 当前 owner 测试执行为 2 files / 11 tests（命令见提交
记录）。全 A–D 逐 case ledger 的 BLOCKED/REGRESSION 不得被汇总绿掩盖；产品缺口 packet
必须包含最小复现、基线与当前差异、首个公开 owner 分歧和受影响能力/不变量。

本轮只改本分区测试/报告；没有恢复旧模块/API/store/compat，没有导出私有 helper，也没有
修改 vendor、package、lockfile 或产品代码。
