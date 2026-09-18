# UX-B 数据与行为活性审计附件

> 2026-09-17，本文是生产调用链和定向回归的证据附件，不取代三份主设计文档或总执行账。本轮没有访问真实服务，没有新轮询器、后端或协议变更。

## 1. 结论表

| 用户旅程 | 实际生产owner | 审计结论 | 本轮处理/证据 |
|---|---|---|---|
| 进入频道，包括空频道或没有下一个push | `App` focus/refresh → `SyncObligationCoordinator` → `HistoryScheduler` | 入口原本会创建pending interest，attach也会恢复它；但`head=0`没有正seq coverage，`waitForCurrent` 原来会等到超时，因此不能称空频道已履约 | 修为只有权威Meta已证`head=0` + `controlCurrent`时将零目标视为已安装。回归证明断线时interest 1在attach后完成为1，没有history请求或push作为隐含前置 |
| 已fulfilled后断线重连 | `useChannelFeed.setHistoryGrants` + Sync obligation | **已证缺口**：`connection(true)`只推进旧的未完成义务，`1/1`重连不会探测新head | 修为只在真实attach generation变化且无未完成义务时新增一个interest；有pending只resume，同generation重复Meta不重复probe。回归得到`1/1 → reconnect 2/2`，同generation仍为2次probe |
| 后台标签回到前台 | visibility lifecycle → Sync obligation | **已证缺口**：原实现只在hidden flush frame batch，visible不产生新鲜度义务 | visible只对当前频道发一个interest；不轮询，hidden仍只flush。回归得到hidden probe数不变，visible将`2/2`推进到`3/3` |
| 隐藏期间已在真实尾部，回到前台的已读 | `ReadingSession` observation → feed cursor | **已证缺口**：hidden会正确拒绝markRead，但visible没有重新确认入口 | 仅保留当前activation最后一次真实`atTail`观察、当时已安装`visibleHighSeq`以及消息Surface确实可见的证据。visible时仅在仍following/同activation/该观察仍为tail时推进到该seq；窄屏文件/终端Surface隐藏的消息区不算已读。不用远端head，不把单纯页面可见冒充成已读 |
| 假“新消息”与真实未读 | Replica accepted-live arrival + channel read cursor | 当前连接符合合同：history/cache/metadata不写arrival，self/progress排除，terminal按稳定root去重；只有当前视窗真到尾才markRead | 本轮不改计数模型。已有`f7-channel-notifications`覆盖基线、同root更新、第二root、browsing未读和回尾清零；本轮新增visible-return已读的hook旅程 |
| 用户发送后回底，以及durable accept迟到 | Composer send-start token → ReadingSession 唯一bottom issuer | 已有生产合同：发起点捕获activation/inputEpoch/intentRevision，durable accept只能消费该token；期间上滑或A→B→A使它失效 | 现有unit已覆盖deferred accept两种竞态，production browser已覆盖browse-send→bottom及迟到输入不拉回。本轮不改Composer/AppShell |
| 离线草稿/本地durable queued/恢复失败 | `useSubmissions` + Outbox store + AppShell authority | 已有机制区分成员关系与传输可用性：已确认member离线时可编辑/持久接受，不在unavailable/closed时传输；IDB open失败在下次显式草稿写重试 | 现有`offline-recovery`/`offline-app-shell`/browser recovery证据保留，本轮不并发改W6 owner文件。definitive rejected只显示错误、手动retry目前只给uncertain；这是独立恢复交互取舍，不能改成自动重发，本轮未冒充关闭 |
| W5等待区后台证据 | Scheduler已验证history/live view → 纯projection | 已删除有写账副作用的`system.log.query`自动入口；W5 hook/model无`wire.submit`、无自有timer/cursor/retry | 本轮只读复核，不重跑不变W5组。Outbox uncertain同open epoch最多自动尝试一次，只有真实reconnect或用户显式retry再试 |

## 2. W1 实施边界

1. `interest` 仍是唯一新鲜度义务；新增的只有两个明确生命周期入口：新attach generation和hidden→visible。没有interval/poller。
2. attach先读当前sync snapshot再打开connection。旧义务未fulfilled时只恢复；只有已经存在且已完成的旧义务，真实新generation才建立一个新revision。初次进入仍由App的显式refresh入口唯一建立，attach不与它竞争双probe。
3. 空频道完成条件是同代Meta已权威证明`head=0`且control current；不是timeout、本地空Replica或无消息DOM。
4. 回前台时，数据新鲜度与已读分属两条证据链：feed发interest；ReadingSession只消费隐藏期间实际完成的尾部观察，不直接使用Meta head。

## 3. 定向验证

本轮命令：

```text
npm test -- --run tests/timeline-reading-integration.test.jsx tests/message-list-lifecycle.test.jsx tests/channel-feed-startup.test.jsx tests/history-scheduler.test.jsx tests/sync-data-fuzz.test.js
```

结果：**5 files / 72 tests passed**。其中新旅程确定性覆盖：

- attach本身不与初次进入双probe；显式entry interest只提交一次；
- disconnected entry interest → empty attach → fulfilled；
- fulfilled generation 1 → disconnect → generation 2 仅新增一次probe，同generation Meta不重复；
- hidden不probe，visible新增一次probe并fulfilled；
- hidden中真实tail观察不markRead，visible后只以当时已安装的seq 9 markRead一次；同样的tail观察若来自被文件/终端Surface隐藏的消息区，回前台仍不markRead。

同一源码之后`npm run build`通过（4363 modules / 2.19s）。这仍是focused unit + build证据，不冒称新的完整unit/browser冻结套。
