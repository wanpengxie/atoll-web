# NR10-01 / NR10-04 — public process detail and timing

## Scope

- Base: `34990fce2d454ffbfaf7133aeb681cd4aedf5f24`
- Branch: `nr10-fix-34990fc`
- Owner: `useTimelineRowRenderer()` → `TurnCard`/`MessageActions` → inline `ProgressTrail` in `src/ui/timeline/TimelineRowRenderer.jsx`
- Claim: NR10-01 (process detail) + NR10-04 (process row timestamp/live duration)

The current owner already kept human `stage:text` in the answer and technical
tool/stage observations in a separate trail. The missing user capabilities were
an affordance for process正文 and the old row-level time metadata/live elapsed
duration. This change restores those capabilities at the same renderer owner.

## User-visible contract

1. `stage:text` remains answer正文; it is not duplicated into the technical trail.
2. Text-bearing thinking/stage/tool rows are keyboard-operable buttons. Their
   existing public `ProgressTrail` owner opens one modal process-detail surface
   containing only the typed process正文 (`stage.text` or `tool.detail`).
3. State-only thinking/tool rows remain non-actionable and do not invent empty detail; a tool row becomes actionable only when its typed `detail` exists. The turn-level `查看过程` action is gated by the same typed row body, so it is absent for an empty tool and cannot open an empty panel.
4. A live trail shows every visible row's timestamp. The latest row additionally
   shows a ticking `MM:SS` elapsed duration; the same metadata remains available
   after expanding the trail.
5. Tool `input`/`output` and arbitrary payload keys are deliberately not copied
   into the row model or rendered by the drawer. The retired raw JSON drawer and
   its old activity store/host are not restored.
6. If an already-open tool row receives its matching `ended` observation, the
   same drawer follows the stable `tool_call_id`/seq and updates to the typed
   detail without a second host/store or a reopen.

## Evidence

- `tests/nr10-progress-trail-owner.test.jsx`
  - verifies answer/trail separation;
  - opens typed process正文 and proves `input`/`output` secrets and `<pre>` are
    absent;
  - keeps a tool row without typed `detail` as a non-actionable status row;
  - renders through `useTimelineRowRenderer({ onOpenTurn })`: an empty tool has
    zero turn-level process actions, while the ended typed detail exposes the
    request/answer actions and forwards the original turn to `onOpenTurn`;
  - verifies two row timestamps and only the latest live duration, including a
    timer advance and expanded state;
  - verifies interleaved A/B tool calls remain paired by `tool_call_id`.
- `tests/browser/nr10-progress-trail.spec.js`
  - real Chromium `progress-demo` path verifies a live row timestamp and
    changing duration, hides both the turn-level and row-level no-detail tool
    actions, and opens the same tool drawer only once its matching ended detail
    exists;
  - injects one typed `stage` process through the mock's public action, opens
    the public detail dialog, and proves no wire input/output is visible.

## Verification

Passing focused unit command:

```text
node_modules/.bin/vitest run tests/nr10-progress-trail-owner.test.jsx tests/sz-round49-turn-presentation-owner.test.jsx tests/agent-information-architecture.test.jsx tests/final-echo.test.js --reporter=dot
4 files, 28 tests passed
```

Passing browser command (fresh run, isolated ports `16486` / `19486`):

```text
ATOLL_TEST_WEB_PORT=16486 ATOLL_TEST_MOCK_PORT=19486 npm run test:browser -- tests/browser/nr10-progress-trail.spec.js --repeat-each=10 --workers=1 --reporter=line
10 passed (including open-tool → ended-detail live sync)
```

Build:

```text
npm run build
vite build: passed (chunk-size advisory only)
```
