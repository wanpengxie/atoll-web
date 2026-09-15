# Atoll Web 数据同步架构

状态：2026-09-16 已按本文完成实现与集中验证。本文只处理连接、Meta、Replica、live 与 history 的协作，不修改视觉样式、Composer 或等待区。

## 1. 问题

旧启动链路把五件不同的事串成一个完成条件：

```text
打开 WebSocket
  → 等 IndexedDB owner/meta
  → 发送 attach
  → 等 server boot 清理与历史调度安装
  → 释放 live frame
  → UI 才认为连接成功
```

这会让缓存打开、旧数据清理或历史初始化表现为“后端没连上”，也让毫秒级的 attach Meta 失去意义。Meta、live 和 history 的数据所有权也因此混在一个 barrier 中。

## 2. 五种独立事实

同步会话必须区分：

| 事实 | 含义 | 能否阻塞 live |
|---|---|---|
| `transportConnected` | WebSocket 已打开 | — |
| `sessionAttached` | 服务端已接受 attach，并给出 generation/session | attach 前没有 live；attach 后不得阻塞 |
| `remoteMetaReady` | memberships、频道 head、boot 已收到 | 与 attach 同一毫秒级回执 |
| `localMetaReady` | 本地 Replica coverage/frontier 已读取 | 否 |
| `historyReady(channel)` | 某频道已有可展示的 tail/runway | 否 |

连接灯和写入资格只依赖 `sessionAttached` 与频道访问关系；不得依赖 IndexedDB、历史页或 Markdown 投影。

## 3. Meta 的两类所有权

### 3.1 启动/控制 Meta

频道目录、membership、自身 actor、session、boot、未读 frontier、最近活动摘要属于轻量控制面。它不包含消息正文，不需要反序列化账本。当前同步可读的 workspace bootstrap 是它的本地快照；attach receipt 是它的远端刷新。

这类数据必须独立于消息正文的数据库事务和恢复生命周期。单独 object store、单独数据库或小型同步快照都可以；关键合同是读取它不扫描消息、不等待消息写事务。

### 3.2 Replica 一致性 Meta

`coverage`、`newestSeq`、`checkpoint` 与缓存行是否存在共同描述一份 Replica。它们必须与对应消息保持原子或保守一致：Meta 可以落后并导致安全重取，绝不能领先并声称一段并不存在的消息已经持久化。

因此这类 Meta 继续和消息行属于 `FeedCache` 的同一一致性域，不能为了启动快而复制成第二份权威游标。

## 4. 正确启动时序

```text
页面启动
  ├─ 同步读取 workspace Meta，立即画出应用壳与频道
  ├─ 立即打开 WebSocket
  └─ 并行打开 FeedCache，仅读取 Replica Meta

WebSocket open
  → 立即 attach（可携带当时已经可用的安全 resume；没有就传空）

attach receipt
  → 同步安装 generation / session / memberships / history heads
  → UI 立即进入 attached，live 立即可交付
  → 异步选择 FeedCache 的 owner + server boot epoch

并行
  ├─ live：下一帧即可进入内存 Replica 和 UI
  ├─ local hydrate：按 coverage 反序列化当前频道 tail
  └─ remote history：Scheduler 按 focus/demand 获取
```

服务端 attach 已建立原子 history/live seam：回执只携带轻量 Meta，cursor 锚定到各频道 head，之后的提交走 live；head 及以前由 history 拉取。因此 attach 不需要等待本地 cursor 才能保证不丢消息。

## 5. Epoch fence，而不是 Wire barrier

收到 attach 后，UI/live 不等待 IndexedDB；但持久化必须等待 FeedCache 依次选择好 `principal` 与 `(principal, boot)`：

```text
attach Meta（同步）
  → 建立 cache epoch promise

live frame
  → 立即 commit 到内存 Replica
  → 持久写排在 cache epoch promise 之后

checkpoint
  → 先 flush live batch
  → coverage 写也排在同一 cache epoch promise 之后
```

boot 改变时，内存 Replica 必须在 attach Meta 回调内同步 reset；磁盘清理由 epoch promise 异步完成。新 generation 的写入排在清理之后，所以旧世界不会删掉新 live，也不会让旧 coverage 跨世界复活。

principal 改变时同样先隔离内存 Replica，再让 owner 切换排在旧 owner 的全部已接收写入之后。首次 attach 在 owner 与 boot 尚未共同确认前携带空 resume；空 resume 是保守重取，不会作出跨 principal 或跨 boot 的错误 coverage 声明。确认完成后，后续重连才可使用该 epoch 已持久化的 resume。

Wire 只负责协议顺序：attach receipt 之前拒绝 feed，之后立即交付。它不得理解 IndexedDB，也不得缓存任意数量的 downstream frame 等应用初始化。

## 6. Scheduler 边界

Meta 安装与内容供水分开：

- `attach(grants, generation)` 立即声明远端 head、资格和 live/history seam；
- `setLocalMeta(meta)` 可在 attach 前或后到达；
- 同一范围的 IndexedDB 与 network 结果按 `(channel, seq)` 在 ChannelReplica 幂等合并；
- live 永远不进入历史 executor/reservoir；
- 当前频道可在 local Meta 尚未完成时先从网络取得 tail；本地 Meta 后到只改变后续 source 选择。

本轮不把 HistoryDemandPort 改造成长期声明式 demand；那是供水策略的下一层，不得再次与连接状态耦合。

## 7. 失败语义

- workspace Meta 损坏：丢弃快照并远端刷新，不阻塞 socket。
- FeedCache unavailable/open failed：`localMetaReady=failed`，继续 live 与 remote history。
- epoch/boot 清理失败：内存 live 继续；持久化标记失败并报告，不能关闭 WebSocket。
- history 失败：只影响对应频道的 history condition。
- transport 断开：缓存阅读仍可用；提交走现有 outbox 状态，重连后再传输。

## 8. 实现合同

1. 删除 `beforeAttach` 对本地 Meta promise 的等待。
2. 删除 Wire 的 `attachBarrier` 与 downstream 内存队列。
3. attach Meta 同步安装，`onState(attached)` 不等待 FeedCache。
4. FeedCache 写入和 checkpoint 统一经过 cache epoch fence。
5. principal 或 boot/world 改变时先同步隔离内存，再按序异步清磁盘；未确认 epoch 时 resume 必须为空。
6. local Meta 无论先到还是后到，都能加入同一个 Scheduler；不重置已收到的 live。
7. 保留 Replica 行与 coverage 的同事务权威，不另造“消息 Meta”第二真相。
8. 不修改视觉、Composer、等待区和消息展示合同。

## 9. 验收不变量

普通样例测试之外，使用 property/state-machine fuzz 随机排列以下事件：socket open、local Meta ready/fail、attach、live、checkpoint、history page、disconnect、reconnect、boot change。

每条随机轨迹必须满足：

1. attach 一旦完成，live 的交付不等待 local Meta promise。
2. attach 前的 feed 永远被拒绝。
3. 同一 `(channel, seq)` 最多在内存 Replica 出现一次。
4. 新 boot 的 live 持久写永远排在旧 boot 清理之后。
5. coverage 永远不会在其对应 live batch 之前提交。
6. 旧 generation 的异步 Meta 完成不能覆盖新 generation。
7. local Meta 先到、attach 先到、二者同时到，最终 head/coverage 与可见行集合等价。
8. 任意缓存失败都不能把 `sessionAttached` 降回 false 或关闭传输。

## 10. 明确后置

- 真正的 IndexedDB outbox 与时间线 local echo。
- 长期声明式 History Demand。
- 跨设备阅读位置同步。
- 后端新增独立 Meta frame；当前 attach receipt 已足够承担首次 Meta 同步。

## 11. 实现对账

| 合同 | 唯一实现位置 |
|---|---|
| attach 后立即交付 live | `src/net/wire.js` |
| principal/boot epoch、持久写排序 | `src/model/sync-session.js`、`src/app/hooks/useChannelFeed.js` |
| Replica 行与 coverage 原子权威 | `src/model/feed-cache.js` |
| remote Meta 与 local Meta 合流 | `src/model/history-scheduler.js`、`src/app/hooks/useChannelFeed.js` |
| 启动三路并行 | `src/App.jsx` |
| UI 不以 local hydrate 阻断 history | `src/ui/timeline/useConversationViewport.js` |
| 乱序、重复、epoch 边界验证 | `tests/sync-data-fuzz.test.js` |

本轮没有新建第二份消息 Meta 数据库。workspace/control Meta 继续走轻量 bootstrap；coverage/checkpoint 继续与消息行同属 FeedCache 一致性域。这个选择是所有权边界，不是暂缓拆库。

### 移动端前台再校准

移动浏览器从后台恢复时，客户端不能把仍标记为 `OPEN/attached` 的旧 WebSocket 当作新鲜性证明。`visibilitychange → visible` 与网络恢复会立即结束旧 session 并重新 attach；attach 返回的轻量 channel head Meta 随即驱动当前频道 Scheduler 比较 Replica frontier，并主动拉取缺口。live push 是常驻低延迟路径，不是发现遗漏消息的唯一触发器。

这次再校准不开放移动端后台历史预热：当前频道的 Meta 缺口是前台同步需求；其他频道的新 live 仍正常接收，但深历史只在获得 focus 后读取，避免后台历史批次再次占住移动链路。

## 12. 集中验证

架构施工全部完成后统一执行验证，没有在施工中启动浏览器测试：

- 112 个测试文件、638 项测试全部通过；
- 其中属性测试随机生成 950 条输入轨迹，覆盖 Replica 乱序/重复、epoch 写入隔离和 cache world 判定；
- production build 通过；
- `git diff --check` 通过。
