# UI-VIS-06 Tasks automation owner acceptance

- Exact verification HEAD: `1cbd754f78be33b89c929944175055bbf04beacd`.
- User capability: from the Tasks surface, a writable member can open the
  local automation panel, arrange one device-scoped action, open its resulting
  task detail, and cancel the still-waiting timer.
- Single owner: `TasksFeature` exposes `commands.openAutomation`; the
  Workspace task port projects the browser-owned automation record and routes
  cancellation through its existing `timer.cancel` command; the panel owner is
  `ChannelAutomationPanel`. No second task store or mock protocol was added.

## Evidence

- `tests/ui-vis-06-automation-owner.test.jsx`: 3/3. Covers the Tasks entry,
  detail `timer_id` handoff, and panel `after`/`cancel` public command port.
- Real Chromium, `tests/browser/ui-visual.spec.js`, UI-VIS-06 cancellation
  contract: 1/1. The path created a real timer, opened the task detail,
  enabled and clicked the cancel action, observed `已取消`, disappearance of
  the stale action, and server-side timer removal.
- Real Chromium, `tests/browser/f4-tasks-restore.spec.js`, F4-006: 1/1.
  The automation row remained reachable at 320px and retained its detail
  cancellation affordance.
- `npm run build`: passed (Vite production build; only existing chunk-size
  warnings).

The Darwin screenshot remains a historical visual oracle; this acceptance is
for the public user path and terminal result, not a selector or screenshot
threshold relaxation.
