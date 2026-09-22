# Replica 增量折叠

状态：**已实施**（一次性施工，无分期）。本档记录已经落地的形，不是提案。

## 问题

`channel-replica.js` 的 `rebuildState(state)` 每接受一行就把该频道**当前保留的
全部 rows** 重新排序、重新扫一遍，重建 `timeline` / `narration` /
`_envelopesById`。桌面端从设计上不裁剪 rows（`trimMobileReplica` 只在
`isMobileProfile()` 下生效），所以同一个频道开得越久，处理"下一条新消息"的成本
就越高。

实测（同机、同 rows、`NODE_ENV=production`）：

| rows | 旧实现 | 新实现 | 旧单行 | 新单行 |
|---|---|---|---|---|
| 1,000 | 449 ms | 8.4 ms | 449 µs | 8.4 µs |
| 2,000 | 1.58 s | 11.4 ms | 789 µs | 5.7 µs |
| 5,000 | 10.7 s | 28.1 ms | 2,143 µs | 5.6 µs |
| 10,000 | 55.9 s | 71.1 ms | 5,591 µs | 7.1 µs |
| 20,000 | **445 s** | **221 ms** | 22,281 µs | 11.1 µs |

旧实现的单行成本随频道长度涨了 50 倍；新实现是平的。20k 行的摄入从 7.4 分钟
变成 221 毫秒。

## 判断

全量重算保的是一条真不变量：`timeline = f(rows)`，且 `f` 与到达顺序无关。缓存、
历史、实时三条线乱序到达，不能折出互相竞争的两份结果。

但全量重算**不是这条不变量的唯一实现，是最偷懒的实现**。增量实现只要可证等价，
保证一样成立——而且更强：不变量从"隐含成立"变成"被断言守住"。

关键观察来自 `reconcileTimelineEntry`：它做的是 `Object.assign(previous, next)`，
就地改旧对象。也就是说旧代码**构造了一整份新结构，只为了把它 reconcile 掉**。
真正需要的从来不是"重建"，是"别重建没变的部分"。

## 落地的形

### 两个实现，一个定义

`rebuildStateFull(state)` 是折叠的**定义**：只读 `rows`（加留存闭合凭证），按构造
与到达顺序无关。它永久保留，永不删除。

`foldRow(state, seq, envelope)` 是同一个函数的增量实现，**故意不完备**。它只处理
能在闭式内证明的到达形状，其余一律 `return false` 交回权威实现。正确性因此不依赖
这份增量代码穷举所有情况。

交回权威的三种情况，都写在代码注释里：

1. `_unmatchedTerminalClosures.size > 0` —— 闭合凭证的合并要对整个存活行集重算，
   没有局部形式。这只在 trim 之后发生，而 trim 只在移动端发生，那里 rows 本来
   就有 500 行上限。
2. 没有 id 的 projection 行 —— 权威实现的 reconcile 键会让这类行互相撞在一起，
   与其复现这个行为，不如交回去。
3. `trim()` 自身 —— 直接调权威实现。

### 每条到达的成本

| 形状 | 频率 | 做的事 | 成本 |
|---|---|---|---|
| response | 流式输出的绝大多数 | 只重建它 parent 那一个 turn | O(该 turn 的 response 数) |
| request（新根） | 每轮一次 | 二分插入 timeline | O(log r) |
| request（认领孤儿） | 少 | 反向指针图的下闭包重算 | O(受影响 turn) |
| standalone | 少 | 二分插入 timeline | O(log r) |
| narration | 很少 | 有序插入 | O(narration 数) |
| 无 canonical body | 少 | 只进 rows | O(1) |

**没有一条与频道总长度相关。**

### 认领的边界证明

一个 request 的 root 由它自己沿 `correlation` / `parent` 向上走决定。所以新来的
request X 只能影响那些**能沿指针走到 X** 的 request。反向指针图
（`pointedBy`）从 X 往下的闭包，就是全部可能移动的集合；闭包外的节点可证不动。

这是"成本由该轮次决定、不由频道决定"的根据。BFS 不做剪枝：一个节点的 root 可能
没变，但它的 root 不再是根节点了，位置照样要变。

### 没有引入第二个 store

设计初稿里有一个 `order: number[]` 有序索引。**已删除**——它唯一的消费者是
`lastSeq`，而 rows 只会经 trim（走权威实现）离开，所以 `lastSeq` 是一个运行最大值，
不需要有序索引。

现在 `state._fold` 里全是 Map/Set 形式的纯派生索引，由权威实现在每次全量折叠
结束时重写一遍（`publishFoldIndex`）。这一点是"交回权威"能成立的关键：增量实现
拒绝处理的任何东西，下一行都从权威自己写的索引上接着走。

### 顺手去掉的一处全量扫描

`commit()` 里原本每行都要 `[...state._envelopesById.values()].filter(...)` 重建
一个 requests 视图，只为给变更日志算一个 rootID。这也是 O(n)/行，现在读维护好的
`_fold.allRequests`。

## 安全机制

### 折叠审计

`NODE_ENV === 'test'` 时默认开启（生产可用 `globalThis.__ATOLL_REPLICA_FOLD_AUDIT__`
或 `setReplicaFoldAudit()` 打开）。每次增量折叠之后：取值级签名 → 跑一遍
`rebuildStateFull` → 再取签名 → 不一致就抛 `replica_fold_divergence`。

签名是**值级**不是引用级：两个实现的对象身份会合法地不同（增量路径在认领时保住
了更多旧对象），等价只断言消费者真正读到的东西。

审计按 `rows.size <= 512` 设界。因为审计本身要跑权威实现，正是这次要消掉的成本；
增量实现的每一条分支都在十几行之内可达，超过这个量级只是在重复已经证过的形状。
`sz205`（单频道 1100 行）在加界之前会因此超时——这正好说明界是必要的，不是偷懒。

审计开着的直接后果：**现有的 Replica / timeline / projection 测试全部自动变成等价
性测试**。守门由已经描述了折叠行为的那套测试承担，不是由几条只复述实现的新断言
承担。

### 乱序 fuzz

`tests/replica-incremental-fold.test.js`：一组刻意覆盖全部分支的 23 行
（response 先到、parent 后到、三层链要求认领级联、correlation 指向一个本身不是
根的 request、system narration、无 parent 的 response、standalone），

- 400 次随机到达顺序，断言最终折叠与账本顺序**完全一致**；
- 400 次随机子集，断言任意乱序子集与同一子集按账本顺序折出的结果一致。

因为审计在 `commit` 内部就会抛，这两条同时断言了**每一个中间状态**，不只是终态。

另加：turn 身份跨 response 稳定、`timeline` 数组身份不变、trim 之后回落权威仍
正确、1k→20k 成本曲线次二次。

### 回退

一次提交。`git revert` 即回到全量语义，因为权威实现一行没动。

## 保住的五条不变量

- **I1 单一真相**：由审计 + 乱序 fuzz 显式断言，不再只是隐含成立。
- **I2 身份稳定**：`reconcileTurn` 原地改，`timeline` 数组身份不变（有测试）。增量
  路径比全量路径保住的对象更多，只会减少重挂载。
- **I3 唯一写入者**：外部 24 处读 `timeline`、14 处读 `narration`、零处写。因此
  **12 个消费文件一行未改**。
- **I4 裁剪不腰斩活动轮次**：`trim` 逻辑一字未动。
- **I5 闭合凭证**：闭合合并整块留在权威实现里，增量路径根本不碰。

## 非目标（明确没做）

- **桌面端内存窗口**。`trimMobileReplica` 仍然只在移动端生效，切走的频道状态仍然
  不回收。这次改的是"时间上不收"那一半：单行成本不再随历史长度爬升。"空间上不收"
  那一半原样留着，是单独一件事。
- **Virtuoso 的 overscan / 行高估计**。没碰。
