# A–D P1 composed interaction fixture batch: AD-014 / AD-017 / AD-018 / AD-021 / AD-022 / AD-031 (2026-09-20)

This batch recovers six P1 Waiting-owner cases through the current public
Waiting composition. The fixtures retain the baseline user capability, causal
state transition, and observable result. They do not import private helpers,
change Feed/runtime product code, delete declarations, or add skips. The four
Waiting lifecycle gaps plus two information-architecture cases are fixed in the existing Waiting/edit owner and are
green `PASS` entries in the A–D ledger.

## Case matrix

| Case | User capability | Invariant | Public owner / action | Result |
|---|---|---|---|---|
| AD-014 | Edit a waiting request only after its own processing target has been admitted back to the queue as `queued + resumed`. | A processing fact must not expose an edit affordance before the target's causal queued-resumed fact; once that fact is committed, the edit action is handed to the current owner. | Exported `TimelineRowRenderer` + `useWaitingEditingController` + `WaitingLayer` composition; click the public timeline `编辑` button, then rerender the public queued-resumed state and inspect the Composer edit port. | **PASS:** the owner keeps Composer closed while processing, rejects a mismatched `held_by`, and hands off only after matching queued+resumed evidence. |
| AD-017 | Temporarily edit/hold work that is already paused by an interrupt, then retain the original pause after release or expiry. | A newer temporary edit hold must not erase the earlier interrupt authority; releasing or expiring the overlay must restore the interrupt pause. | Exported `WaitingLayer`; render public interrupt/hold/unhold turn facts and a wall-clock-expired hold, then inspect the visible `.agent-wait-paused` result. | **PASS:** the owner restores the interrupt pause on both release and expiry, while a hold with no interrupt restore point returns to no pause. |
| AD-018 | Keep an edit hold when its unhold terminal is only a compact closure. | A compact terminal retains lifecycle identity/status but not authoritative business result fields; missing release proof cannot clear a visible hold. | Exported `WaitingLayer`; render a completed hold, a `terminalClosureOnly` unhold carrying `released:true`, and a queued target; inspect `.agent-wait-paused`. | **PASS:** the compact closure is ignored as an authoritative unhold, so the hold remains visible. |
| AD-021 | Clear an edit hold when its held target truly resumes after a paused stretch. | Only a core status transition to processing advances the target; repeated processing business progress from another already-running turn must not release the hold. | Exported `WaitingLayer`; render first processing → matching `queued+resumed(held_by)` → second processing and inspect `.agent-wait-paused`, with AD-020 as the unrelated-progress control. | **PASS:** the resumed target clears the hold; `tool.started` plus repeated processing leaves an unrelated hold intact. |
| AD-022 | Hide cached queued controls until the backend control tail is current. | Cache-only queued facts must not resurrect waiting chrome/actions while `targetAuthority.current` is false; recovery restores the same public view. | Exported `WaitingLayer`; render a queued row with false authority, assert no waiting layer, then rerender with current authority and assert the layer returns. | **PASS:** false authority hides the cache-only row; current authority restores it. |
| AD-031 | Exit editing when the target reaches a cancellation terminal. | A target cancellation closes the Composer and releases only the exact edit hold owned by that session. | Exported `useWaitingEditingController`; start editing through the public hook, rerender the cancelled target, inspect `presentationEditing/editNotice`, and observe the exact-hold unhold callback. | **PASS:** session closes, `已退出编辑` is shown, and the captured owner sends `agent.unhold(expected_hold_id)`. |

## Public-composition audit

The original `aea82ac` AD-014 fixture passed a `processing` turn directly as
`WaitingLayer.turns`. That is a public component export, but it is not an input
the production composition supplies: `useWaitingEditingController` filters
`WaitingLayer` to queued turns, while processing edit actions originate in
`TimelineRowRenderer`. Review commit `0739d51` replaced that shortcut with the public chain
`TimelineRowRenderer` → `useWaitingEditingController` → `WaitingLayer`, using
the exported Composer edit callback port and no mocked private helper.

AD-017, AD-018/021, and AD-022 direct `WaitingLayer` fixtures remain valid: production supplies the
queued target plus the complete public channel state, and the assertion observes
only the rendered pause affordance. AD-021 uses the public `queued+resumed` handoff
fact from the baseline, while the owner derives core-vs-business status without
exporting its reducer. The private `heldActors` reducer is not imported or mocked.
AD-031 uses the exported hook's public edit port; it does not import the private
session-owner map or any legacy edit admission helper.

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

```text
npx vitest run tests/agent-control.test.jsx tests/task-controls-restore.test.jsx --reporter=dot
```

Observed on 2026-09-20:

```text
Test Files  2 passed
Tests       21 passed
```

- AD-018 rejects a `terminalClosureOnly` unhold as an authoritative release.
- AD-021 recognizes the second core `processing` transition after matching
  `queued+resumed`, while AD-020 keeps non-core `tool.started` progress from
  releasing another turn's hold.

```text
npx vitest run tests/agent-information-architecture.test.jsx --reporter=verbose -t '\[AD-(022|031)\]'
```

Observed on 2026-09-20:

```text
Test Files  1 passed
Tests       2 passed | 14 skipped
```

- AD-022 proves the false-authority cache gate and recovery when the committed
  control tail becomes current.
- AD-031 proves cancellation closes the editing session, emits the user notice,
  and sends the captured exact-hold release.

The earlier red results were direct public-owner evidence. The product fix is
limited to the existing Waiting/edit owner; no Workspace, Reading, Outbox, or
legacy API surface changed.

## Boundary audit

Changed paths are limited to the existing A–D test/audit files and
`src/ui/timeline/useWaitingEditingController.jsx`, the current Waiting/edit
owner. No Feed runtime, Workspace, Reading, Outbox, vendor, package/lock file,
private export, declaration deletion, or skip was introduced.
