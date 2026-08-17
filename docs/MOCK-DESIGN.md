# atoll-web 三层 Mock 设计

状态：阶段 D 实现基线
日期：2026-08-17
完成标准：[PHASE-A.md](PHASE-A.md)

## 1. 设计目标

Mock 是浏览器可连接的、确定性的 atoll 内存替身。它必须复现产品依赖的业务闭环，而不是只返回几份静态 JSON。产品代码只访问身份 HTTP、WS v2、OBS 和 `/files`；`/mock/*` 仅供测试驱动器使用。

## 2. 分层与依赖方向

```text
浏览器产品代码
  │ identity HTTP / WS v2 / OBS / files
  ▼
mock/server.mjs                 协议适配与进程生命周期
  ├── mock/protocol.mjs        严格字段、帧、OBS、HTTP 编解码
  ├── mock/domain.mjs          唯一可变业务状态与领域命令
  └── mock/scenarios.mjs       初始场景、故障计划和确定性时钟配置

浏览器测试驱动器
  │ /mock/control/*
  └──────────────────────────► 场景控制层 ─► 领域命令
```

依赖只能从 server 指向三层模块。protocol 不读取场景；domain 不依赖 HTTP/WebSocket；scenarios 只生成数据和故障配置，不持有 socket。

## 3. 协议层

### 3.1 身份 HTTP

严格支持登录、注册和退出。会话使用 HttpOnly Cookie；未认证的 OBS 与 WS upgrade 拒绝。产品代码不得读取 Cookie。

### 3.2 WS v2

- 第一帧必须是 `attach`；
- business frame 必须带 `channel_id`；
- 上行字段闭集严格拒绝未知字段；
- 下行只生成 `feed`、`receipt`、`error`、`observe_ended`；
- 帧最大 512 KiB；
- receipt 只确认接收，不代表领域状态已经投影；
- 每条连接维护 principal、attached、observed channels 和 replay cursor。

### 3.3 OBS

支持真实后端现有六类地址：space channels/principals/daemons/decls 和 channel profile/actors。Mock 额外提供 membership 的产品补缺投影时，必须标记为 `mock_extension`，产品适配器可替换，不能伪称真实 atoll 已有该路由。

所有 observation 保留 `complete`。profile 不存在返回空 items；actors 在频道不 serving 时返回 `not_serving`，不伪造空名册。

### 3.4 文件数据面

资源 frame 只签发短期、单用途 ticket；字节通过 `/files/{address}?t=` 传输。控制接口和状态快照不返回文件内容或设备 key。

## 4. 领域状态层

唯一状态对象 `MockDomain` 持有：

- `principals`、`sessions`；
- `channels`：声明、profile、父子关系、open/retired；
- `memberships`：principal、channel、actor、role、status；
- `rosters`：Actor 声明、bound、device testimony；
- `feeds`：每频道独立单调 seq；
- `requests`：open/closed、sender、audience、terminal；
- `approvals`；
- `decls`、templates、overlays、devices、bindings；
- `resources`、file blobs、tickets；
- `timers`；
- `clock`、`seed` 和稳定 ID 计数器。

### 4.1 读取资格

连接可以接收某频道 feed，当且仅当：

```text
membership(principal, channel) == active
OR channel in connection.observed_channels
```

`c0.lobby` 永远不授予已登录 root 的普通 membership。observe 能力未启用时不能通过空间频道存在性绕过读取资格。

### 4.2 写入资格

所有 business frame 在执行时重新检查 active membership、频道 present/open 和动作权限。撤销 membership 后，同一连接下一帧立即返回 `forbidden`。

### 4.3 写入流水线

```text
校验协议与资格
  → 返回 accepted receipt
  → 执行/排队领域命令
  → 追加该频道 feed
  → 延迟更新 OBS 投影
  → 推送给此时仍有读取资格的连接
```

receipt、feed、OBS 三个延迟轴独立配置。错误发生在 receipt 后时必须通过失败终态或投影状态表达，不能再发送第二个关联不清的 error frame。

### 4.4 系统 Actor

- 每个普通频道都有 `system` 和 `coreactor`；
- c0 额外有 registrar seat 与 svcactor；
- system actor 处理 introduce/remove/restart；
- coreactor 处理当前频道的子频道 create；
- registrar 处理空间登记和根频道治理；
- 它们存在于 roster 和路由中，但由产品展示过滤器隐藏。

## 5. 场景控制层

### 5.1 启动选择

`ATOLL_MOCK_SCENARIO=<id>` 选择初始场景，默认 `multi-channel`。`ATOLL_MOCK_SEED` 固定 ID 和事件序列，`ATOLL_MOCK_LIVE_INTERVAL_MS` 仅用于人工演示；自动测试使用虚拟时钟。

### 5.2 控制 API

控制 API 只在 Mock 中存在：

- `GET /mock/control/catalog`：列出场景与故障；
- `GET /mock/control/state`：返回去敏状态摘要；
- `POST /mock/control/reset {scenario, seed}`：原子重置；
- `POST /mock/control/advance {ms}`：推进虚拟时间并触发到期任务；
- `POST /mock/control/action {type, ...}`：注入 drop、approval、revoke、retire、pulse；
- `POST /mock/control/fault {target, mode, delay_ms, count}`：配置下一次故障。

旧的 `/mock/drop`、`/mock/approve`、`/mock/introduce` 在迁移期保留为控制 API 的快捷别名，产品代码禁止调用。

### 5.3 确定性

- 场景初始时间固定；
- 领域 ID 使用 seed + 单调计数器，不使用随机 UUID；
- 自动任务只由 `advance` 推进；
- 状态 reset 清除 session 以外的全部领域数据；
- 相同场景、seed 和动作序列必须得到字节等价的去敏状态摘要。

## 6. 场景定义

八个阶段 A 必需场景以 PHASE-A 为准。阶段 C 已实现 `actor-capability`、`long-running`、`control-conflict`、`actor-lifecycle`、`approval-schema`、`approval-expired`、`approval-conflict`。阶段 D 已实现 `channel-governance`、`channel-governance-delay`、`channel-governance-denied` 和 `actor-governance`。阶段 E 已实现 `space-administration`、`space-administration-denied`、`device-governance`、`resource-workflow`、`resource-ticket-expired`、`scheduled-action` 和 `scheduled-action-denied`；旧 `space-governance` 名称仅保留兼容。

场景之间通过配置组合差异，不复制服务器分支。场景配置只描述初始实体、membership、fault 和 scheduled events。

## 7. 故障模型

支持四类故障：

- `reject`：receipt 前稳定 error；
- `delay`：独立延迟 receipt、feed 或 OBS；
- `drop`：在指定帧之前/之后断开连接；
- `partial`：OBS `complete=false` 或领域动作部分完成。

故障按 target、mode、剩余次数匹配并消费。未识别故障配置必须返回 400，不能静默忽略。

## 8. 测试结构

- `tests/mock-protocol.test.js`：闭集字段、帧限制、OBS 形状；
- `tests/mock-domain.test.js`：membership、feed 隔离、生命周期、虚拟时间；
- `tests/mock-phase-c.test.js`：Describe、typed 调用、cancel、稳定错误和 steer CAS；
- `tests/channel-governance.test.js`、`tests/mock-governance.test.js`：治理路由、闭集 payload、投影收敛和保护规则；
- `tests/mock-scenarios.test.js`：场景完整性、reset、确定性；
- `tests/contract-fixtures.test.js`：真实 atoll JSON fixture 漂移；
- `tests/e2e.mock.test.js`：协议纵向闭环；
- `tests/browser/*.spec.js`：真实浏览器产品验收。

测试应通过状态条件与虚拟时间推进等待，不依赖大于业务最小延迟的固定 sleep。

## 9. 安全边界

- 状态摘要删除 session token、设备 key、ticket 和文件字节；
- 错误详情不得回显密码；
- `/mock/control/*` 只在 Mock 进程存在，真实代理配置不得转发；
- 设备列表只用 OBS 安全投影；当前真实 registrar `device.list` 含 key，因此正式 UI 在后端补缺前不可调用；
- 文件 ticket 不写入 feed、日志、快照和截图基线。

## 10. 迁移步骤

1. 提取 protocol 常量、校验和构造器；
2. 引入 MockDomain 并迁移频道、membership、roster、feed；
3. 将 socket 广播改为按连接资格投递；
4. 引入 scenario catalog、控制 API 和虚拟时钟；
5. 迁移现有 fixture 与快捷控制路由；
6. 增加契约、领域、场景和浏览器测试；
7. 删除 server 中重复状态和随机业务 ID。
