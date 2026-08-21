# Agent 控制面前端测试指南

交接文档：面向接手前端测试的人。覆盖四件事——怎么起 mock、前后端协议是什么、怎么测、测什么。
协议定稿在 coagent 仓 `.dalek/pm/coral/agent-request-state-design.md`（v7）与
`agent-control-protocol-build-spec.md`，本文只摘测试需要的部分；两边冲突时以协议档为准。

---

## 1. 环境：怎么起

### 1.1 mock 后端

```bash
cd atoll-web
ATOLL_MOCK_PORT=18832 ATOLL_MOCK_SCENARIO=long-running ATOLL_MOCK_LIVE_INTERVAL_MS=0 node mock/server.mjs
```

- `ATOLL_MOCK_PORT`：默认 8832。**手测与自动化脚本必须各起一个实例、各占一个端口**，
  自动化脚本会 reset 账本，共用实例会互相清掉对方的状态（吃过两次亏）。
- `ATOLL_MOCK_SCENARIO`：起始场景。测控制面用 `long-running`（turn 恒不结束，处理中/
  排队/编辑/停止各状态都摆得出来）；要看终态用 `message-flow`（秒回 PONG）。
  全部场景见 `mock/scenarios.mjs` 的 `SCENARIOS`。
- `ATOLL_MOCK_LIVE_INTERVAL_MS=0`：关掉背景噪音消息。

### 1.2 前端

```bash
ATOLL_SERVER_URL=http://localhost:18832 npx vite --port 5173 --host 0.0.0.0 --strictPort
```

- `ATOLL_SERVER_URL` 是 vite 代理目标（/api、/ws、/obs、/mock、/files 全部转发）。
- 从别的机器访问必须 `--host 0.0.0.0`，只绑 127.0.0.1 会 503。

### 1.3 登录

账号 `root@atoll.local`，密码 `root`（可用 `ATOLL_ROOT_PASSWORD` 覆盖）。
mock 是单主体：凡持有 cookie 即认为 root，**mock 重启不需要重新登录**。

### 1.4 运行中控制 mock（不重启换场景/清账）

```bash
curl -X POST http://127.0.0.1:18832/mock/control/reset \
  -H 'content-type: application/json' -d '{"scenario":"long-running","seed":123}'
```

reset / mock 重启都会换"服务器世代号"（attach 回执里的 `boot`）。前端有世代守卫
（`src/model/server-boot.js`）：发现世代变了自动作废本地 `atoll.*` 缓存并重载一次。
**任何时候都不应要求测试者手清 cookie/localStorage——如果出现"必须手清才正常"，
那本身就是一个要报的 bug。**

其他控制端点：`/mock/control/state`（看内部状态）、`/mock/control/advance`（拨时钟，
触发定时器类事件）、`/mock/control/fault`（注入故障）。

---

## 2. 协议：测试必须懂的模型

### 2.1 账本与 turn

一切真相在频道账本（feed）里按 seq 追加。一条用户消息（request）+ 它的所有回复帧
（response：进度/终态）构成一个 turn。**前端不持有任何私有状态机：一切呈现从账推导。**
帧按 envelope id 幂等去重——同 id 的帧只入账一次（所以 mock/后端发帧 id 必须恒唯一）。

### 2.2 progress 契约（本期核心）

- 进度帧 payload 带 `status: "queued" | "processing"`；终态帧带
  `status: "completed" | "failed"`（失败带 `reason`/`error_code`/`detail`）。
- **凡带 status 的进度帧必带 `controls`**：受理方（agent 基座）宣告"此刻可以对这条
  消息用哪些控制词"，条目形 `{word, label?, input_schema?}`，**全量快照、后帧覆盖前帧**；
  控制词请求自身的进度帧恒为空集；终态帧恒不带。
- 前端按钮 = 最新 status 帧的 controls ∩ 自己发的 ∩ 频道可写。
  **前端恒不查 describe、恒不按收方身份推断**（describe 只是调用参数描述）。
  当前约定：queued 报 `[replace, steer]`；processing 报 `[interrupt, replace]`。
  白名单外的词走通用渲染（label 兜底文案、点击发词带 target）。

### 2.3 控制词表（用户面叫法 → 协议词）

| 用户面 | 协议词 | 语义 |
|---|---|---|
| 发消息 | `agent.ask` | 空闲即跑；忙则入队（queued） |
| 停止 | `agent.interrupt` | 打断当前 turn + 冻结队列；受理即终态；恢复 = 再发消息 |
| 编辑 | `agent.hold`+`agent.replace`+`agent.unhold` | 见 2.4 编辑链 |
| 插入 | `agent.steer`（target 形 `{target}`） | 把等待区一条并进当前 turn；无 turn 则降级 completed 不动作 |
| （无按钮） | `agent.steer`（文本形 `{text, expected_turn_id?}`） | 文本并入当前 turn，终态 `merged_into` |
| 取消 | channel 层消息撤回（cancel 帧） | 不是 agent 词，只对 queued 可用 |
| （内部） | `agent.hold`/`agent.unhold` | 冻结/解冻队列；hold 可带 `target`（打断该消息回队）与 `duration_ms`(1..1800000，默认30min，到期自动解冻)；unhold 幂等 |
| （内部） | `agent.context` | 只读自省，终态带 `frozen: {held_by, until}` |

关键行为不变量：

- **冻结期间新消息只入队不执行**；hold 后写覆盖（新 hold 顶掉旧的，重置时长）。
- **续跑恒 FIFO**：解冻/停止后恢复时从队列头开始，新消息排队尾，恒不插队。
- **组批判据（协议 §4.4.5）：Resumed 件恒单独成批**。被打断退回队首的那条（编辑流
  的 target，replace 后的新行继承标记）恢复时**独跑**，队列其余继续 queued；
  队首是从没跑过的普通件时才整批带走：lead processing，其余每条终态
  `{status:"completed", merged_into: <lead 的请求 id>}`。恒不存在"定向 unhold"
  这种参数——分流全由队首行的 Resumed 标记决定。
- **replace 校验**：目标必须自己发的（`target_not_owned`）、必须在队列中、
  `old_text` 必须与当前缓冲文本一致（`cas_mismatch`，编辑竞态保护）。可反复编辑同一条。
- **容量**：缓冲满 8 条，新的占格请求整体拒绝 `base_capacity`；replace 不占新格。
- **打断恒不排队**：turn 启动窗口内 interrupt 直接 `busy` 失败零效果，不留待发槽。

### 2.4 编辑链（最容易坏的路径，逐帧背下来）

对处理中消息点编辑，wire 上依次发生：

1. `agent.hold {target}` → completed；
2. 目标消息账上出现 `{status:"queued", resumed:true}`（被打断、回队列头）；
3. （断线重连时）`agent.context` 验锁：`frozen.held_by` 必须等于第 1 步 hold 的请求 id；
4. `agent.replace {target, old_text, new_text}` → completed；
5. **目标消息账上出现 `{status:"queued", text:<新文本>}`**——替换生效 = 新文本打在目标
   消息自己的账上，前端呈现恒吃账（`accountText`），不拼 replace turn；
6. `agent.unhold {}` → completed（保存成功后前端自动发）；
7. 目标消息账上出现 `{status:"processing"}`——续跑。

对等待区消息编辑：跳过 2（本来就 queued）、7 变为继续排队（有活动 turn 时）。

### 2.5 呈现的三层信息架构

- **时间线**只住对话：用户消息气泡（右侧，原文/替换后文本），agent 气泡（左侧，
  处理中 = "● 处理中: 原文" + 一行滚动活动，原地变答案，无按钮、无轮次数字、无 ✓）。
- **等待区**是输入框上方浮层：queued 消息恒不上时间线；条目 [插入][编辑][取消]；
  单 agent 不显分组名；hold 冻结时标"（已暂停）"。
- **被 turn 接受才上屏**：processing、merged_into、steer accepted 三种事实。
- 处理中的用户气泡下挂 [编辑][停止]，turn 结束按钮消失。
- 编辑 = 消息**原地**变可编辑（textarea 贴原文尺寸，[放弃][保存] 行内），
  恒不弹独立面板、恒不在编辑中途让消息在时间线/等待区之间瞬移。

---

## 3. 怎么测

### 3.1 三层测试，缺一不可

1. **单测**（`npx vitest run`，全套约 6s）：模型层逻辑（task-controls、agent-control、
   fold）。**它测不出交互形错误**——断言照实现写，实现错它也绿。
2. **浏览器手操**（playwright 或真人）：像用户一样逐步操作，**每一步截图并肉眼看**。
   参考 `tests/browser/*.spec.js` 的写法；`playwright.config.mjs` 会自动拉起 mock+vite。
3. **瞬时态采样**：闪跳类 bug（帧与帧之间几十毫秒的空窗）截图看不到，要在动作后
   密集轮询（每 40ms 查一次目标元素 3 秒）。例：保存后等待区任何瞬间都不得出现被编辑
   的消息。

### 3.2 血泪规则（每条都对应一个真实逃逸的 bug）

- **每个操作至少做两遍**。帧 id 撞车、状态残留类 bug 只有第二遍才炸（多次编辑曾因
  mock 帧 id 复用被幂等去重吞帧）。
- **验收剧本先于实现**：照 §2.4 这样的逐帧序列写断言，不要照页面现状写。
- **别信"测试全绿"**：绿只说明行为稳定，不说明行为正确。关键帧必须人眼核对。
- **自动化脚本用自己的 mock 实例**，跑完销毁；恒不 reset 别人正在手测的实例。
- 改完前端要 `npx vite build` 确认编译，再跑测试；mock 改动要重启 mock 进程才生效。

### 3.3 走查场景清单（全量回归照此执行）

| # | 场景 | 期望 |
|---|---|---|
| 1 | 发消息（空闲） | 等待区闪现即上时间线；agent 气泡带名字+AI标+时间、"● 处理中: 原文"+活动行；[编辑][停止] 挂消息正下方右对齐 |
| 2 | 处理中再发 2 条 | 等待区浮层 2 条、无分组名、[插入][编辑][取消]；不上时间线 |
| 3 | 等待区编辑 | 条目原地变 textarea（贴原文尺寸）；保存后文本更新、仍排队、处理中恒只有一条 |
| 4 | 处理中编辑 | 消息在时间线原地变 textarea；agent 气泡不消失；等待区全程不出现该消息（含保存后瞬时采样）；保存后带新文本续跑 |
| 5 | 连续编辑 3 次 | 每次 user 气泡与处理标题都换新文本 |
| 6 | 编辑竞态 | 改 old_text 后提交（模拟并发）→ `cas_mismatch`，编辑器留在原地报错 |
| 7 | 插入 | 等待区消息并进当前回合，处理标题"A ＋ B"，等待区清空 |
| 8 | 停止 | 气泡原地"✗ 已停止 · 发消息即继续"；按钮消失；等待区保留 |
| 9 | 停止后发消息 | **队列头旧消息先跑（FIFO）**，新消息排队；队首为普通件时整批合并：lead"（含合并 N 条）"，其余作为消息上屏 |
| 9b | 编辑 A 保存（B、C 在排队） | A 带 Resumed **单独续跑**（无"含合并"标注）；B、C 留在等待区、恒不被并入、恒不上时间线 |
| 10 | 取消/全部取消 | 单条消失；全部取消走 hold→逐条撤→unhold，处理中的不受牵连 |
| 11 | 容量 | 塞满 8 条后第 9 条被拒（base_capacity 反馈可见） |
| 12 | 终态（message-flow 场景） | 气泡原地变答案；无 ✓、无按钮、无轮次数字 |
| 13 | mock 重启/reset | 页面自动重载对齐新世代；不需要手清缓存、不需要重新登录 |
| 14 | 视觉基线 | 左右气泡名字/头像/文字纵向对齐一致；宽度、间距无跳动 |

### 3.4 已知缺口（测到别当 bug 报，要改先对协议档）

- mock 未实现：steer 文本形的输入入口（前端无此按钮，协议在）、hold 到期的
  `agent.hold_expired` 事件帧（mock 只做了到期解冻续跑）。
- 冻结期间等待区的"插入"按钮仍可点，点了按协议降级不动作（协议已拍；置灰属呈现增强，未做）。
- 真后端（coagent）尚未打 controls 字段——**连真后端测按钮会全部不出现，这是预期**，
  后端补齐前控制面测试一律走 mock。
