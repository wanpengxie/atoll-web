# A–D P1 composed interaction fixture batch: AD-014 / AD-017 (2026-09-20)

This batch recovers the first two P1 `agent-control` cases through the current
public Waiting composition. The fixtures retain the baseline user capability,
causal state transition, and observable result. They do not import private
helpers, change Feed/runtime product code, delete declarations, or add skips.
Both fixtures are intentionally red product-gap reproductions and therefore
remain `REGRESSION` in the A–D ledger.

## Case matrix

| Case | User capability | Invariant | Public owner / action | Result |
|---|---|---|---|---|
| AD-014 | Edit a waiting request only after its own processing target has been admitted back to the queue as `queued + resumed`. | A processing fact must not expose an edit affordance before the target's causal queued-resumed fact; once that fact is committed, the edit action is handed to the current owner. | Exported `TimelineRowRenderer` + `useWaitingEditingController` + `WaitingLayer` composition; click the public timeline `编辑` button, then rerender the public queued-resumed state and inspect the Composer edit port. | **REGRESSION:** `useWaitingEditingController.startEditing` sends `agent.hold` and hands off Composer immediately while the target is still `processing`; the resumed state remains editing. |
| AD-017 | Temporarily edit/hold work that is already paused by an interrupt, then retain the original pause after release or expiry. | A newer temporary edit hold must not erase the earlier interrupt authority; releasing or expiring the overlay must restore the interrupt pause. | Exported `WaitingLayer`; render public interrupt/hold/unhold turn facts and a wall-clock-expired hold, then inspect the visible `.agent-wait-paused` result. | **REGRESSION:** the current `heldActors` projection drops the interrupt pause in both release and expiry paths (`false/false`, expected `true/true`). |

## Public-composition audit

The original `aea82ac` AD-014 fixture passed a `processing` turn directly as
`WaitingLayer.turns`. That is a public component export, but it is not an input
the production composition supplies: `useWaitingEditingController` filters
`WaitingLayer` to queued turns, while processing edit actions originate in
`TimelineRowRenderer`. This review replaces that shortcut with the public chain
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

Observed on 2026-09-20:

```text
Test Files  1 failed
Tests       2 failed | 6 skipped
```

- AD-014 fails at `tests/agent-control.test.jsx:168`: the public composition
  reports an editing session before the queued-resumed fact (`beforeResume: true`).
- AD-017 fails at `tests/agent-control.test.jsx:207`: the release and expiry
  observations are `{ pauseAfterRelease: false, pauseAfterExpiry: false }`,
  while the required restored interrupt pause is `{ true, true }`.

The red results are kept as direct public-owner evidence. Product fixes are
outside this batch; no source file was changed.

## Boundary audit

Changed paths are limited to the A–D test and audit-output files. No Feed
runtime, vendor, package/lock file, private export, declaration deletion, or
skip was introduced.
