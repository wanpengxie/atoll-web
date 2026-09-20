# E-H R27 — F3 Composer/reading baseline proof

本轮恢复 `fae8b70` 的 TC-0176–0182。旧的
`tests/browser/f3-dynamic.spec.js`、`f3-math-markdown.spec.js` 不在当前工作树，
因此把每条 case 迁到当前公开入口
[f3-dynamic-restore.spec.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:1)。
七条保持分开的测试；没有合并 case、删除断言、skip、私有 export 或产品改动。

## 结论

在共享产品 owner 引入 `WorkspaceApp` automation 改动以前，用真实 Chromium、真实
mock reset endpoint 的 focused rerun 得到 6 PASS、1 PRODUCT REGRESSION。之后的全量
重跑不能作为 F3 结果：共享工作树中的 `WorkspaceApp.jsx` 先出现
`automationAvailable` TDZ，随后 Vite 报出四个 automation 标识符重复声明，App 无法
稳定挂载；这不是测试 fixture 结果，也未由本轮测试修改。TC-0178 的红色证据来自
TDZ 之前的有效跑测，须保留并交 Composer/layout owner。

| Case | 当前结果 | focused 证据 |
| --- | --- | --- |
| TC-0176 | PASS | `.composer-editor` 聚焦时 `outline-style=none`，编辑器/外层高度与圆角均满足旧阈值。 |
| TC-0177 | PASS | 连续中文输入前后 dynamic panel 的 top/bottom 位移均 `<=1px`；当前公开 panel 是 `#workspace-panel-dynamic`。 |
| TC-0178 | PRODUCT REGRESSION | Composer 从 `76px` 增至 `142px`，但 timeline bottom 未让出同等空间；`beforeTimeline.bottom - afterTimeline.bottom = 0`，surface growth `=66`，严格差值 `66px`。 |
| TC-0179 | PASS | 审批卡在正文列，`.narration` 数为 0；桌面及 320px 下左右边界和页面宽度均满足旧合同。 |
| TC-0180 | PASS | mock approval 到达后 approval 数增加；30 次采样没有 scrollTop 反向跳变，bottom 与 top 差值始终 `<=2`。 |
| TC-0181 | PASS | 发送真实 LaTeX 后有 2 个 KaTeX，`PONG` 可见；窄屏页面不横溢出，display math 保持可滚动且有正宽度。 |
| TC-0182 | PASS（focused） | 当前 authority row 首次进入及切频道返回保持展开；追加第二条后首条变历史且 `展开全文` 为 `aria-expanded=false`，仅一个 folded body。 |

## Case records

### TC-0176 — Composer 聚焦时只有一个紧凑的外层焦点表面

- **Baseline:** `fae8b70:tests/browser/f3-dynamic.spec.js:111`，同名 successor
  [line 39](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:39)。
- **Capability:** 用户聚焦消息 Composer 时获得单一、紧凑、可识别的外层焦点表面，输入区域不出现额外原生 outline。
- **Invariant:** Composer 的编辑 DOM 与 surface 是同一公开 Composer owner；聚焦只改变 presentation，不写入消息/频道事实。
- **Current public owner:** `Composer` 的公开 contenteditable attributes 在
  [Composer.jsx:235-243](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:235)，surface form 在
  [Composer.jsx:417](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:417)。
- **Setup/action/observable:** reset `message-flow/1306`；登录 root/root；聚焦
  `.composer-editor`；读取 editor outline、editor/surface geometry 与 border radius；保持
  `none`, `<=50`, `<=96`, `>=12` 原断言。
- **Result/disposition:** PASS。真实 Chromium 通过；不是 source fingerprint 或 hidden UI。

### TC-0177 — 连续中文输入不改变 Composer 与消息区布局尺寸

- **Baseline:** `fae8b70:tests/browser/f3-dynamic.spec.js:132`，successor
  [line 60](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:60)。旧 selector
  `getByRole('tabpanel', {name:'动态'})` 在当前 DOM 没有可计算 accessible name；迁移到同一
  public panel id `#workspace-panel-dynamic`，没有改变动作/可见结果。
- **Capability:** 连续中文输入期间消息区位置稳定，不因 composition/input 每个字符上下抖动。
- **Invariant:** Composer draft/input owner 与 ConversationSurface dynamic panel 的 layout
  contract 分离；输入不由测试或 fixture 改写 timeline geometry。
- **Current public owner:** Composer editor 同上；ConversationSurface 的 dynamic panel
  [ConversationSurface.jsx:257-263](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:257)。
- **Setup/action/observable:** reset `message-flow/1307`；登录；聚焦公开消息 textbox；以
  10ms 间隔输入完整中文句；对同一 surface/panel 记录 before/after；top、bottom 位移各
  `<=1px`。
- **Result/disposition:** PASS。旧动作与几何 observable 保持；只替换了失效的 accessible
  selector。

### TC-0178 — Composer 多行增长向上并为消息区让出等量空间

- **Baseline:** `fae8b70:tests/browser/f3-dynamic.spec.js:150`，successor
  [line 78](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:78)。同样只把当前 dynamic panel 的
  locator 迁到 `#workspace-panel-dynamic`。
- **Capability:** 多行 Composer 向上增高时，消息区在固定上边界下向上让出同等空间；恢复/挂载
  过渡不能产生用户可见的零尺寸可操作输入。
- **Invariant:** Composer surface growth 与 ConversationSurface/timeline geometry 由当前
  owner 协调；阅读恢复 handoff 不能掩盖真实布局缺口。
- **Current public owner:** Composer surface 仍为
  [Composer.jsx:417](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:417)；dynamic panel 为
  [ConversationSurface.jsx:257-263](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:257)。阅读/DOM 观察边界由
  [useBrowsingReadingController.js:24-25](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:24) 维护，但本 case 的首差异是 layout，不是 history fixture。
- **Setup/action/observable:** reset `message-flow/1308`；登录并等待 timeline list 可见、Composer
  surface 非零；记录 surface/panel；填四行文本；要求 surface 增长、panel top 不变，并要求
  `beforeBottom-afterBottom == surfaceGrowth`（容差 1px）。另附 readiness handoff JSON。
- **Result/disposition:** PRODUCT REGRESSION。有效跑测证据为 surface `76→142`, growth
  `66px`；timeline top `101` 不变，bottom `588→588`，因此等量让位差值 `66px`。这不是 stale
  fixture：reset 返回 OK、真实 Chromium 已完成登录和前置可见性，TC-0176/0177/0179–0181
  同批 live app 通过。首 owner 边界是 Composer/ConversationSurface layout composition；
  不改测试放宽几何合同，交产品 owner 修复后复跑。

### TC-0179 — 审批使用正文列，后台活动不污染消息主线

- **Baseline:** `fae8b70:tests/browser/f3-dynamic.spec.js:190`，successor
  [line 113](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:113)。
- **Capability:** 用户看到审批时，审批卡落在正文列；后台 narration 不混入消息主线；桌面和 320px
  都不横向溢出。
- **Invariant:** approval 是 timeline row 的正文内容，不是 narration/旁路列；viewport 内
  内容必须保持可达且不制造 document overflow。
- **Current public owner:** `ApprovalCard`/`TurnCard` 在
  [TimelineRowRenderer.jsx:323-352](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:323)，row frame/content column 在
  [TimelineRowRenderer.jsx:20-31](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:20)。
- **Setup/action/observable:** reset `multi-channel/1303`；登录；等待 approval card；断言
  narration 为 0、approval 是正文列唯一卡；桌面及 320x720 读取左右边界，要求 card 不越过
  content，`scrollWidth <= viewport`。
- **Result/disposition:** PASS。保留完整旧 observable；owner 从历史 ledger 的 Composer
  标签收敛到实际 TimelineRowRenderer public owner。

### TC-0180 — 新条目到达时底部固定的信息流不反向抖动

- **Baseline:** `fae8b70:tests/browser/f3-dynamic.spec.js:217`，successor
  [line 140](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:140)。
- **Capability:** 用户停在底部时新条目到达，信息流继续跟随底部而不向上反跳。
- **Invariant:** scroll position 由当前 reading session/navigation owner 统一写入；arrival/DOM
  materialization 不能与用户 scroll writer 竞争或反转方向。
- **Current public owner:** 动态层仍由 ConversationSurface/ReadingContainerHandoff 公开
  安装；reading input attribution/viewport evidence 由
  [useBrowsingReadingController.js:24-170](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useBrowsingReadingController.js:24) 及
  [reading-navigation-coordinator.js:22-239](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/reading-navigation-coordinator.js:22)
  处理。
- **Setup/action/observable:** reset `multi-channel/1304`；登录；确认审批；将
  `.timeline-message-list` scroll 到底；在页面内记录 30×50ms rows 与 adapter/rAF trace；
  调用真实 mock approve；要求 approval 数增加、没有 `scrollTop` 反向下降超过 1px，且每个
  sample 的 `bottom-top` 差值 `<=2`。
- **Result/disposition:** PASS。trace 是补充证据，行为断言仍保留。

### TC-0181 — LaTeX 括号语法渲染且窄屏不撑破

- **Baseline:** `fae8b70:tests/browser/f3-math-markdown.spec.js:21`，successor
  [line 183](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:183)。
- **Capability:** 研究消息中的 inline `\\(...)` 与 display `\\[...]` 被用户看到为公式，
  并在 320px 视口可读、页面不横向溢出。
- **Invariant:** Markdown/KaTeX 是当前消息正文的公开 renderer；窄屏溢出只能落在公式 display
  容器内，不扩大 document viewport。
- **Current public owner:** message body 由 TimelineRowRenderer 的
  `EnvelopeBody`/`ReplyableMessageFrame` [TimelineRowRenderer.jsx:445-463](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:445) 交给当前 Markdown renderer（
  [MarkdownContent.jsx:1-8](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/MarkdownContent.jsx:1)）。
- **Setup/action/observable:** reset `deep-history/1312`；先设 320x720；登录；在公开消息
  textbox 选择 steward；发送原始 inline/display LaTeX；要求两个 `.katex`、`PONG`；对
  `.katex-display` 等待 connected/positive width/`overflow-x=auto`，且 document width 不
  超出 viewport。
- **Result/disposition:** PASS。没有把 source text 或 mock success 当作公式渲染证据。

### TC-0182 — 权威当前消息进入即展开，成为历史后默认折叠

- **Baseline:** `fae8b70:tests/browser/f3-message-fold.spec.js:22`，successor
  [line 221](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-dynamic-restore.spec.js:221)。
  旧实现 selector `[data-presentation-row-id]`/固定 toggle 已不存在；当前测试仍执行发送、
  channel roundtrip、append，并以当前 public row/action observables 等价覆盖。
- **Capability:** 最新 authority 消息长正文首次进入可读且展开；切频道回来不丢失；新消息到达
  后它成为历史并按默认折叠，用户有明确“展开全文”控制。
- **Invariant:** reading/presentation authority 决定 latest row；折叠是 presentation state，
  不把一次默认折叠写成永久业务事实；历史化只改变 latest role，不改变消息内容/identity。
- **Current public owner:** row/presentation projection 由
  [useConversationProjection.js:912-945](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useConversationProjection.js:912) 提供 `latestRowID`；renderer 在
  [TimelineRowRenderer.jsx:479-517](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/TimelineRowRenderer.jsx:479) 以 latest/automatic expansion 传入
  `FoldableBody`，其公开 toggle 在 [FoldableBody.jsx:80-156](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/FoldableBody.jsx:80)。
- **Setup/action/observable:** reset `deep-history/1313`；登录；发送带 marker 及 44 行正文的
  durable message；锁定 active reading layer 的唯一 matching article；确认最后一行可见、
  没有 folded body；切 `c0.project` 后回 `c0`，重复确认；再发送后续消息，锁定同一 marker
  row，要求 `/展开全文/` button `aria-expanded=false` 且一个 `.message-fold.is-folded`。
- **Result/disposition:** PASS（focused rerun，8.6s）。当前 row 的按钮 accessible name 含行数
  后缀（实际如 `展开全文 · 45 行`），所以用 `/展开全文/` 精确保留语义而不是脆弱的旧完整
  label；没有去掉 expanded/folded 行为断言。

## Verification record

有效迁移跑测（在 automation source TDZ 出现前）：

```sh
ATOLL_TEST_WEB_PORT=16538 ATOLL_TEST_MOCK_PORT=19938 \
  npx playwright test tests/browser/f3-dynamic-restore.spec.js \
  --reporter=line --workers=1 --output=test-results-e-h-r27-f3-dynamic-rerun
```

结果：`5 passed, 2 failed`；失败为 TC-0178 上述真实 layout regression，以及 TC-0182
旧完整 accessible-name selector；将后者迁到当前实际 accessible name 后，focused rerun：

```sh
ATOLL_TEST_WEB_PORT=16539 ATOLL_TEST_MOCK_PORT=19939 \
  npx playwright test tests/browser/f3-dynamic-restore.spec.js \
  --grep '权威当前消息' --reporter=line --workers=1 \
  --output=test-results-e-h-r27-f3-0182
```

结果：`1 passed (8.6s)`。因此有效 evidence 是 TC-0176/0177/0179/0180/0181/0182
PASS，TC-0178 PRODUCT REGRESSION。

产品提交 `3ebb34a` 后重新执行七条冻结验证：

```sh
ATOLL_TEST_WEB_PORT=16542 ATOLL_TEST_MOCK_PORT=19942 \
  npx playwright test tests/browser/f3-dynamic-restore.spec.js \
  --reporter=line --workers=1 --output=test-results-e-h-r27-f3-dynamic-post-3ebb34a
```

结果：`6 passed, 1 failed (26.2s)`；唯一失败仍为 TC-0178，证据仍是 surface
`76→142`、timeline bottom `588→588`、严格差值 `66px`。其余六条在同一稳定 HEAD
通过，故 TC-0178 是可重复产品回归而非此前运行时阻断。

之后的全量尝试使用 `16540/19940`，不能宣称结果：共享
[WorkspaceApp.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx)
在测试期间先报 `Cannot access 'automationAvailable' before initialization`，之后变为
Vite parse errors（`recordTimerReceipt`、`afterAutomation`、`cancelAutomation`、
`automationAvailable` 各重复声明）。首个失败是登录后 `.connection-state` 不存在；这属于
产品 owner 的未提交共享改动，需修复后重新跑全量，不能把它计入 F3 case disposition。

F4 TC-0188/0189/0190 的旧动作、observable 与前一轮三条 PRODUCT REGRESSION 证据仍保留在
[E-H-R26-F4-TASK-PRODUCT-REGRESSIONS.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/audit-output/E-H-R26-F4-TASK-PRODUCT-REGRESSIONS.md:1)
及其 successor [f4-tasks-restore.spec.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f4-tasks-restore.spec.js:1)。本轮未在上述共享 source
阻断下冒充 F4 重跑或改产品；TDZ/重复声明修复后应按该报告的三条旧合同逐案定向重跑。
