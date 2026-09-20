# E–H round 23 — F6 accessibility/responsive runtime proof

Verification target: the three F6 browser rows that the migration ledger still
listed as `blocked pending product decision` because they had only been
extracted statically: TC-0197, TC-0198, and TC-0199.  This is an evidence-only
round.  EH03 governance was already closed in round 22 and is not recounted;
the extensionless malformed `textResponse` preview fixture is also not treated
as a product failure.

The baseline case ledger requires the exact old setup, action, and observable
result for every case.  The existing public browser owner already contains
those actions, so this round adds runtime evidence rather than changing a
selector or collapsing the cases.

## Focused verification

The final isolated run started at HEAD `158759d`:

```text
ATOLL_TEST_WEB_PORT=16530 ATOLL_TEST_MOCK_PORT=19930 \
  npx playwright test tests/browser/f6-accessibility-responsive.spec.js \
  --reporter=line --workers=1 \
  --output=test-results-e-h-r23-f6-accessibility-final

3 passed (9.3s)
```

The run exercised the real production login and workspace entry.  A previous
run during concurrent workspace edits printed a React dependency-array-size
warning; two subsequent isolated runs, including the run above, did not emit
it.  It is therefore not recorded as a product regression from this evidence.

## Case-level proof

### TC-0197 / F6-003 — responsive geometry, touch targets, and mobile-rail focus

- **Baseline file and exact case:**
  [tests/browser/f6-accessibility-responsive.spec.js:15](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f6-accessibility-responsive.spec.js:15), `F6-003 1280/800/600/320 与 200% 等价视口没有页面横向溢出`.
- **User capability:** a user can use the workspace at the desktop, compact,
  600/640, and narrow/mobile widths without a page-level horizontal overflow;
  visible controls remain touchable at the narrow width; opening and closing
  the mobile channel rail returns focus to its opener.
- **Invariant:** the `SURFACE` owner keeps one committed surface geometry and
  focus owner; viewport and input events do not cross the committed
  channel/view boundary.  A hidden `display:none` control is not counted as a
  painted touch target.
- **Current public owner:** `WorkspaceLayout` renders the mobile rail,
  channel-view tabs, and workspace controls inside the stable
  [SurfaceShell](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/SurfaceShell.jsx:43);
  its topology class and the responsive CSS are the public geometry owner.
  The rail open/close focus lifecycle is in
  [WorkspaceLayout.jsx](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:187).
- **Old setup/action:** reset the real `multi-channel` fixture with seed
  `1603`, log in through the production login, set viewport widths
  `1280, 800, 640, 600, 320` at height `720`, and read
  `document.documentElement.scrollWidth` against `innerWidth`.  At width
  `320`, inspect the painted boxes for `.mobile-channel-toggle`,
  `.header-action`, `.channel-view-tabs button`, and `.send-button`; then click
  `打开频道列表`, click `关闭频道列表`, and observe focus.
- **Observable result:** every width satisfies
  `document.scrollWidth <= viewport`; each visible selected control has both
  dimensions at least `44px`; the rail opens and closes; the original
  `打开频道列表` button is focused after close.
- **Evidence:** the complete action and assertions remain in
  [f6-accessibility-responsive.spec.js:15](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f6-accessibility-responsive.spec.js:15),
  and the final browser run passed this case.
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.  No implementation detail was
  asserted in place of the user-visible geometry, target-size, or focus
  observable.

### TC-0198 / F6-004 — keyboard view navigation and modal isolation/focus return

- **Baseline file and exact case:**
  [tests/browser/f6-accessibility-responsive.spec.js:41](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f6-accessibility-responsive.spec.js:41), `F6-004 主视图支持方向键，Modal 隔离背景并恢复焦点`.
- **User capability:** keyboard users can move from the main `动态` view to
  `任务` with the right arrow; opening global search moves focus into the
  dialog, prevents background interaction, and restores the initiating search
  button after Escape.
- **Invariant:** the current surface owns view-tab focus and the modal focus
  owner makes only sibling application surfaces inert while the dialog layer
  remains available to host the dialog.  The modal must restore each sibling's
  previous inert/`aria-hidden` state and the opener.
- **Current public owner:** view tabs and the workspace surface are rendered by
  [WorkspaceLayout.jsx:333](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:333);
  the public modal focus owner is
  [useModalFocus.js:24](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/primitives/useModalFocus.js:24),
  consumed by the current Search feature.
- **Old setup/action:** reset the real `multi-channel` fixture with seed
  `1604`, log in, focus the `动态` tab, press `ArrowRight`, and observe the
  `任务` tab.  Click the production `全局搜索` opener; observe dialog textbox
  focus, `main[aria-hidden="true"]`, and `main.inert === true`; press Escape
  and observe dialog removal and focus return.
- **Observable result:** `任务` is focused, selected, and its panel is
  visible; the dialog textbox receives focus; `main` has both the accessibility
  and DOM inert markers; Escape removes the dialog and returns focus to the
  exact opener.
- **Evidence:** the complete action and assertions remain in
  [f6-accessibility-responsive.spec.js:41](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f6-accessibility-responsive.spec.js:41),
  while the sibling preservation and restoration implementation is visible at
  [useModalFocus.js:39](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/primitives/useModalFocus.js:39).
  The final browser run passed this case.
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.  The assertion keeps both
  `aria-hidden` and the DOM `inert` contract; it does not replace either with
  a screenshot or a disabled-only check.

### TC-0199 / F6-004 — reduced-motion animation contract

- **Baseline file and exact case:**
  [tests/browser/f6-accessibility-responsive.spec.js:64](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f6-accessibility-responsive.spec.js:64), `F6-004 reduced motion 停止持续动画`.
- **User capability:** a user who requests reduced motion does not receive a
  continuously animated attachment upload indicator.
- **Invariant:** the public style owner must honor the reduced-motion media
  preference at the production entry; no perpetual animation may bypass that
  preference.  This preserves the F6 surface/accessibility contract rather than
  testing a copied CSS string.
- **Current public owner:** the global reduced-motion rule is the existing
  [base.css:50](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/styles/base.css:50)
  style owner, applied to the real composer busy indicator defined at
  [composer.css:95](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/styles/composer.css:95).
- **Old setup/action:** set the real page media preference to
  `reducedMotion: 'reduce'`, log in with fixture seed `1605`, append a real
  `.attachment-tool-busy` node to the production document, and read its
  computed `animationDuration` and `animationIterationCount`.
- **Observable result:** the duration is the reduced-motion `0.01ms` equivalent
  (`0.01ms` or Chromium's `1e-05s`) and iteration count is exactly `1`.
- **Evidence:** the complete action and assertions remain in
  [f6-accessibility-responsive.spec.js:64](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f6-accessibility-responsive.spec.js:64),
  and the final browser run passed this case.
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.  The test observes computed
  behavior under the real media preference and loaded production CSS.

## Coverage and regression boundary

These are three one-to-one direct proofs; no case was merged into a suite-level
green count.  The report closes the static-only runtime gap for TC-0197–0199
without changing the 256 top-level E–H unit-case count.  No source, vendor,
package, lockfile, old API, private export, skip, or expected-fail witness was
changed.  No product-regression packet is warranted: the current public owner
matches every listed baseline action and observable in the final run.
