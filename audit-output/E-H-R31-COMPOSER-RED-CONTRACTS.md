# E-H R31 — Composer red contracts (TC-0169/0170/0171/0173)

Date: 2026-09-20
Baseline: `fae8b70` (`fae8b7010afd1b3a950bc455ba6a577b65378cda`)
Runtime commit: `5ae1fca` (the unrelated working-tree product edits were not
staged by this round)
Owner boundary: the existing public Composer/Conversation/Workspace owners;
no product file was changed in R31.

This packet is the four-case acceptance contract requested after R30. Each row
keeps the exact historical action and stops at its first violated observable.
The cases are independent: TC-0170 does not borrow TC-0169's pass/fail result,
and TC-0173 does not replace the missing channel-file action with a local-file
control.

## Verification

The strict successors and their first evidence were run with real Chromium. The
host's Vite watcher required polling (`ENOSPC` without it); polling changes only
watcher mechanics, not the browser contract.

```text
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16564 ATOLL_TEST_MOCK_PORT=19964 npx playwright test tests/browser/f3-composer-target.spec.js --reporter=line --workers=1 --output=test-results-e-h-r30-f3-composer-target-poll
TC-0169/TC-0170/TC-0171: 3 failed at their first strict observable

CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16567 ATOLL_TEST_MOCK_PORT=19967 npx playwright test tests/browser/f3-composer-baseline-0172-0175.spec.js --grep 'TC-0173' --reporter=line --workers=1 --output=test-results-e-h-r30-tc0173
TC-0173: failed at 30s waiting for its historical public control
```

`node --check` and `git diff --check` are run before the R31 commit. The
Playwright artifacts below are the evidence, not a substitute for the case
records.

## Case records

### TC-0169 — REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f3-composer-target.spec.js:48`,
  “F3-CT-02 过滤条收窄到一个 agent 时，默认收件人跟着它走”; strict
  successor [f3-composer-target.spec.js:42](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:42).
- **Old behavior / user capability:** the user can choose one visible member in
  the public filter bar and immediately see the Composer default recipient
  follow that filter, including why the target was chosen.
- **Invariant:** after the second public filter button is clicked, the status
  is exactly `@Claude`, its title contains `跟随筛选`, it has the filter-derived
  target class, and clearing the chip removes that source reason. Text alone is
  insufficient because the source authority is user-visible.
- **Current public owner:** the filter affordance and persisted actor-filter
  state are [ConversationSurface.jsx:273](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/conversation/ConversationSurface.jsx:273)
  and [useTimelinePreferences.js:73](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/timeline/useTimelinePreferences.js:73).
  The public bridge is [WorkspaceApp.jsx:829](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:829),
  which calls Composer's existing public `selectAgent`; rendering remains
  [Composer.jsx:418](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:418).
  No private helper or test-only owner is used.
- **Exact setup/action/result:** reset `multi-channel`, login as root, assert
  the two public filter buttons, click the second, then retain the historical
  title/text/class/clear assertions. The first red observable was
  `title="@Claude · @Claude"`, class `composer-target is-direct`, rather than
  `/跟随筛选/`; see [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-f3-composer-target-poll/f3-composer-target-F3-CT-02-过滤条收窄到一个-agent-时，默认收件人跟着它走/error-context.md:1).
- **Disposition / acceptance:** `REGRESSION`. The Composer owner must preserve
  filter authority and its source label; the successor is accepted only when
  the full old click → observable → clear sequence passes without weakening the
  title, class, or chip assertions.

### TC-0170 — REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f3-composer-target.spec.js:65`,
  “F3-CT-03 编辑框里的 @ 压过筛选”; strict successor
  [f3-composer-target.spec.js:58](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:58).
- **Old behavior / user capability:** after a one-member filter chooses a
  default recipient, the user can type `@`, choose a different member, and
  explicitly override that filter target.
- **Invariant:** the precondition remains `跟随筛选`; after public mention
  selection the status is exactly the mentioned agent, title is `由 @ 指定`,
  and exactly one target chip remains. The precondition is part of this case,
  not an assertion inherited from TC-0169.
- **Current public owner:** Composer's public mention query/selection path is
  [Composer.jsx:221](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:221)
  and [Composer.jsx:252](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:252);
  the filter-to-Composer bridge is the same public callback at
  [WorkspaceApp.jsx:829](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:829).
- **Exact setup/action/result:** reset `multi-channel`, login, click the second
  public filter, assert its strict filter-authority precondition, then perform
  the original `@` selection. The first red was the precondition itself:
  `title="@Claude · @Claude"`, not `/跟随筛选/`; the action was not silently
  substituted. Evidence is [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-f3-composer-target-poll/f3-composer-target-F3-CT-03-编辑框里的-压过筛选/error-context.md:1).
- **Disposition / acceptance:** `REGRESSION`. Keep both authority phases in
  the same test. A future owner fix is accepted only after the strict filter
  precondition and explicit mention override both pass.

### TC-0171 — REGRESSION

- **Baseline/title:** `fae8b70:tests/browser/f3-composer-target.spec.js:82`,
  “F3-CT-04 无收件人是警告格，不是留白；且横幅恒不整块进出”; strict
  successor [f3-composer-target.spec.js:74](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-target.spec.js:74).
- **Old behavior / user capability:** when the user enters a channel with no
  recipient, the Composer stays discoverable and explains why sending is
  unavailable; it does not disappear into an empty or inaccessible surface.
- **Invariant:** `.composer-disabled-reason` is visible; the recipient status
  remains visible with `is-none is-muted`; its exact text is `⚠ 无收件人`; and
  its title explains how to choose a member. This is a warning/failure
  feedback contract, not merely an access gate.
- **Current public owner:** access visibility is decided by
  [WorkspaceApp.jsx:87](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:87)
  and the public inaccessible placeholder is selected at
  [WorkspaceApp.jsx:837](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:837).
  When mounted, the Composer's public warning rail remains
  [Composer.jsx:444](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:444).
- **Exact setup/action/result:** reset `multi-channel`, login, click public
  `c0.public`, then perform the old warning/status/geometry assertions. The
  first violation was the access placeholder text `频道内容不可访问`; no
  `.composer-disabled-reason` existed. Evidence is [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-f3-composer-target-poll/f3-composer-target-F3-CT-04-无收件人是警告格，不是留白；且横幅恒不整块进出/error-context.md:1).
- **Disposition / acceptance:** `REGRESSION`. The public owner must decide how
  the no-recipient warning remains discoverable under the current access route;
  replacing it with a generic placeholder is not equivalent. The historical
  exact warning/title/geometry assertions remain required.

### TC-0173 — REGRESSION / MISSING PUBLIC OWNER

- **Baseline/title:** `fae8b70:tests/browser/f3-dynamic.spec.js:40`,
  “F3-003..005 键盘、多行草稿、附件入口与 320px 单表面可达”; strict
  successor [f3-composer-baseline-0172-0175.spec.js:46](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f3-composer-baseline-0172-0175.spec.js:46).
- **Old behavior / user capability:** the user can retain a multiline draft
  while opening and closing the public channel-file picker, return to 动态,
  choose `steward`, send, and reach the resulting turn on a 320px viewport.
- **Invariant:** both draft lines survive the picker round trip; the sent turn
  is visible; document and Composer geometry do not overflow 320px; and no
  edit/stop/retry controls appear. The channel-file action is part of the
  capability, not an optional setup detail.
- **Current public owner:** Composer's only current attachment affordance is
  the local-file input at [Composer.jsx:436](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/composer/Composer.jsx:436).
  Channel artifacts are exposed by the existing Files feature. No public
  Composer button named `从频道文件选择` exists, so there is no authorized
  equivalent owner to call from this test.
- **Exact setup/action/result:** reset `long-running`, login, type the two
  historical lines, then perform the unchanged public button action. Chromium
  timed out after 30 seconds waiting for `button[aria-label="从频道文件选择"]`;
  see [error-context.md](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/test-results-e-h-r30-tc0173/f3-composer-baseline-0172--59cca-5-键盘、多行草稿、附件入口与-320px-单表面可达/error-context.md:1).
- **Disposition / acceptance:** `REGRESSION / MISSING PUBLIC OWNER`. Do not
  replace the action with the local upload input or a private Files selector.
  The owner handoff must provide one public channel-file action, then rerun the
  whole draft → picker → return → send → 320px sequence unchanged.

## R31 disposition

| Case | Result | Current public owner / first red |
| --- | --- | --- |
| TC-0169 | REGRESSION | ConversationSurface filter → WorkspaceApp callback → Composer target source title |
| TC-0170 | REGRESSION | Same filter authority plus Composer public mention override |
| TC-0171 | REGRESSION | WorkspaceApp access visibility versus Composer warning rail |
| TC-0173 | REGRESSION / MISSING PUBLIC OWNER | Composer local input exists; historical channel-file control does not |

No product owner submission was present when these cases were captured. The
four rows remain open for independent post-owner acceptance; no source, vendor,
package/lockfile, private export, skip, deletion, or compatibility owner was
added.
