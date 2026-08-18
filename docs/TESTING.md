# atoll-web 测试指南

日期：2026-08-17
阶段基线：[PHASE-A.md](PHASE-A.md)、[PHASE-B.md](PHASE-B.md)、[PHASE-C.md](PHASE-C.md)、[PHASE-D.md](PHASE-D.md)

atoll-web 的产品代码只访问身份 HTTP、WS v2、OBS 和文件数据面。日常开发使用分层 Mock；真实 atoll 只验证 Mock 无法证明的部署、并发、持久化和安全契约。

## 1. 一条命令完成阶段 A–E 验证

首次运行真实浏览器测试前安装 Chromium：

```bash
npm install
npx playwright install chromium
```

完整验证：

```bash
npm run test:all
```

它依次执行：

1. Vitest 协议、模型、Mock、fixture 和纵向闭环测试；
2. Playwright 启动真实 Chromium，连接 Vite 与 Mock 完成产品 E2E；
3. Vite 生产构建。

Playwright 套件同时包含 11 条 UI 视觉/边界用例（含“新建频道”独立任务基线），以及 `layout-responsive.spec.js` 的 3 条结构布局门禁：1280px Actor 详情、320px 核心导航/四标签面板、320px @成员浮层。截图位于 `tests/browser/ui-visual.spec.js-snapshots/`；只有人工审查并登记过的视觉变化才允许更新。

任何一步失败都视为当前产品基线回归。阶段 B 完成审计还必须执行第 9 节的静态检查。

## 2. 测试分层

| 层级 | 主要文件 | 证明内容 |
|---|---|---|
| 产品契约 | `tests/capabilities.test.js` | Manifest ID、阶段、场景引用和完成证据完整 |
| 前端协议 | `frame/envelope/wire` tests | WS v2 帧闭集、receipt/error 对账、重连 |
| 前端模型 | `fold/roster/cursors/feed-cache/channel-access/submissions/capabilities/dynamic-form/task-controls/control-actions/channel-governance` tests | request-id fold、频道访问、能力表单、任务控制、治理路由和投影收敛 |
| 终态渲染 | `tests/structured-result.test.js` | 文本、空成功、失败、registrar、describe、脱敏与大数组摘要 |
| 管理路由 | `tests/management-actors.test.js` | c0 registrar、普通频道 coreactor 和 system 精确解析 |
| Mock 协议 | `tests/mock-protocol.test.js` | Mock 上行字段闭集和下行帧形状 |
| Mock 领域/场景 | `tests/mock-scenarios.test.js`、`tests/mock-phase-b.test.js`、`tests/mock-phase-c.test.js` | membership、能力、控制、审批、幂等、虚拟时间和确定性 |
| Mock 治理 | `tests/mock-governance.test.js` | system/coreactor/registrar 改变状态并收敛 OBS |
| 契约漂移 | `tests/contract-fixtures.test.js` | atoll WS、OBS、registrar、describe、ticket JSON fixture |
| 协议 E2E | `tests/e2e.mock.test.js` | 登录、回放、消息、审批、延迟、故障和重连 |
| UI primitives | `tests/ui-primitives.test.jsx` | tabs、选择菜单、确认和焦点的 DOM/键盘行为 |
| 浏览器 E2E | `tests/browser/phase-a.spec.js`～`phase-e.spec.js`、`tests/browser/ui-visual.spec.js`、`tests/browser/layout-responsive.spec.js` | 阶段 A–E 产品闭环、四档视口边界、结构布局门禁和视觉基线 |

只运行快速测试：

```bash
npm test
```

只运行真实浏览器：

```bash
npm run test:browser
```

浏览器失败会在 `test-results/` 保存失败截图、错误上下文和 trace；该目录不提交。

## 3. 启动 Mock 和网页

两个终端分别运行：

```bash
ATOLL_MOCK_SCENARIO=multi-channel npm run mock
```

```bash
npm run dev -- --host 127.0.0.1
```

打开 <http://127.0.0.1:5173>，Mock 账户为：

- 邮箱：`root@atoll.local`
- 密码：`root`（可用 `ATOLL_ROOT_PASSWORD` 修改）

默认人工演示每 8 秒在两个成员频道交替产生动态事件。自动测试将 `ATOLL_MOCK_LIVE_INTERVAL_MS=0`，只通过控制 API 确定性触发。

## 4. 场景选择

启动时通过 `ATOLL_MOCK_SCENARIO` 选择：

```bash
ATOLL_MOCK_SCENARIO=first-login npm run mock
ATOLL_MOCK_SCENARIO=projection-delay npm run mock
ATOLL_MOCK_SCENARIO=permission-revoked npm run mock
```

阶段 A 必需场景：

- `first-login`
- `multi-channel`
- `message-flow`
- `approval`
- `network-drop`
- `permission-revoked`
- `channel-retired`
- `projection-delay`

阶段 B 场景：

- `message-structured-success`、`message-empty-success`、`message-failed`；
- `business-provisional`、`provisional-after-terminal`、`terminal-conflict`；
- `receipt-delayed`、`feed-delayed`、`receipt-lost-feed-landed`；
- `obs-partial`、`real-backend-shape`；
- `actor-capability` 为阶段 B renderer 提供只读 describe 历史，同时为阶段 C 主动能力面板预置数据。

阶段 C 场景：

- `actor-capability`：完整 Describe、结构化订单与动态表单；
- `long-running`、`control-conflict`：turn_id、cancel、steer、interrupt、queue 和故障；
- `actor-lifecycle`：stop/restart/terminate；
- `approval-schema`、`approval-expired`、`approval-conflict`：结构化审批与边界状态。

阶段 D 场景：

- `channel-governance`：频道创建、详情和退役正常路径；
- `channel-governance-delay`：terminal 与 OBS/membership/open 分阶段收敛；
- `channel-governance-denied`：稳定权限拒绝且保留管理上下文；
- `actor-governance`：human/agent/tool 添加、重启、移除和受保护 Actor。

阶段 E 场景：

- `space-administration`、`space-administration-denied`：模板、overlay/profile 与治理拒绝；
- `device-governance`：安全 daemon OBS、一次性 key 和设备生命周期；
- `resource-workflow`、`resource-ticket-expired`：KV、文件 ticket、PUT/GET、过期重取和一次性 PUT；
- `scheduled-action`、`scheduled-action-denied`：虚拟时间触发、取消与无写权限。

列出当前可用场景：

```bash
curl http://127.0.0.1:8832/mock/control/catalog
```

## 5. 场景控制

控制接口只存在于 Mock，产品代码不得调用。

查看去敏状态：

```bash
curl http://127.0.0.1:8832/mock/control/state
```

原子重置：

```bash
curl -X POST http://127.0.0.1:8832/mock/control/reset \
  -H 'Content-Type: application/json' \
  -d '{"scenario":"multi-channel","seed":31}'
```

推进虚拟时间：

```bash
curl -X POST http://127.0.0.1:8832/mock/control/advance \
  -H 'Content-Type: application/json' \
  -d '{"ms":5000}'
```

注入动作：

```bash
# 两个成员频道各产生一条动态事件
curl -X POST http://127.0.0.1:8832/mock/control/action -H 'Content-Type: application/json' -d '{"type":"pulse"}'
curl -X POST http://127.0.0.1:8832/mock/control/action -H 'Content-Type: application/json' -d '{"type":"pulse"}'

# 断线
curl -X POST http://127.0.0.1:8832/mock/control/action -H 'Content-Type: application/json' -d '{"type":"drop"}'

# 撤销 membership
curl -X POST http://127.0.0.1:8832/mock/control/action -H 'Content-Type: application/json' \
  -d '{"type":"revoke_membership","channel_id":"c0.project"}'

# 退役频道
curl -X POST http://127.0.0.1:8832/mock/control/action -H 'Content-Type: application/json' \
  -d '{"type":"retire_channel","channel_id":"c0.project"}'
```

注入下一次协议故障：

```bash
curl -X POST http://127.0.0.1:8832/mock/control/fault \
  -H 'Content-Type: application/json' \
  -d '{"target":"submit","mode":"reject","code":"unavailable","count":1}'
```

支持的 mode：`reject`、`delay`、`drop`、`partial`。测试状态快照不会返回 session、设备 key、ticket 值或文件内容；仅可保留不含凭据的 ticket 方法、地址、过期时间和使用状态用于断言。

## 6. 浏览器验收重点

人工点验与自动化使用同一组断言：

1. 登录后左栏分成“我的频道”和“空间”；
2. root 的成员频道是 `c0`、`c0.project`，`c0.public` 只可发现；
3. 页面任何位置都不出现 `c0.lobby`；
4. system、registrar、svcactor 不出现在业务名册；
5. 切换 c0/project 后标题、历史、输入目标和名册同时改变；
6. 两个频道动态事件互不串线；
7. submit 经 receipt 后入账并出现 provisional、工具活动和终态；
8. 审批按钮提交后出现完成终态；
9. 可发现、权限撤销和退役频道不能继续写入；
10. 断线后恢复 OPEN，账本没有重复项；
11. 刷新页面恢复会话和 cursor。

阶段 B 的 `tests/browser/phase-b.spec.js` 继续证明：

1. 成员、空间、stale、unavailable、denied、retired 的展示和写权限不混淆；
2. partial OBS 不误删，complete OBS 才确认退役；
3. 真实后端不含 membership/principal 扩展时不猜 self，发送 request feed 后才学习；
4. 核心及命名空间 provisional 原样展示，第一终态不被冲突覆盖；
5. receipt/feed 任意先后只出现一个请求，receipt 丢失进入 uncertain 后由 replay 对账；
6. pending 始终属于发送时频道；
7. 结构化、空成功、failed、registrar 和 actor.describe 都有可理解结果，敏感字段被遮蔽；
8. 普通频道 `/channels` 通过 `decl_id=coreactor` 路由。

阶段 C 的 `tests/browser/phase-c.spec.js` 继续证明：

1. Describe 从账本加载/恢复，TypeMeta 的耗时、notes、错误和恢复建议可读；
2. Schema 动态表单跨 OBS 刷新不丢输入，typed payload 与结构化终态保真；
3. cancel 先 receipt 后原任务 cancelled terminal，关闭错误与断线 uncertain 可解释；
4. steer 使用 processing.turn_id，queue/interrupt 是独立账本回合；
5. stop/restart/terminate 无法绕过风险确认，terminal 是动作结果权威；
6. Schema 审批、过期、四类并发/权限错误和外部处理均保留原事实；
7. 刷新重放后长任务、turn_id 和控制资格只保留一份。

阶段 E 的 `tests/browser/phase-e.spec.js` 证明：

1. Actor/频道模板 CRUD 与系统声明保护；
2. overlay 只作用于来源频道，profile terminal 与 OBS 应用状态分层；
3. 设备列表只来自安全 OBS，mint key 仅显示一次且不进时间线/localStorage，绑定/解绑/退役需确认；
4. KV create/read/write/stat/list/delete 完整闭环，list 不错误要求 resource_id；
5. 文件 ticket → PUT、read ticket → GET、ticket 过期重取、附件消息卡和浏览器下载；
6. after/cancel_timer 的本设备记录、刷新持久化、虚拟时间触发入账和取消不触发；
7. 权限失败保留表单上下文和账本错误事实。

## 7. 契约权威与漂移

真实契约权威在相邻 `../atoll` 仓库：

- `platform/subjectgate/frame.go`
- `protocol/message/envelope.go`
- `drivers/gateway/portal/portal.go`
- `platform/obs/plane.go`
- `platform/lagoon/contracts.go`
- `lib/introspect/introspect.go`

`tests/fixtures/atoll-contract-v2.json` 是从上述源码确认的最小 JSON fixture。后端契约更新时必须同时审查前端协议、Mock 和 fixture；不得只改 Mock 迁就页面。

Mock 无法证明的内容仍需真实 atoll 冒烟：数据库持久化、并发裁决、真实 Actor/daemon 启动、文件 ticket 跨进程兑换、安全权限和生产 Observer 配置。

阶段 E 发布前还必须验证：真实 daemon 地址路由与磁盘落盘；ticket 过期/一次性/跨进程兑换；设备 key 不进入日志和普通投影；安全 binding 投影或 attach/detach 的真实收敛；真实 class/config 校验；timer 在重启、跨端和权限变化时的语义。Mock 只证明产品流程和错误恢复，不替代这些运行时事实。

阶段 B 日常开发不要求启动真实服务端。`real-backend-shape` 场景刻意关闭 Mock membership 扩展并移除 human principal，用来防止前端依赖虚假字段；源码核对和 fixture 只证明 JSON 形态。真实运行时的 membership 撤销时序、幂等并发、大历史性能与生产装配仍是发布前 smoke，不得写成“Mock 已证明”。

## 8. 单项复现

```bash
npx vitest run tests/channel-access.test.js tests/roster.test.js tests/submissions.test.js
npx vitest run tests/fold-phase-b.test.js tests/structured-result.test.js tests/management-actors.test.js
npx vitest run tests/mock-phase-b.test.js tests/mock-scenarios.test.js
npx playwright test tests/browser/phase-b.spec.js
npx vitest run tests/capabilities.test.js tests/dynamic-form.test.js tests/task-controls.test.js tests/control-actions.test.js tests/mock-phase-c.test.js
npx playwright test tests/browser/phase-c.spec.js
npx vitest run tests/channel-governance.test.js tests/mock-governance.test.js
npx playwright test tests/browser/phase-d.spec.js
npx vitest run tests/space-administration.test.js tests/resources.test.js tests/timers.test.js tests/mock-phase-e.test.js
npx playwright test tests/browser/phase-e.spec.js
```

浏览器用例由 Playwright 自动启动 Mock 和 Vite；若端口已被人工服务占用，先停止对应进程，避免测试连接到旧代码。

## 9. 代码卫生与阶段 A–E 完成门槛

```bash
rg '/api/workspaces|/api/channels|/api/daemons|subscribe|fonts.googleapis' src index.html
git diff --check
node -e "JSON.parse(require('fs').readFileSync('contracts/product-capabilities.json','utf8'))"
npm run test:all
```

第一条应无结果。全部命令通过后，再按 [PHASE-E.md](PHASE-E.md) 第 5–6 节逐项登记当前测试输出；不能用阶段 A–D 的历史结果替代阶段 E 当前工作树证据。
