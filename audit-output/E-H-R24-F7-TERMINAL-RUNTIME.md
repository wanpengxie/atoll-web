# E–H round 24 — F7 terminal runtime proof and restored baseline observables

This round avoids the already-closed EH03 governance cases and F6
TC-0197–0199.  It closes the retained F7 terminal rows TC-0235–0239 through
the current public terminal owner.

The first full run after restoring the missing baseline assertions saw one
development-server error: Vite returned `504 Outdated Optimize Dep` while the
terminal's optional WebGL module was dynamically loading.  The xterm owner
fell back to its documented DOM renderer; the other four cases passed.  A
second isolated run at the same HEAD and with a fresh web/mock port passed all
five cases.  This is an optimizer-startup artifact, not a product behavior
divergence; it is recorded here rather than hidden by changing the error
assertion.

## Focused verification

The run started at HEAD `c5f215f`:

```text
ATOLL_TEST_WEB_PORT=16533 ATOLL_TEST_MOCK_PORT=19933 \
  npx playwright test tests/browser/f7-terminal.spec.js \
  --reporter=line --workers=1 \
  --output=test-results-e-h-r24-f7-terminal-restored-rerun

5 passed (27.9s)
```

The preceding fresh-port attempt used the same real production entry and
captured one `Failed to load resource: the server responded with a status of
504 (Outdated Optimize Dep)` console error in F7-001.  Its xterm fallback still
mounted and F7-002 through F7-005 passed.  A fresh optimizer run passed F7-001
without any product/test relaxation.

## Current public owner

`WorkspaceLayout` owns the terminal split command and the button/keyboard
surface; its `Ctrl+F12` listener and the button both call the same
`navigation.openTerminal` command.  `WorkspaceFeatures` owns the view-lifetime
latch and mounts one keyed `TerminalFeature` per committed channel.  The
terminal owner creates/detaches the xterm session, updates theme in place, and
keeps the PTY handle tied to the channel/device.  The split geometry is the
existing workspace CSS grid.

- [WorkspaceLayout.jsx:244](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:244)
- [WorkspaceLayout.jsx:248](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:248)
- [WorkspaceLayout.jsx:347](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:347)
- [WorkspaceFeatures.jsx:74](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:74)
- [TerminalFeature.jsx:134](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/terminal/TerminalFeature.jsx:134)
- [TerminalFeature.jsx:152](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/terminal/TerminalFeature.jsx:152)

The architectural invariant for all five rows is unchanged from the baseline:
the terminal session is bound to the committed channel/workspace, and an old
channel or PTY cannot continue writing the current surface.

## Case-level proof

### TC-0235 / F7-001 — open terminal split with messages and no page error

- **Baseline file and exact case:**
  [tests/browser/f7-terminal.spec.js:29](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:29), `F7-001 打开终端分屏：消息与终端同时可见，页面无错`.
- **User capability:** after login, a user can open the terminal beside the
  current conversation; both surfaces are visible and the production page has
  no terminal assembly/runtime error.
- **Old setup/action:** attach page-error and console-error observers (ignoring
  only the fixture's protected-resource 401), open the real login entry with
  `root/root`, click `#workspace-terminal-toggle`, and wait for the terminal
  xterm root.
- **Observable result:** the terminal view is visible, the current public
  conversation region `频道动态` is visible, `.xterm` is mounted, and the
  collected runtime errors are empty.  The current role-region selector is the
  public successor for the old dynamic message pane; it does not replace the
  simultaneous-visibility or error observable.
- **Evidence:** the complete action/assertions are in
  [f7-terminal.spec.js:29](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:29),
  and the final five-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.

### TC-0236 / F7-002 — desktop message/terminal half split

- **Baseline file and exact case:**
  [tests/browser/f7-terminal.spec.js:40](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:40), `F7-002 桌面端消息区与终端左右各占一半`.
- **User capability:** on the desktop surface, opening the terminal leaves a
  usable conversation pane and terminal pane side by side at equal width.
- **Old setup/action:** log in through the real entry, open the terminal split,
  wait for `.xterm`, then measure the terminal and conversation boxes.
- **Observable result:** the two widths differ by less than `3px`, and the
  terminal starts at the conversation's right edge.  The current test reads
  the public `role=region[name="频道动态"]` box rather than the retired
  `.dynamic-message-pane` implementation class; the geometry action and
  thresholds are unchanged.
- **Evidence:** the complete action/assertions are in
  [f7-terminal.spec.js:40](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:40);
  the final five-case run passed it.  The current grid split is owned by the
  existing [app-shell.css:123](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/styles/app-shell.css:123).
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.

### TC-0237 / F7-003 — close/reopen restores full width without rebuilding xterm

- **Baseline file and exact case:**
  [tests/browser/f7-terminal.spec.js:51](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:51), `F7-003 收起再打开：消息恢复全宽，且终端恒不重建`.
- **User capability:** a user can close the split to read the conversation at
  full width and reopen it without losing the existing terminal session/screen.
- **Old setup/action:** log in, open the terminal and wait for xterm; mark the
  xterm root with `data-probe="first"`; record split conversation width; close
  the terminal; observe it hidden and the conversation width greater than
  `1.8 ×` the split width; reopen it.
- **Observable result:** the terminal is visible again and the same xterm root
  still carries `data-probe="first"`.  This node-identity assertion was
  missing from the current migrated test and is restored in this round.
- **Current owner bridge:** `WorkspaceFeatures` retains a once-opened
  channel's `TerminalFeature`; `TerminalFeature` is keyed by the committed
  channel, while `visible` controls the existing mounted view.  No second
  PTY/terminal owner is introduced.
- **Evidence:** the restored full action/assertions are in
  [f7-terminal.spec.js:51](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:51),
  and the final five-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT** after restoring the dropped
  observable.

### TC-0238 / F7-004 — theme switch does not rebuild xterm

- **Baseline file and exact case:**
  [tests/browser/f7-terminal.spec.js:71](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:71), `F7-004 配色可切换，且切换恒不重建终端`.
- **User capability:** a user can switch the terminal from dark to light while
  keeping the same live terminal screen/session.
- **Old setup/action:** log in, open the terminal, wait for xterm, observe the
  initial dark theme, mark the xterm root with `data-probe="first"`, click
  `切到浅色`, and observe the light theme.
- **Observable result:** `data-terminal-theme` becomes `light` while the same
  xterm root still carries the probe marker.  Both the theme result and the
  node-identity result are asserted.
- **Current owner bridge:** `TerminalFeature` changes `terminal.options.theme`
  in its existing `themeMode` effect; the channel-keyed session effect is not
  used as a theme-switch replacement owner.
- **Evidence:** the restored full action/assertions are in
  [f7-terminal.spec.js:71](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:71),
  and the final five-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT** after restoring the dropped
  observable.

### TC-0239 / F7-005 — Ctrl+F12 and the button share one split toggle

- **Baseline file and exact case:**
  [tests/browser/f7-terminal.spec.js:86](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:86), `F7-005 Ctrl+F12 与按钮使用同一个分屏开关`.
- **User capability:** keyboard users can open and close the terminal split
  through the documented `Ctrl+F12` shortcut, with the same state exposed by
  the existing terminal button.
- **Old setup/action:** log in, wait until `#workspace-terminal-toggle` is
  enabled, press `Control+F12` twice, and inspect the terminal view and the
  button's `aria-pressed` state after each press.
- **Observable result:** the first press makes the terminal visible and
  `aria-pressed="true"`; the second hides it and sets
  `aria-pressed="false"`.
- **Current owner bridge:** the existing `WorkspaceLayout` document listener
  and the existing button both call `toggleTerminal`/`navigation.openTerminal`.
  This entire baseline case had been dropped from the current file and is
  restored; no compatibility shortcut or second control owner was added.
- **Evidence:** the restored case is in
  [f7-terminal.spec.js:86](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-terminal.spec.js:86),
  and the final five-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT** after restoring the missing case.

## Coverage and regression boundary

All five baseline rows have one-to-one direct runtime evidence.  The prior
4/4 green result was not accepted as coverage because F7-003 and F7-004 had
lost their node-identity assertions and F7-005 was absent.  The test diff
restores those exact user-visible actions/observables while retaining only
current public selectors.

No product, vendor, package, lockfile, private export, old API, skip, or
expected-fail witness was changed.  No product-regression packet is warranted:
the only red observation was the fresh dev-server optimizer 504, and a
same-HEAD isolated rerun passed all five baseline cases.
