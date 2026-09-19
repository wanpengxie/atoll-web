# A–D P1 composed interaction fixture batch: AD-014 / AD-017 (2026-09-20)

This batch recovers the first two P1 `agent-control` cases through the current
public Waiting composition. The fixtures retain the baseline user capability,
causal state transition, and observable result. They do not import private
helpers, change Feed/runtime product code, delete declarations, or add skips.
The two lifecycle gaps are now fixed in the existing Waiting/edit owner and
both cases are green `PASS` entries in the A–D ledger.

## Case matrix

| Case | User capability | Invariant | Public owner / action | Result |
|---|---|---|---|---|
| AD-014 | Edit a waiting request only after its own processing target has been admitted back to the queue as `queued + resumed`. | A processing fact must not expose an edit affordance before the target's causal queued-resumed fact; once that fact is committed, the edit action is handed to the current owner. | Exported `TimelineRowRenderer` + `useWaitingEditingController` + `WaitingLayer` composition; click the public timeline `编辑` button, then rerender the public queued-resumed state and inspect the Composer edit port. | **PASS:** the owner keeps Composer closed while processing, rejects a mismatched `held_by`, and hands off only after matching queued+resumed evidence. |
| AD-017 | Temporarily edit/hold work that is already paused by an interrupt, then retain the original pause after release or expiry. | A newer temporary edit hold must not erase the earlier interrupt authority; releasing or expiring the overlay must restore the interrupt pause. | Exported `WaitingLayer`; render public interrupt/hold/unhold turn facts and a wall-clock-expired hold, then inspect the visible `.agent-wait-paused` result. | **PASS:** the owner restores the interrupt pause on both release and expiry, while a hold with no interrupt restore point returns to no pause. |

## Public-composition audit

The original `aea82ac` AD-014 fixture passed a `processing` turn directly as
`WaitingLayer.turns`. That is a public component export, but it is not an input
the production composition supplies: `useWaitingEditingController` filters
`WaitingLayer` to queued turns, while processing edit actions originate in
`TimelineRowRenderer`. Review commit `0739d51` replaced that shortcut with the public chain
`TimelineRowRenderer` → `useWaitingEditingController` → `WaitingLayer`, using
the exported Composer edit callback port and no mocked private helper.

AD-017's direct `WaitingLayer` fixture remains valid: production supplies the
queued target plus the complete public channel state, and the assertion observes
only the rendered pause affordance. The private `heldActors` reducer is not
imported or mocked.

## Focused verification

```text
npx vitest run tests/agent-control.test.jsx --reporter=verbose -t '\[AD-(014|017)\]'
```

Observed on 2026-09-20 after the Waiting-owner fix:

```text
Test Files  1 passed
Tests       2 passed | 6 skipped
```

- AD-014 now proves no Composer session before matching queued-resumed evidence;
  a stale `held_by` is also rejected.
- AD-017 now proves `{ pauseAfterRelease: true, pauseAfterExpiry: true }` with
  an interrupt restore point and `pauseWithoutInterrupt: false` without one.

The earlier red results were direct public-owner evidence. The product fix is
limited to the existing Waiting/edit owner; no Workspace, Reading, Outbox, or
legacy API surface changed.

## Boundary audit

Changed paths are limited to the existing A–D test/audit files and
`src/ui/timeline/useWaitingEditingController.jsx`, the current Waiting/edit
owner. No Feed runtime, Workspace, Reading, Outbox, vendor, package/lock file,
private export, declaration deletion, or skip was introduced.
