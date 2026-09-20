# E-H R32 — F7 notification baseline proof (TC-0202–TC-0206)

Date: 2026-09-20
Baseline: `fae8b70` (`fae8b7010afd1b3a950bc455ba6a577b65378cda`)
Runtime product commit: `0054155`
Successor: [f7-channel-notifications.spec.js](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-channel-notifications.spec.js:1)

These are the next five recoverable, one-to-one notification declarations
after the already accepted F6 accessibility rows. Each case retains the old
setup/action/observable; no suite count is used as a substitute for a case
record.

## Verification

The host Vite watcher required polling (`ENOSPC` without it). A fresh real
Chromium/mock run used one worker:

```text
CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=100 ATOLL_TEST_WEB_PORT=16602 ATOLL_TEST_MOCK_PORT=20002 npx playwright test tests/browser/f7-channel-notifications.spec.js --reporter=line --workers=1 --output=test-results-e-h-r32-f7-notifications
5 passed (26.1s)
```

## Case records

### TC-0202 — PASS

- **Baseline/title:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:118`,
  “F7 inactive-channel business and core progress never create rail or
  new-dynamic counts”; successor
  [f7-channel-notifications.spec.js:34](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-channel-notifications.spec.js:34).
- **User capability:** while `c0.project` is inactive, provisional business
  progress and dense core progress must not create a rail badge or “new
  dynamic” count; switching to the channel must still open its committed
  content without a fabricated count.
- **Invariant:** notification high-water/read authority is keyed by channel and
  canonical root identity. Lifecycle/progress rows are not readable
  conversation notifications. The owner must not count repeated child/progress
  frames as new dynamic content.
- **Current public owner:** semantic classification is
  [notification-policy.js:43](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/notification-policy.js:43),
  canonical channel unread projection is
  [channel-feed-runtime.js:724](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:724),
  and visible rail badges are rendered by
  [WorkspaceLayout.jsx:74](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:74).
- **Exact setup/action/result:** reset `multi-channel/2620`, login, push 20
  provisional frames and one dense progress action to inactive `c0.project`,
  assert both unread badge classes remain absent, click `c0.project`, and
  assert no `条新动态`. The complete strict successor passed in the focused
  five-case run.
- **Disposition:** `PASS / PROVEN-DIRECT`.

### TC-0203 — PASS

- **Baseline/title:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:148`,
  “F7 channel rail exposes live Agent timers and the member filter acknowledges
  completion”; successor
  [f7-channel-notifications.spec.js:64](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-channel-notifications.spec.js:64).
- **User capability:** a live Agent operation remains visible in the rail for
  its originating channel while the user views another channel, then clears
  after computation completes.
- **Invariant:** live activity is a canonical Feed activity snapshot keyed by
  channel/request and visible only for the current connection generation; a
  channel switch cannot erase it, and completion cannot leave a zombie timer.
- **Current public owner:** Feed projects activity through
  [channel-feed-runtime.js:474](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:474)
  and exposes per-channel snapshots at
  [channel-feed-runtime.js:1697](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1697);
  [WorkspaceLayout.jsx:48](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:48)
  renders the public timer and channel rail.
- **Exact setup/action/result:** reset `long-running/2610`, login, choose
  steward through the public Agent menu, send the real operation, observe one
  home timer, switch to `c0.project` and back while it remains one, advance
  computation three times, and observe zero timers. The successor passed.
- **Disposition:** `PASS / PROVEN-DIRECT`.

### TC-0204 — PASS

- **Baseline/title:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:174`,
  “F7 server boot change cannot leave a zombie Agent timer”; successor
  [f7-channel-notifications.spec.js:82](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-channel-notifications.spec.js:82).
- **User capability:** after the server world changes and the old connection
  is dropped, the user does not see a stale live Agent timer from the prior
  boot.
- **Invariant:** activity visibility is fenced by server world/generation and
  connection state. Old activity is withdrawn on reset/drop; reconnect must
  not resurrect it from a stale owner.
- **Current public owner:** the Feed activity snapshot's `generation` and
  `connected` gates are visible at
  [channel-feed-runtime.js:474](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:474),
  while transport reset/disconnect reaches the Feed activity port via
  [channel-feed-runtime.js:1651](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1651)
  and the wire owner in [WorkspaceApp.jsx:494](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:494).
- **Exact setup/action/result:** reset `long-running/2611`, login, start the
  public long task, reset to `multi-channel/2612`, issue public mock `drop`,
  await `OPEN`, and require zero `.channel-agent-timer`. The successor passed.
- **Disposition:** `PASS / PROVEN-DIRECT`.

### TC-0205 — PASS

- **Baseline/title:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:189`,
  “F7 unresolved history after a same-boot reload stays quiet until fresh live
  progress”; successor
  [f7-channel-notifications.spec.js:96](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-channel-notifications.spec.js:96).
- **User capability:** reloading while an operation is unresolved does not
  manufacture a live timer; after a fresh live progress frame confirms the
  current generation, the timer becomes visible again.
- **Invariant:** reload begins with no live activity claim; only a fresh
  canonical progress event in the current activity generation can establish
  the timer. A persisted unresolved row is not a live notification.
- **Current public owner:** generation/connection filtering is
  [channel-feed-runtime.js:477](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:477),
  with the public rail consumer at
  [WorkspaceLayout.jsx:48](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:48).
- **Exact setup/action/result:** reset `long-running/2613`, login, start the
  real operation, reload, require `OPEN` and zero timers, advance one live
  computation frame, then require one timer. The successor passed.
- **Disposition:** `PASS / PROVEN-DIRECT`.

### TC-0206 — PASS

- **Baseline/title:** `fae8b70:tests/browser/f7-channel-notifications.spec.js:207`,
  “F7 completion during a same-boot disconnect reconciles to red, never zombie
  green”; successor
  [f7-channel-notifications.spec.js:112](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/f7-channel-notifications.spec.js:112).
- **User capability:** if completion happens during a same-boot disconnect,
  reconnect does not present the old live timer as still running.
- **Invariant:** disconnect removes the active activity projection; later
  completion/reconnect cannot turn the disconnected operation back into a live
  green timer without a new canonical activity frame.
- **Current public owner:** explicit activity disconnect is
  [channel-feed-runtime.js:1651](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/model/channel-feed-runtime.js:1651),
  and the rail is [WorkspaceLayout.jsx:66](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceLayout.jsx:66).
- **Exact setup/action/result:** reset `long-running/2614`, login, start the
  real task, issue public mock `drop`, require reconnecting, advance three
  computation steps, await `OPEN`, then require zero timers. The successor
  passed.
- **Disposition:** `PASS / PROVEN-DIRECT`.

## Disposition

| Case | Result |
| --- | --- |
| TC-0202 | PASS |
| TC-0203 | PASS |
| TC-0204 | PASS |
| TC-0205 | PASS |
| TC-0206 | PASS |

All five cases retain independent actions and observables. No product, vendor,
package/lockfile, private export, skip, deletion, or compatibility owner was
added.
