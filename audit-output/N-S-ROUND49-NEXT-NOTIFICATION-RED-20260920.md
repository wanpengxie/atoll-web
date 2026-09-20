# N–S Round 49：当前 notification 红的首断点（exact `fdb346f`）

日期：2026-09-20

本轮只读验收。产品 HEAD 锁定为 `fdb346ff63130fff06848ce43d2e908a7f7495b5`；每次浏览器运行都从 `git archive HEAD` 建 clean 临时树并使用全新 Chromium，未继承共享 worktree 的 source/test dirty state。没有修改 `src/`、vendor、package、fixture、正式断言或 skip。

## 冻结入口与对照结果

| case | exact run | 结果 | disposition |
| --- | --- | --- | --- |
| `notification-policy.spec.js` 两条 | ports `16949/20949` | **2 passed** | timer/readable-event/lifecycle 当前不再是产品红 |
| `N-im-read-fallback.spec.js` N1–N4 | ports `16950/20950` | **3 passed / 1 failed** | 唯一当前 notification 用户可见红为 N1 |
| N1 exact repeat 3 | ports `16956/20956` | **3 failed**，均 line 195 | 稳定复现，不是偶发 DOM 延迟 |
| `notification-high-water.spec.js` 四条 | ports `16952/20952` | **4 passed** | high-water/hydration/filtered/followed 当前绿 |
| `f7-channel-notifications.spec.js` 五条 | ports `16954/20954` | **5 passed** | F7 timer/activity 当前绿 |

对应产物：

- [N1 repeat3 console](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-browser-ns-round49-n1-repeat3-fdb346f-20260920/console.log)
- [N1 first-divergence probe JSON](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-browser-ns-round49-n1-probe-fdb346f-20260920/ztmp-ns-round49-n1-probe-r-daebc-ival-first-divergence-probe/round49-n1-first-divergence.json)
- [N1 probe console](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-browser-ns-round49-n1-probe-fdb346f-20260920/console.log)

## N1 case record

Baseline/case: [N-im-read-fallback.spec.js:147](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/N-im-read-fallback.spec.js:147), “N1 有积压跳到最新即同时清零，且停在底部连续到达 20 条时两处计数恒为 0”。

保护的用户能力是：用户在频道底部看到积压后点击“最新”，回到真实物理 tail 时应一次清除频道 unread；在 following tail 连续到达不应产生 badge/jump。架构不变量是：DOM/Presentation 的冻结 tail receipt 只能确认该 receipt boundary，离开 tail 后迟到 positive 不得复活旧 lease。

重现步骤保持正式 case 原样：`multi-channel`, seed `0x4e_01`；登录 `root`；向 `c0` 填充 24 条 tail；滚轮上移 900 离开物理 tail；注入 3 条真实 `human.approve`；点击公开 jump；再以真实 wheel 回到 tail。失败发生在正式连续 20 arrivals 之前的 line 195：

```text
Expected: c0 .unread-related count 0
Received: 1
```

probe 在同一 exact HEAD 记录的首个分歧：

| 阶段 | DOM | rail authority / cursor | Reading typed observation |
| --- | --- | --- | --- |
| 离开后 3 arrivals | `browsing`, jump=`3`, related=`3` | `authorityReady=true`, `readSeq=25`, `highWater=53`, counts=`3/3` | 旧 activation、`inputEpoch=1`，atTail=false |
| 点击 jump 回 tail | `following`, physical gap=`0`, jump=`0`, related=`3` | authority 仍 ready，highWater 仍 `53`，counts=`3/3` | 同一 activation、`inputEpoch=1`；settled=true、atTail=true；hit-tested IDs 含最新 `c0-approval-…-26/27` |
| 再等 20 条 arrival | 仍 `following`, gap=`0`, jump=`0` | highWater 仍 `53`；related 从 `3` 增至 `23`；每条新 approval 为 `counted_related` | 每次仍发布 settled=true/atTail=true，当前 activation/epoch，最新 arrival IDs 命中 |
| 再次离开 tail | `browsing`, related=`23` | highWater 仍 `53` | physical leave 后 epoch 才到 `2` |

因此不是空 diagnostics、selector、fixture audience、Replica 缺 row 或 Presentation 不可见：用户可见的最新 rows 已绘制并通过 typed Reading fence，rail authority 也已存在；真正未发生的是 frozen notification high-water 从 `53` 向 3 条 backlog 的 boundary 推进。

## 首个 owner 分歧

首个跨 owner 分歧是 **Reading tail re-entry 没有产生严格更新的 input epoch/owner identity**，随后 notification Feed 正确拒绝同 epoch 的旧 lease positive：

1. 物理上滑由 [`useConversationProjection.js:452`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:452) 的 `takeReadingControl` 把 epoch 从 `0` 推到 `1`，并在 [`useConversationProjection.js:462`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:462)–[`475`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:475) 发出 `physical-leave` revoke，`revokeInputEpoch=1`。
2. 公开 jump 使用 [`useConversationProjection.js:441`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:441)–[`450`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:450) 的 `requestLatest`；当前 [`reading-session.js:343`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/reading-session.js:343) 保留同一个 `session.inputEpoch=1`，只更新 mode/intent。
3. tail DOM receipt 在 [`useConversationProjection.js:1250`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:1250) 重新带回同 activation/epoch 的 positive。Feed 的 [`channel-feed-runtime.js:2243`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:2243)–[`2249`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:2249) 明确将 `receiptInputEpoch <= revokeInputEpoch` 视为 stale positive 并拒绝；这正是本轮 `highWater=53` 停滞的原因。

最小机制建议交给现有 **Reading tail/session owner**：公开 jump/从 browsing 回到 following 时应建立严格更新的 input epoch（或等价新 owner identity），再发布该当前 DOM 的 positive receipt；Feed 不应放宽同 epoch tombstone，也不应猜测/推进 mutable head。由于该分歧跨越 Reading→notification lease，若 owner registry 要求 notification 复核，notification owner 只需验收 receipt 被拒绝/接受的边界，不改第二状态源。

## Scope 裁决

N1 是本轮 exact current 唯一仍然用户可见的 notification RED；它不是 Round47 的 `document.visibilityState` 候选，且没有 pageerror、Hook/order 或 Tiptap/Composer 异常。但它确实触及 Reading/Feed lease 交界；本轮没有发现另一个同时满足“notification 且不涉及 visibility/Feed”的公开产品 RED：policy、high-water、F7 notification 入口均已通过。故不伪造一个非-Feed owner，也不以空 diagnostics 或删 assertion 结案；本包只交上述 Reading tail/session owner 首断点。
