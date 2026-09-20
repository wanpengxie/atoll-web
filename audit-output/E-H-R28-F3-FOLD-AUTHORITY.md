# E-H R28 — F3 fold/presentation authority proof

本报告复核 `fae8b70` 的 TC-0183–0187。每条 case 保留旧用户动作和
observable，分别指向当前公开 owner；旧 `fold-authority.html` / `window.foldAuthority`
以及旧 diagnostics 只作为实现 oracle，不在当前测试中恢复、导出或兼容。没有修改
`src/`、vendor、package、lockfile，也没有删除、skip 或合并 case。

## Case disposition

| Case | 严格结果 | 当前证据 |
| --- | --- | --- |
| TC-0183 | PASS | 当前 App 的 channel roundtrip + append focused browser：`1 passed (8.7s)`。 |
| TC-0184 | PASS（公开语义 successor） | 当前 admission/lease/fold policy 单测共 `49 passed`；中间 candidate withholding、semantic tail release、prepend/filter authority、latest/historical fold policy 均有独立断言。 |
| TC-0185 | PASS（行为 successor；旧私有 trace 为 obsolete oracle） | 真实 App 的 latest-role transfer/browser anchor：`1 passed (16.6s)`；另有 fold policy/lease 单测。 |
| TC-0186 | PASS（R29 分段 successor） | 真实 App 分段 trusted-wheel run：首 wheel 前有一条 writer；首 wheel→takeover 与 takeover 后均无 writer，`1 passed (7.3s)`。 |
| TC-0187 | PASS | 当前真实虚拟列表的中部和靠顶两种合法 clamp 放置均通过：`2 passed (32.8s)`。 |

## TC-0183 — 用户显式收起 current entry 后，切频道返回与后续 append 都保留 override

- **Baseline:** `fae8b70:tests/browser/f3-message-fold.spec.js:47`，标题与动作见
  [旧 case](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/TEST-CASE-MIGRATION-LEDGER.md:534)。
- **Capability:** 用户把当前长消息明确收起后，切换频道并返回，以及后续追加消息，都不能
  把这个明确选择恢复为展开。
- **Invariant:** fold override 是当前 Reading/presentation owner 的 UI 事实；channel
  activation、latest-role 变化和 append 不得重置相同 message/slot 的显式 override。
- **Current public owner:** active timeline row/presentation 在
  [useConversationProjection.js:912-945](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:912)，折叠渲染及公开 toggle 在
  [TimelineRowRenderer.jsx:479-517](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:479)
  和 [FoldableBody.jsx:80-156](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/FoldableBody.jsx:80)。
- **Setup/action/observable:** reset `deep-history/1314`；root/root 登录；向 steward 发送
  marker 加 44 行正文；在 active public reading layer 找到同一 marker row；确认 toggle
  `true`，点击，确认 `false`；切 `c0.project` 再回 `c0`；再 append 一条消息；每个阶段
  都重新按 marker 定位并要求 `aria-expanded=false`。Successor 保留原动作，不依赖旧
  `.message-fold-toggle[data-fold-id$=":request"]` 私有尾缀。
- **Evidence:** [f3-fold-authority-restore.spec.js:53-78](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-fold-authority-restore.spec.js:53)，命令：

  ```sh
  ATOLL_TEST_WEB_PORT=16544 ATOLL_TEST_MOCK_PORT=19944 \
    npx playwright test tests/browser/f3-fold-authority-restore.spec.js \
    --reporter=line --workers=1 --output=test-results-e-h-r28-f3-0183-3432851
  ```

  结果 `1 passed (8.7s)`。这是完整用户动作/持久 observable 的 PASS，不是只检查
  marker 文本或隐藏状态。

## TC-0184 — Presentation authority rejects intermediate batches and blesses only the covered semantic tail

- **Baseline:** `fae8b70:tests/browser/f3-message-fold.spec.js:67`；旧实现通过
  `/tests/browser/fixtures/fold-authority.html` 和 `window.foldAuthority.batch2()`,
  `authoritativeTail()`, `prepend()`, `filteredGap()`, `filteredSettled()` 驱动，见
  [旧 case](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/TEST-CASE-MIGRATION-LEDGER.md:535)。该 fixture/私有 API 不属于当前公开 owner，不能恢复。
- **Capability:** 历史供给的中间批次不应半发布到可见 timeline；只有满足语义需求、身份、
  source revision 和 viewport owner 的完整 tail 才可发布；prepend/filter 过程中已发布
  tail 仍保持合法 presentation。
- **Invariant:** `history-presentation-admission` 是唯一 admission authority；候选、commit、
  layout grant 按 operation/view/epoch/source revision fence；render 只能产生 candidate，
  不能直接写入 owner。
- **Current public owner:**
  [history-presentation-admission.js:21-24](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/history-presentation-admission.js:21)
  的 `createHistoryPresentationAdmission`，以及 Timeline committed layout effect 的
  candidate/commit 边界（实现注释和公开方法在
  [history-presentation-admission.js:221-259](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/history-presentation-admission.js:221)）。最新/历史 fold policy 由
  [fold-defaults.test.jsx:46-100](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/fold-defaults.test.jsx:46)
  覆盖，browsing append lease 由
  [browsing-fold-lease.test.js:6-54](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browsing-fold-lease.test.js:6) 覆盖。
- **Setup/action/observable:** 当前 successor 不再调用旧 fixture，而是逐个构造公开
  admission token/candidate/meta：
  [history-presentation-admission.test.js:57-102](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/history-presentation-admission.test.js:57)
  证明 prefix withheld、完整 tail release、prepend grant；
  [history-presentation-admission.test.js:104-148](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/history-presentation-admission.test.js:104)
  证明 empty baseline 直到 semantic demand fulfilled 才发布；
  [history-presentation-admission.test.js:150-253](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/history-presentation-admission.test.js:150)
  证明 polluted identity、stale transaction、stale viewport owner 不得获得 grant。fold
  successor 逐条保留 latest 展开、historical 默认折叠、explicit override 和 streaming
  append 语义，而不是只对 fixture snapshot 做 fingerprint。
- **Evidence/disposition:** focused unit command：

  ```sh
  npx vitest run src/ui/timeline/fold-defaults.test.jsx \
    tests/history-presentation-admission.test.js tests/browsing-fold-lease.test.js \
    tests/conversation-viewport.test.js --reporter=dot
  ```

  结果 `4 files passed, 49 tests passed`。旧 fixture 的 `window.foldAuthority` trace
  是 obsolete implementation oracle；上述公开 authority 的独立 behavioral assertions
  覆盖了旧 case 的每个语义阶段，所以此条可按 successor PASS 入账，不是把 suite 绿
  当作单条证明。

## TC-0185 — cache-first latest role commit follows the public height acknowledgement

- **Baseline:** `fae8b70:tests/browser/f3-message-fold.spec.js:96`；旧 case 以
  `window.foldAuthority.cacheFirst()/authorizeCache()`、`__ATOLL_DIAGNOSTICS__` 和私有
  `reading.issuer-write` trace 断言，见
  [旧 case](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/TEST-CASE-MIGRATION-LEDGER.md:536)。这些不是当前用户可调用的公开 owner。
- **Capability:** 用户在历史位置阅读时，latest role 的提交/变化必须经过实际 DOM
  height/presentation acknowledgement；自动折叠不得破坏正在阅读的锚点或把未确认的
  cache 当成已绘制事实。
- **Invariant:** current row role、fold lease 和真实 painted geometry 是同一 Reading
  transaction 的公开事实；旧的 cache-first 私有 trace 不能成为第二 source of truth。
- **Current public owner:** projection/latest row 在
  [conversation-presentation.js:912-946](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/conversation-presentation.js:912)
  的 `useConversationProjection`；DOM height/row observation 与 position lease 在
  [VendorListExecutor.jsx:997-1069](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:997)。fold role 变化的用户行为 successor 是
  [fold-collapse-anchor.spec.js:302-347](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/fold-collapse-anchor.spec.js:302)。
- **Setup/action/observable:** reset 真实 deep-history；发送六条长消息；将读者用真实
  wheel 放进历史锚点；确认 mode=`browsing` 且锚点下方仍有余量；触发真实 live pulse
  使末条失去 latest role；重新找到相同 semantic row；要求 row 自动折叠，同时
  `excessDrift <= 8`、单帧位移不超过允许预算、锚点不消失。这个 action 保留了旧 case
  的“role commit 后可读高度 + anchor stability”用户语义；删除的 cacheFirst/diagnostics
  只是实现 oracle，不以它们冒充现有 API。
- **Evidence/disposition:**

  ```sh
  ATOLL_TEST_WEB_PORT=16547 ATOLL_TEST_MOCK_PORT=19947 \
    npx playwright test tests/browser/fold-collapse-anchor.spec.js \
    --grep '角色转移导致的自动折叠' --reporter=line --workers=1 \
    --output=test-results-e-h-r28-f3-0185-role-3432851-rerun
  ```

  结果 `1 passed (16.6s)`；同一 focused unit run 的 49 tests 也通过。判定为
  **PASS（行为 successor）**，同时明确旧私有 height-ack trace 本身不再计为 evidence。

## TC-0186 — wheel takeover invalidates a pending latest-role height transaction

- **Baseline:** `fae8b70:tests/browser/f3-message-fold.spec.js:126`；旧 case 通过
  fixture 的 `cacheFirst({ wheel: true })` 和私有 diagnostics 检查 input-owner 之后不得
  再有 `reading.issuer-write`，见
  [旧 case](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/TEST-CASE-MIGRATION-LEDGER.md:537)。
- **Capability:** 用户真实 wheel 接管历史阅读后，旧 latest-role/height transaction
  必须失效；用户自己的 viewport 不得被迟到的旧 writer 拉回。
- **Invariant:** native input 是同步 takeover boundary；新的 activation/input epoch
  取得唯一 viewport ownership，旧 position restore/height writer 必须在 boundary 前撤销。
- **Current public owner:** Reading session input epoch/lease 在
  [conversation-viewport.test.js:55-79](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/conversation-viewport.test.js:55)
  及 [conversation-viewport.test.js:240-268](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/conversation-viewport.test.js:240)；真实 DOM adapter 的取消边界在
  [VendorListExecutor.jsx:796-808](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:796)。
  当前 browser successor 是
  [history-reveal-prototype.spec.js:72-105](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/history-reveal-prototype.spec.js:72)。
- **Setup/action/observable:** reset `deep-history-delayed/0x92_41_22`；真实 Chromium 登录；
  在 live `.timeline-message-list` 上 wheel `-2000`，等待 100ms 后 wheel `+520`。DOM
  interceptor 把 writer 分成 `beforeFirstWheel`、`firstWheelToTakeover` 和
  `postTakeover`；测试要求 list 仍 connected、mode=`browsing`，且仅最后一个阶段
  `postTakeover` 为空。首 wheel 前的既有 writer 作为证据保留，不被误归因给 takeover。
  测试没有 fixture、私有 export 或 mock success。
- **Evidence/disposition:**

  ```sh
  ATOLL_TEST_WEB_PORT=16553 ATOLL_TEST_MOCK_PORT=19953 \
    npx playwright test tests/browser/history-reveal-prototype.spec.js \
    --grep 'trusted wheel takeover' --reporter=line --workers=1 \
    --output=test-results-e-h-r29-f3-0186-segmented-final
  ```

  结果 `1 passed (7.3s)`。分段 evidence 为：`beforeFirstWheel` 一条
  `scrollTo({ behavior: "auto", top: 3964 })`，`firstWheelToTakeover=[]`，
  `postTakeover=[]`；因此旧 R28 未分段 run 中看到的同一 writer 实际发生在首 wheel
  之前，不能当作 takeover 后回归。同步 revoke/lease 单测和真实 browser 的 post-
  takeover writer 结论一致，TC-0186 按公开 successor PASS 迁移。

## TC-0187 — F7 收起虚拟列表里的长消息时，合法 clamp 后控件仍可用且没有第二次位移

- **Baseline:** `fae8b70:tests/browser/f3-message-fold.spec.js:151`；旧动作包含
  `deep-history/1311`、45 行长消息 + 后续短消息、展开同一 virtualized row、采样
  `scrollTop`/button geometry/reading trace，再收起并验证合法 clamp、控件连接/聚焦、
  无第二次位移及下一次 wheel 可用，见
  [旧 case](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/TEST-CASE-MIGRATION-LEDGER.md:538)。
- **Capability:** 用户在虚拟列表中收起长消息后，折叠控件必须仍可见、可用、保持焦点；若
  物理边界要求 clamp，只允许一次预算内位移，不能发生第二次全量跳动；后续 wheel 仍
  能移动真实列表。
- **Invariant:** collapse 的 layout/reading anchor 由当前 timeline virtualizer + Reading
  owner 协同；合法的 `desired = beforeScrollTop - shrink` 及 `[0,maxScrollTop]` clamp
  是唯一位移预算，不能用截图或日志代替 geometry。
- **Current public owner:** fold rendering/toggle 由
  [FoldableBody.jsx:80-156](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/FoldableBody.jsx:80)
  和 Timeline row；位置/anchor restore 的公开 adapter 是
  [VendorListExecutor.jsx:997-1069](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/VendorListExecutor.jsx:997)。
  当前 successor 在 [fold-collapse-anchor.spec.js:245-347](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/fold-collapse-anchor.spec.js:245)。
- **Setup/action/observable:** 当前真实 App reset `deep-history/20260918`；每个 placement
  发送六条 46 行长消息，再发送短尾使长消息历史化；用真实 wheel 将同一 row 的 toggle
  物化并分别放在视口中部（clamp 不成立）和靠顶（允许 clamp）；展开、采样每帧
  connected/rowID/foldID/top/bottom/scroll geometry，收起后断言 `aria-expanded=false`、
  button connected/focused/在 viewport 内、折叠体确实缩短、只发生允许的 clamp、无普通
  layout error，随后真实 wheel 仍改变 `scrollTop`。
- **Evidence/disposition:**

  ```sh
  ATOLL_TEST_WEB_PORT=16550 ATOLL_TEST_MOCK_PORT=19950 \
    npx playwright test tests/browser/fold-collapse-anchor.spec.js --grep '收起：' \
    --reporter=line --workers=1 --output=test-results-e-h-r28-f3-0187-collapse-both-3432851
  ```

  结果 `2 passed (32.8s)`（中部和靠顶各一条）。这是完整的公开虚拟列表动作和
  geometry/focus/next-wheel observable，故 TC-0187 严格 PASS。

## 1487 strict ledger mapping

TC-0183–0187 仍是五个独立 baseline rows；本报告没有把旧 fixture 的多个 phase 合并成
一个 suite case。可纳入严格 1487 总账的逐案结果为：0183 PASS、0184 PASS（公开
semantic successor）、0185 PASS（公开 behavior successor）、0186 PASS（R29 分段公开
successor）、0187 PASS。0186 的旧未分段 `writes` 红证据保留为审计历史，但不再作为
当前 disposition；只有 `postTakeover=[]` 才被迁移为 PASS。

## Verification boundary

本轮结果基于各命令输出目录中的 focused evidence。shared worktree 在跑测后仍可能有
其他 owner 的未提交源码/测试变更；本报告未 stage 或修改它们。0186 的旧 aggregate
failure 与 R29 分段 evidence 均保留，最终判定只采信 takeover 后阶段；未改产品来追绿。
