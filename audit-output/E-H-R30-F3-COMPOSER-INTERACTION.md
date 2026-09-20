# E-H R30 — Composer interaction baseline proof (TC-0168–TC-0175)

Date: 2026-09-20
Baseline: `fae8b70` (`fae8b7010afd1b3a950bc455ba6a577b65378cda`)
Runtime HEAD: `1f64485c0d44232b8921dcc0b3e060d2b2dad7df`
Owner: `COMPOSER` — [src/ui/composer/Composer.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:200)

This packet handles eight independent baseline declarations. Each row keeps the
historical file/title, user capability, invariant, public owner, exact action,
and the first observable result. No case is closed by the neighboring suite or
by a merged assertion. TC-0178 and TC-0186 are intentionally out of scope here;
their fixed-reserve and pre/post-wheel contracts were accepted in R29.

## Runtime commands

The first target-suite attempt without polling hit the host inotify limit
(`ENOSPC`, Vite watcher startup); it produced no product verdict. The rerun
used polling only to remove that infrastructure blocker:

```text
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16564 ATOLL_TEST_MOCK_PORT=19964 npx playwright test tests/browser/f3-composer-target.spec.js --reporter=line --workers=1 --output=test-results-e-h-r30-f3-composer-target-poll
1 passed, 3 failed (TC-0168 PASS; TC-0169/TC-0170/TC-0171 real red)
```

The restored historical declarations were run separately, each with a fresh
browser/mock pair and the same polling setting:

```text
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16566 ATOLL_TEST_MOCK_PORT=19966 npx playwright test tests/browser/f3-composer-baseline-0172-0175.spec.js --grep 'TC-0172' --reporter=line --workers=1 --output=test-results-e-h-r30-tc0172    1 passed (6.9s)
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16567 ATOLL_TEST_MOCK_PORT=19967 npx playwright test tests/browser/f3-composer-baseline-0172-0175.spec.js --grep 'TC-0173' --reporter=line --workers=1 --output=test-results-e-h-r30-tc0173    failed at 30s (missing historical public button)
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16568 ATOLL_TEST_MOCK_PORT=19968 npx playwright test tests/browser/f3-composer-baseline-0172-0175.spec.js --grep 'TC-0174' --reporter=line --workers=1 --output=test-results-e-h-r30-tc0174    1 passed (5.8s)
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16569 ATOLL_TEST_MOCK_PORT=19969 npx playwright test tests/browser/f3-composer-baseline-0172-0175.spec.js --grep 'TC-0175' --reporter=line --workers=1 --output=test-results-e-h-r30-tc0175    1 passed (5.7s)
```

`node --check tests/browser/f3-composer-baseline-0172-0175.spec.js` and
`git diff --check` both pass.

## Case evidence

### TC-0168 — PASS

- Historical declaration: `fae8b70:tests/browser/f3-composer-target.spec.js:22`, “F3-CT-01 收件人横幅常显在输入框外，并报出判据来源”; current strict successor is [tests/browser/f3-composer-target.spec.js:22](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:22).
- Old behavior / user capability: after login, the user can always see the active recipient outside the editing surface and can tell why that recipient was selected.
- Invariant: `role=status[aria-label="收件人"]` is visible, has `is-direct`, one target pill and a source title; the pill is geometrically outside/above `.composer-surface` while remaining inside the Composer wrap.
- Current public owner: [Composer.jsx:418-428](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:418) computes delivery text/title and renders the public status/pill; [Composer.jsx:342-367](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:342) owns its placement.
- Exact action/result: reset `multi-channel`, login, then retain every role/class/title/geometry assertion from the baseline. The polling browser run passed this case.
- Disposition: `PASS` — strict assertions are retained, not inferred from the file result.

### TC-0169 — REGRESSION

- Historical declaration: `fae8b70:tests/browser/f3-composer-target.spec.js:48`, “F3-CT-02 过滤条收窄到一个 agent 时，默认收件人跟着它走”; current strict successor is [tests/browser/f3-composer-target.spec.js:42](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:42).
- Old behavior / user capability: selecting one member in the public member-filter bar changes the Composer's default recipient, so the user can see that the default follows the current filter.
- Invariant: the banner text becomes exactly the selected `@agent`, its title contains `跟随筛选`, and clearing the chip removes that source reason.
- Current public owner: [Composer.jsx:418-428](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:418) renders the banner; filter/recipient state is passed through the public Composer model. No private export or test-only owner is used.
- Exact action/result: reset/login, count the two public filter buttons, click the second button, and assert the old text/title contract. Text changed to `@Claude`, but the first violated observable was `title="@Claude · @Claude"` (class `composer-target is-direct`) instead of `/跟随筛选/`. The failure is recorded in [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-f3-composer-target-poll/f3-composer-target-F3-CT-02-过滤条收窄到一个-agent-时，默认收件人跟着它走/error-context.md:1).
- Disposition: `REGRESSION` — do not weaken the source-title assertion or call the text-only change equivalent.

### TC-0170 — REGRESSION

- Historical declaration: `fae8b70:tests/browser/f3-composer-target.spec.js:65`, “F3-CT-03 编辑框里的 @ 压过筛选”; current strict successor is [tests/browser/f3-composer-target.spec.js:58](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:58).
- Old behavior / user capability: after the filter narrows to one agent, typing `@` and choosing a member lets the user's explicit Composer mention override the filter-derived target.
- Invariant: the precondition remains the filter-derived title (`跟随筛选`); after selecting the mention, the banner is exactly that mentioned agent, title is `由 @ 指定`, and exactly one target pill is present.
- Current public owner: [Composer.jsx:221-224](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:221) exposes public mention-query state, [Composer.jsx:252-269](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:252) owns keyboard selection, and [Composer.jsx:433](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:433) renders the public listbox.
- Exact action/result: reset/login, click the second public filter button, then perform the original `@` interaction. The strict precondition failed before the mention action: the banner again exposed `title="@Claude · @Claude"` rather than `/跟随筛选/`; see [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-f3-composer-target-poll/f3-composer-target-F3-CT-03-编辑框里的-压过筛选/error-context.md:1).
- Disposition: `REGRESSION` — the full old sequence is retained and stops at the first violated authority invariant; no later green assertion is fabricated.

### TC-0171 — REGRESSION

- Historical declaration: `fae8b70:tests/browser/f3-composer-target.spec.js:82`, “F3-CT-04 无收件人是警告格，不是留白；且横幅恒不整块进出”; current strict successor is [tests/browser/f3-composer-target.spec.js:74](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:74).
- Old behavior / user capability: entering a channel with no recipient leaves an explicit, stable warning surface so the user understands why sending is unavailable; it is not an empty/missing Composer.
- Invariant: `.composer-disabled-reason` is visible, the recipient status remains visible with `is-none is-muted`, exact text `⚠ 无收件人`, and a title explaining how to choose a member.
- Current public owner: [WorkspaceApp.jsx:87-100](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:87) gates content by public channel access; [WorkspaceApp.jsx:835-839](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:835) renders `ChannelAccessPlaceholder` when content is not visible; Composer's warning rail remains [Composer.jsx:444](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:444) when Composer is mounted.
- Exact action/result: reset/login, click public `c0.public`, then run the first historical warning assertion. The DOM showed the public access placeholder (`频道内容不可访问`) and no `.composer-disabled-reason`; see [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-f3-composer-target-poll/f3-composer-target-F3-CT-04-无收件人是警告格，不是留白；且横幅恒不整块进出/error-context.md:1).
- Disposition: `REGRESSION` — access gating currently removes the exact warning surface, so this is not equivalent to “explicitly unavailable”.

### TC-0172 — PASS

- Historical declaration: `fae8b70:tests/browser/f3-dynamic.spec.js:18`, “F3-001..004/006 动态只保留用户消息与原地定格的 Agent 气泡”; strict successor is [tests/browser/f3-composer-baseline-0172-0175.spec.js:22](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:22).
- Old behavior / user capability: select `steward`, send “浏览器验收一条回合”, and see the user's turn with a settled Agent bubble that remains usable after reload.
- Invariant: the turn is visible and is not the old “向 Agent 提问” placeholder; the Agent bubble has no edit/stop/retry controls, retains exactly one process-record toggle, contains no synthetic `turn-N`/`回合 N`, has no process-summary block, and the same turn remains in the viewport after reload.
- Current public owner: [Composer.jsx:385-390](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:385) submits the public draft; Conversation/turn rendering is reached through the public `ConversationSurface` port in [WorkspaceApp.jsx:800-839](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:800).
- Exact action/result: reset `message-flow` seed `1301`, login, perform the original mention/select/send/reload sequence. The dedicated browser run passed in 6.9s.
- Disposition: `PASS` — this is a one-case successor with every historical observable present.

### TC-0173 — REGRESSION / MISSING PUBLIC OWNER

- Historical declaration: `fae8b70:tests/browser/f3-dynamic.spec.js:40`, “F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达”; strict successor is [tests/browser/f3-composer-baseline-0172-0175.spec.js:46](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:46).
- Old behavior / user capability: keep a multiline draft while opening/closing the public “从频道文件选择” control, return to the dynamic tab, send after selecting `steward`, and reach the resulting turn on a 320px viewport without horizontal overflow or task controls.
- Invariant: both draft lines survive the file-picker round trip; the turn is visible; document scroll width is at most the viewport and the Agent bubble is at most 320px; no edit/stop/retry controls appear.
- Current public owner: Composer's current public attachment affordance is the local-file input at [Composer.jsx:436](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:436), while channel-file navigation is owned by the Files feature. There is no public Composer button named `从频道文件选择` in the current DOM.
- Exact action/result: reset `long-running` seed `1302`, login, write the two lines, then execute the historical button click as the first attachment observable. The test timed out at 30s waiting for `getByRole('button', { name: '从频道文件选择' })`; [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-tc0173/f3-composer-baseline-0172--59cca-5-键盘、多行草稿、附件入口与-320px-单表面可达/error-context.md:1) records the failure.
- Disposition: `REGRESSION` / `MISSING PUBLIC OWNER` — the historical attachment action cannot be substituted with a private selector or silently replaced by a different Files workflow; the later viewport assertions remain unproven until an owner decision supplies an equivalent public action.

### TC-0174 — PASS

- Historical declaration: `fae8b70:tests/browser/f3-dynamic.spec.js:69`, “Composer 的 @成员是收件人条上的芯片，正文恒是纯文本”; strict successor is [tests/browser/f3-composer-baseline-0172-0175.spec.js:81](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:81).
- Old behavior / user capability: choose `@steward`, keep the mention as a recipient chip rather than body text, open the public Files split and return to 动态, then append/send the body.
- Invariant: immediately after selection the banner has one `is-picked` chip and the editor has no `@`; after the Files/dynamic handoff the same chip remains; the sent turn is visible.
- Current public owner: [Composer.jsx:418-433](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:418) owns the chip/body split and mention portal; `#workspace-files-toggle` and the public 动态 tab drive the app's navigation owner.
- Exact action/result: reset `message-flow` seed `1305`, run the original mention → Files → 动态 → append → send actions. The dedicated browser run passed in 5.8s.
- Disposition: `PASS` — chip persistence and plain-body semantics were proven in the same case; no aggregate substitution.

### TC-0175 — PASS

- Historical declaration: `fae8b70:tests/browser/f3-dynamic.spec.js:91`, “正文里的 @ 是字面量：ESC 关掉选择框后照常写、照常发”; strict successor is [tests/browser/f3-composer-baseline-0172-0175.spec.js:101](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:101).
- Old behavior / user capability: type an address beginning with `@`, dismiss the suggestion list with Escape, continue typing/sending it as literal body text, then use a later `@st` mention normally.
- Invariant: Escape removes the listbox without creating a chip; the body remains literal through `@steward@atoll.local 看下`; the later mention creates one chip and Enter sends a visible turn containing the literal address.
- Current public owner: [Composer.jsx:244-287](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:244) owns Escape/Enter authority and [Composer.jsx:433](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:433) owns the public suggestion list.
- Exact action/result: reset `message-flow` seed `1306`, run the original Escape → literal address → later mention → Enter sequence. The dedicated browser run passed in 5.7s.
- Disposition: `PASS` — literal text and subsequent structured mention remain separate in one strict baseline case.

## R30 disposition

| Case | Result | Reason |
|---|---|---|
| TC-0168 | PASS | Default recipient banner and placement fully observed |
| TC-0169 | REGRESSION | Filter source title is `@Claude · @Claude`, not `跟随筛选` |
| TC-0170 | REGRESSION | Same filter-authority precondition fails before `@` override |
| TC-0171 | REGRESSION | Inaccessible discoverable channel removes Composer warning surface |
| TC-0172 | PASS | Full send/render/reload baseline passed |
| TC-0173 | REGRESSION / MISSING PUBLIC OWNER | Historical channel-file picker button does not exist |
| TC-0174 | PASS | Chip/body split and Files/dynamic handoff passed |
| TC-0175 | PASS | Escape literal address and later mention passed |

Net: **5 PASS, 3 real regressions**. No product file, private export, skip, or
compatibility owner was added. The three red cases remain red for their owners.
