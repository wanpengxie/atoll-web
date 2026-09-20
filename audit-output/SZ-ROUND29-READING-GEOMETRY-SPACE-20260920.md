# S-Z round 29 — Reading geometry successor and space-owner audit

Date: 2026-09-20

Scope: `SZ-007`, `SZ-008`, and the remaining S03 rows `SZ-014`, `SZ-015`,
`SZ-016`, `SZ-017`, `SZ-019`.

## Result

`SZ-007` and `SZ-008` can be expressed as current user-visible Reading
invariants.  The strict browser owner already exercises those invariants and
both focused cases pass; no old `send-scroll-transaction` module or event path
was restored.

Of the five S03 GAP rows, only `SZ-019` has a current integrated owner that can
be recovered in this round: channel file/storage choices are owned by the
public `useAttachmentTransactions` port and are now covered by a focused
successor.  The space-governance wire vocabulary and mock commands are not a
product owner: [`WorkspaceApp`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/src/app/WorkspaceApp.jsx:1054)
explicitly exposes the space port as disabled and rejects its submit path.
`SZ-014`, `SZ-015`, `SZ-016`, and `SZ-017` therefore remain GAPs.

## SZ-007 / SZ-008 — strict Reading browser owner

| Row | User-visible invariant | Current owner/evidence | Result |
|---|---|---|---|
| SZ-007 | While the reader is browsing, a post-baseline append/measurement that is unrelated to the current reading target must not move the user's anchor or issue a Reading scroll write. The new-activity affordance is visible; explicit jump is the only tail transfer. | [`tests/browser/e-send-scroll-writers.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/e-send-scroll-writers.spec.js:397), current Reading owner plus DOM geometry. | PASS: passive append focused run. `scrollTop` unchanged, no displacement, no timeline write, mode stays browsing; jump then paints the appended row at tail. |
| SZ-008 | When a user-visible target row shrinks, the committed anchor remains in view within the physical clamp budget; stale/other row geometry cannot replace the target measurement. | [`tests/browser/fold-collapse-anchor.spec.js`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/browser/fold-collapse-anchor.spec.js:248), current Reading owner and real fold control. | PASS: focused mid-viewport collapse and role-transfer runs. They assert per-frame anchor drift, clamp budget, and no virtualized disappearance. |

These are browser facts, not a re-export of private geometry state.  The
successor deliberately observes only the committed list, row rectangles,
scroll geometry, fold control, and jump affordance.  It does not recreate the
old transaction state machine.

## S03 owner split

| Row | Current-owner check | Disposition |
|---|---|---|
| SZ-014 | `SpaceAdministrationPanel` has a component shape, but production `WorkspaceApp` passes `space: { disabled: true, ... }` and `commands.submit` rejects `governance.space`. Direct `tests/mock-phase-e.test.js` actor-template commands exercise the mock wire only, not a user-reachable app owner. | GAP retained; no current production owner for actor-template command construction/protection. |
| SZ-015 | The old local actor-name rule was deleted. Current `SpaceAdministrationPanel` sends JSON through the disabled space port, and the mock registrar does not expose a public client validation owner for the old actor-id-segment rule. | GAP retained; do not revive local validation/compatibility. |
| SZ-016 | The protocol/mock accepts `system.actor.overlay.set` and `system.channel.set`, but the integrated space port is disabled. Channel profile editing is a separate current channel-governance path; overlay ownership is not exposed there. | GAP retained; backend fixture support is not a product owner. |
| SZ-017 | Current `SpaceTemplates` starts channel-template JSON with `{ body: {} }`; production space submission is disabled and no current owner materializes `local-device` into a template body. | GAP retained; no default-injection compatibility layer added. |
| SZ-019 | `useAttachmentTransactions.refreshDevices` reads only `obs.channelDevices(channelId)`, projects the mounted/default/online facts, and publishes them through its public `devices` port. It never falls back to the space daemon directory. | RECOVERED current owner; focused successor below passes 2/2. |

The direct mock suite still passes its existing protocol smoke (`mock-phase-e`),
but that is recorded as backend fixture evidence only.  It must not be used to
close rows whose integrated Workspace owner is disabled.

## SZ-019 successor

[`tests/sz-round29-space-owner.test.jsx`](/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/tests/sz-round29-space-owner.test.jsx:10)
mounts the existing public `useAttachmentTransactions` owner and proves both
directions:

- a mounted channel device wins even when the channel profile names a
  space-only id;
- an empty channel observation does not invent a device from that space-only
  id.

The test asserts only the public file/storage choices (`id`, `name`,
`defaultStorage`, `online`); `ownerPrincipal` and `attachedAt` are not leaked
into this user-facing port.  This intentionally avoids treating the deleted
`safeChannelDeviceRows` shape as a required API.

## Verification

Focused browser owner runs:

```text
npx playwright test tests/browser/e-send-scroll-writers.spec.js --grep "browsing passive append" --reporter=line
1 passed

npx playwright test tests/browser/fold-collapse-anchor.spec.js --grep "角色转移" --reporter=line
1 passed

npx playwright test tests/browser/fold-collapse-anchor.spec.js --grep "视口中部" --reporter=line
1 passed
```

Focused unit/owner run:

```text
npx vitest run tests/mock-phase-e.test.js tests/space-administration.test.js tests/file-browser.test.jsx tests/sz-round29-space-owner.test.jsx --reporter=dot
Test Files  4 passed (4)
Tests       22 passed (22)
```

An adjacent pre-existing product regression was also reproduced but not
changed here: `e-send-scroll-writers.spec.js` / “browsing send hands off to the
following owner” ended in `mode=browsing`, `gap=324`, with the target row
painted at the lower edge instead of settling at the tail.  This is outside
SZ-007/008 and is handed to the Submission/Reading send owner.

Only this report and the SZ-019 test were added in this round.  No `src/`,
vendor, package/lockfile, old path, private export, skip, or compatibility
change was made.
