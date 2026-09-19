# Browser N–S 产品分歧交接包（f6cebbb）

本文件只交接可复现的产品分歧；没有修改 `src/`、没有加兼容 owner，也没有通过放宽 case 隐藏失败。所有入口均由真实浏览器从 `/` 登录后进入当前 workspace。

## R1：频道切换时 history owner 尚未连接

- 影响 case：N2、notification-high-water 1/3/4、notification-policy 1、reading-position-session（共 6 个 RED case 的共同截断点）。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15199 ATOLL_TEST_MOCK_PORT=18858 npx playwright test tests/browser/reading-position-session.spec.js --reporter=line`
  2. 登录 `root/root`，等待 `state-open` 和唯一 `.timeline-reading-stack > .timeline-reading-layer.is-active > .timeline-message-list`。
  3. 点击真实频道按钮 `# c0.project`。
  4. 预期 `main h1` 为 `c0.project`，当前结果 workspace 消失，`main h1` 不存在。

- 基线能力：用户可在频道间切换并继续查看/保持读位置；通知 ack 和 refresh contract 依赖这个切换边界。
- 首个公开 owner 边界：wire state callback `useWireSession.onState` 调用公开 feed port 的 `disconnectHistory`；`WorkspaceApp` 的 owner guard 抛出 `feed.disconnectHistory owner 尚未连接`。不是 selector、fixture 或旧入口加载错误。
- 证据：Playwright console 记录 `[Unhandled error] Error: feed.disconnectHistory owner 尚未连接`；同一 run 在切换前已经显示真实 c0 heading、connection open 和唯一 reading owner。
- 交接：由产品 owner 决定 disconnect/connect 的生命周期顺序；本分区不改 `WorkspaceApp` 或 wire session。

## R2：Following append 后唯一 reading owner 离开物理尾部

- 影响 case：N1。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15213 ATOLL_TEST_MOCK_PORT=18863 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep 'N1 有积压' --reporter=line`
  2. 登录后把真实 owner 滚到底，使用 mock control 仅产生真实 approval arrivals（不调用滚动修正）。
  3. 连续产生 20 条；每帧读取唯一 owner 的物理 gap 和频道/jump badges。
  4. 预期 gap 始终 ≤2、badges/jump 始终 0；当前 `mode=browsing`，gap 可从 224 增至 4480，产生 off-tail frames。

- 基线能力：用户停在尾部时连续新消息保持尾随，不被虚假“有新消息”打断。
- 首个公开 owner 边界：`ConversationSurface` 发布的唯一 reading owner → `ReadingContainerHandoff` → `VendorListExecutor` append/presentation geometry；notification rail 仍有真实 arrival，偏差首先出现在 owner 的物理 tail。
- 证据：`N1-following-tail.json` 保留了 arrival frames、gap、mode、notice frames 和离开尾部后的 counts；test 不调用 reachBottom 伪造通过。
- 交接：由 reading owner/geometry owner 修复 append 后物理尾随；本分区不新增第二容器或滚动 writer。

## R3：actor filter 的 raw rail authority 未建立，过滤外 unread 未保留

- 影响 case：N4。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15213 ATOLL_TEST_MOCK_PORT=18863 npx playwright test tests/browser/N-im-read-fallback.spec.js --grep 'N4 成员过滤' --reporter=line`
  2. 登录 c0，启用 `只看我与 steward 的往来`，在唯一 owner 尾部。
  3. 注入一个 `related=false` outside arrival，再注入 6 个 steward approvals。
  4. 预期 installed steward scope 全部 ack，outside row 仍 counted；当前 `authorityReady=false`、`outsideFilterPreserved=false`。

- 基线能力：scope 内已读不能吞掉 scope 外提醒。
- 首个公开 owner 边界：channel feed runtime 的 rail snapshot / actor-filter projection 与 reading receipt 的 authority handoff；DOM selector 已是当前 `data-presentation-row-id`/唯一 owner。
- 证据：`N4-persistence-failure.json` 含 rail、reading、local reads 原始快照；断言在 raw rail truth 上失败，不接受徽标“压零”作为替代。
- 交接：由 notification/reading authority owner 修复过滤边界；本分区不另建 rail 状态。

## R4：cached hydration 未恢复已 ack 的 high-water

- 影响 case：notification-high-water 2。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15214 ATOLL_TEST_MOCK_PORT=18864 npx playwright test tests/browser/notification-high-water.spec.js --grep 'cached hydration' --reporter=line`
  2. 对 c0.project 注入两次真实 approval，确认 badge 为 2；刷新后再次等待 `state-open`。
  3. 预期 badge 仍为 2，进入尾部确认后刷新不复活；当前刷新后的初始 badge 不存在。

- 基线能力：冷启动不能丢失未读，也不能复活已确认未读。
- 首个公开 owner 边界：`channel-replica` rows/meta hydration → feed runtime notification cursor/high-water → rail projection；不再访问旧 `atoll-feed-v8/channelMeta`。
- 证据：迁移后 test 通过真实 IndexedDB `atoll-channel-replica-v1`、真实 badge、真实 reload 验证；失败不是旧 DB 名或 selector。
- 交接：由 replica/runtime persistence owner 决定 checkpoint hydration 顺序；本分区不恢复旧 store。

## R5：readable event 没有物化为当前 presentation row

- 影响 case：notification-policy 2。
- 最小复现：

  1. `ATOLL_TEST_WEB_PORT=15215 ATOLL_TEST_MOCK_PORT=18865 npx playwright test tests/browser/notification-policy.spec.js --grep 'tool, timer' --reporter=line`
  2. 通过 mock control 发送 lifecycle `readable_event`，确认 rail quiet；点击真实 `# c0.project`。
  3. 预期可见 `[data-presentation-row-id="c0.project-notification-readable-event"]` 并有 reading observation；当前该 row 未物化。

- 基线能力：独立 readable public event 可见且拥有独立通知 root，不能被 transport/activity event 合并或吞掉。
- 首个公开 owner 边界：`ConversationSurface` 的 presentation projection / `VendorListExecutor` row admission；当前 row identity 已是实际 `data-presentation-row-id`。
- 证据：在切换崩溃前的 lifecycle assertions 已通过；失败定位在当前 row materialization，不是旧 `[data-entry-id]`。
- 交接：由 presentation admission owner 决定 readable event 的公开 row 形状和可见性；本分区不把 mock payload 直接注入 DOM。

## 结论

以上 R1–R5 覆盖 10 个 RED case 的真实分歧。R1 是共同生命周期截断点；R2–R5 是可独立定位的 reading/notification/persistence 分歧。5 个 PASS case（N3、offline、performance 三条）已在同一真实入口通过，未以 mock success 替代用户行为。
