# E–H round 25 — F8 terminal-session runtime proof

This round avoids the already-closed EH03 governance, F6 accessibility, and
F7 terminal-split contracts.  It audits the retained F8 terminal-session rows
TC-0240–0242 through the current public `WorkspaceFeatures`/`TerminalFeature`
owner.

The current migrated file had silently dropped F8-002, so its remaining 2/2
green cases were not sufficient evidence for the three-row baseline.  This
round restores the complete F8-002 action and observable without changing the
production owner or weakening the other two cases.

## Focused verification

The final isolated run started at HEAD `a1c9670`:

```text
ATOLL_TEST_WEB_PORT=16535 ATOLL_TEST_MOCK_PORT=19935 \
  npx playwright test tests/browser/f8-terminal-session.spec.js \
  --reporter=line --workers=1 \
  --output=test-results-e-h-r25-f8-terminal-session-restored-rerun

3 passed (16.9s)
```

The preceding fresh-port attempt exercised all three cases but F8-001 captured
one Vite `504 Outdated Optimize Dep` resource error while importing the
optional WebGL addon; F8-002 and F8-003 passed.  The same-head rerun loaded the
addon and passed all three.  The final run still logs the expected
`WebGL2 not supported`/DOM-renderer fallback warnings because the test
explicitly launches Chromium with `--disable-webgl`; these are warnings, not
page errors, and the test's existing error assertion remains unchanged.

## Case-level owner and invariant

The shared invariant is that terminal session truth is bound to the committed
channel/workspace and the service-side shell/session replay, not to whichever
terminal DOM happens to be mounted.  One PTY WebSocket may carry the active
terminal stream across channels, while the screen for each channel is restored
at the seam.  A channel switch, main-view change, or reload must not expose a
different channel's screen or lose the committed shell.

The current public owner is unchanged from F7:

- `WorkspaceLayout` owns channel selection and the terminal split surface.
- `WorkspaceFeatures` retains an already-open channel's terminal view and
  mounts the channel-keyed `TerminalFeature`.
- `TerminalFeature` owns the public terminal host and command port; its xterm
  screen is attached/detached through the current channel/device session.

Source anchors:

- [WorkspaceFeatures.jsx:86](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:86)
- [WorkspaceFeatures.jsx:100](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/WorkspaceFeatures.jsx:100)
- [TerminalFeature.jsx:152](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/terminal/TerminalFeature.jsx:152)
- [TerminalFeature.jsx:311](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/ui/features/terminal/TerminalFeature.jsx:311)

## Case-level proof

### TC-0240 / F8-001 — two channels, one live PTY WS, each screen restored

- **Baseline file and exact case:**
  [tests/browser/f8-terminal-session.spec.js:64](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f8-terminal-session.spec.js:64), `F8-001 两个频道各开终端：恒只有一条 WS，来回切各看各的屏`.
- **User capability:** a user can open terminals in two channels and switch
  between them repeatedly; each channel returns to its own shell screen while
  the product keeps at most one live PTY WebSocket at a time.
- **Old setup/action:** use the real login with Chromium's DOM-renderer test
  path (`--disable-webgl`); instrument only browser-side `/pty` WebSocket live
  and peak counts; open channel `c0`, type `echo MARK_ZERO`, switch to
  `c0.project`, type `echo MARK_ONE`, then switch back and forth three rounds.
  The current test also waits for each committed `main h1` (`c0` or
  `c0.project`) before reading the screen; this is an owner-readiness fence,
  not a new behavior.
- **Observable result:** each return contains its matching marker, the peak
  simultaneous `/pty` socket count is `<= 1`, and page errors remain empty
  (the protected-resource 401 is the only intentionally ignored fixture
  console error).
- **Evidence:** the complete action and assertions remain in
  [f8-terminal-session.spec.js:64](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f8-terminal-session.spec.js:64);
  the final three-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.  The repeated channel and
  screen identity proof is not replaced by a DOM count or a single switch.

### TC-0241 / F8-002 — switching the main view retains the terminal screen

- **Baseline file and exact case:**
  [tests/browser/f8-terminal-session.spec.js:94](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f8-terminal-session.spec.js:94), `F8-002 切主视图再回来，屏幕还在`.
- **User capability:** a user can leave the terminal surface for the Files
  view and return to the `动态` main view without losing the existing shell
  screen.
- **Old setup/action:** log in, open the terminal, type `echo KEEP_TAB`, wait
  for the marker, click `#workspace-files-toggle`, wait for the existing
  transition settle, click the `动态` tab, and read the visible terminal
  screen.
- **Observable result:** the visible terminal screen still contains
  `KEEP_TAB` after the main-view round trip.
- **Current owner bridge:** the restored case uses the existing
  `WorkspaceFeatures` terminal retention and the current public `动态` tab;
  it does not mount a test-only terminal or inspect private session state.
- **Evidence:** this complete baseline case was restored at
  [f8-terminal-session.spec.js:94](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f8-terminal-session.spec.js:94),
  and the final three-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT** after restoring the missing case.

### TC-0242 / F8-003 — reload reconnects the same shell and screen

- **Baseline file and exact case:**
  [tests/browser/f8-terminal-session.spec.js:103](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f8-terminal-session.spec.js:103), `F8-003 刷新整页再打开，接回同一个 shell 且屏幕还在`.
- **User capability:** a user can refresh the page, reconnect, and reopen the
  terminal without losing the existing shell's screen.
- **Old setup/action:** log in, open the terminal, type `echo KEEP_RELOAD`, wait
  for the marker, reload the page, wait for the connection to be open, open
  the terminal if it is not mounted, and read the visible screen.
- **Observable result:** the connection is open and the visible terminal
  screen contains `KEEP_RELOAD` after reload/reopen.
- **Evidence:** the complete action and assertions remain in
  [f8-terminal-session.spec.js:103](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f8-terminal-session.spec.js:103),
  and the final three-case run passed it.
- **Disposition:** **ACCEPT / PROVEN-DIRECT**.

## Coverage and regression boundary

All three baseline rows now have one-to-one direct browser evidence.  The
previous 2/2 result was not counted because it omitted F8-002; the restored
case preserves its original action and screen observable.  F8-001's temporary
Vite optimizer 504 is not a product regression because the same-head fresh
port rerun passed without changing the test or product.

No source, vendor, package, lockfile, private export, old API, skip, or
expected-fail witness was changed.  No product-regression packet is warranted.
