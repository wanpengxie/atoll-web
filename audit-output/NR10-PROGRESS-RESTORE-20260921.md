# NR10-01 / NR10-04 — public process detail and timing

## Scope

- Base: `89c04f13e683d092e84f7bd26ae9a5e4aac19336`
- Replay: `40d7c13` → `39367df` → `70bda49`, replayed and squashed as one current candidate on the current base (final SHA reported with this audit).
- Branch: detached current replay worktree `nr10-current-89c04f1`
- Owner: `useTimelineRowRenderer()` → `TurnCard`/`MessageActions` → inline `ProgressTrail` in `src/ui/timeline/TimelineRowRenderer.jsx`
- Claim: NR10-01 (process detail) + NR10-04 (process row timestamp/live duration)

The current owner keeps human `stage:text` in the answer and technical
tool/stage observations in a separate trail. This change restores the old
tool input/output detail projection without restoring the retired host/store:
the same renderer owns one bounded typed view, row timing, and started-to-ended
tool-call handoff.

## User-visible contract

1. `stage:text` remains answer正文; it is not duplicated into the technical trail.
2. Text-bearing thinking/stage/tool rows and tool rows with non-empty typed
   input/output are keyboard-operable buttons. The existing public
   `ProgressTrail` owner opens one modal process-detail surface containing
   typed process正文 (`stage.text`/`tool.detail`) and a bounded typed
   `{ input, output }` tree for tool rows.
3. Empty state-only thinking/tool rows remain non-actionable and do not invent
   empty detail. The turn-level `查看过程` action is gated by the same typed
   body/data, so an empty tool cannot open an empty panel.
4. A live trail shows every visible row's timestamp. The latest row additionally
   shows a ticking `MM:SS` elapsed duration; the same metadata remains available
   after expanding the trail.
5. Tool data is copied only as typed `input`/`output`, then passed through one
   total-budget traversal that applies the existing complete-field redaction
   policy and bounds depth, nodes, fields, array items, and string characters.
   Arbitrary process payload keys, persistence, and the retired raw JSON
   host/store are not restored. Mobile output already shown in its bounded
   Markdown presentation is not duplicated in the structured tree.
6. If an already-open tool row receives its matching `ended` observation, the
   same drawer follows the stable `tool_call_id`/seq, merges the started input
   with ended output, and updates typed detail without a second host/store or a
   reopen.
7. The existing `useModalFocus` owner keeps native `<summary>` controls in its
   focusable set. The drawer's initial close button, structured summary, and
   return-to-opener path remain one modal focus cycle: forward Tab reaches the
   summary, reverse Tab returns to close, both boundary directions wrap inside
   the drawer, and closing restores the row trigger.

## Evidence

- `tests/nr10-progress-trail-owner.test.jsx`
  - verifies answer/trail separation;
  - opens typed process正文 and structured tool input/output, proves recursive
    redaction and shallow expansion, and proves bounded long/deep values;
  - keeps a tool row without typed `detail` and data as a non-actionable status
    row while allowing non-empty data-only rows;
  - renders through `useTimelineRowRenderer({ onOpenTurn })`: an empty tool has
    zero turn-level process actions, while ended typed detail/data exposes the
    request/answer actions and forwards the original turn to `onOpenTurn`;
  - verifies two row timestamps and only the latest live duration, including a
    timer advance and expanded state;
  - verifies started input survives an ended output handoff and interleaved A/B
    tool calls remain paired by `tool_call_id`;
  - proves cyclic/getter failures fail closed without opening a drawer;
  - verifies the native structured `<summary>` participates in the existing
    modal Tab/Shift+Tab cycle and that closing returns focus to the row trigger;
  - adjacent NR09-02 owner tests prove mobile output remains bounded and is not
    duplicated or persisted.
- `tests/browser/nr10-progress-trail.spec.js`
  - real Chromium `progress-demo` path verifies a live row timestamp and
    changing duration, treats fixture input as typed data, and opens the same
    tool drawer once its matching ended detail/output exists;
  - injects one typed `stage` process through the mock's public action, opens
    the public detail dialog, and proves no wire input/output is visible;
  - injects started→ended tool data through the public mock action and verifies
    input/output, redaction, shallow expansion, stable row identity, and native
    summary focus/return-focus behavior through the same public drawer.

## Verification

Passing focused unit command:

```text
node_modules/.bin/vitest run tests/nr10-progress-trail-owner.test.jsx tests/nr09-02-payload-presentation-owner.test.jsx tests/sz-round49-turn-presentation-owner.test.jsx tests/agent-information-architecture.test.jsx tests/final-echo.test.js --reporter=dot
5 files, 36 tests passed
```

Passing browser command (fresh run, isolated ports `16526` / `19526`):

```text
ATOLL_TEST_WEB_PORT=16526 ATOLL_TEST_MOCK_PORT=19526 npm run test:browser -- tests/browser/nr10-progress-trail.spec.js --repeat-each=10 --workers=1 --reporter=line
20 passed (2 scenarios × 10, including open-tool → ended-detail live sync, structured data, native summary Tab/Shift+Tab wrapping, and return-focus)
```

Adjacent mobile regression (fresh ports `16527` / `19527`):

```text
ATOLL_TEST_WEB_PORT=16527 ATOLL_TEST_MOCK_PORT=19527 npm run test:browser -- tests/browser/nr09-02-mobile-tool-output.spec.js --workers=1 --reporter=line
2 passed (320px and 390px bounded output/focus return)
```

Passing modal/Reading adjacent unit command:

```text
node_modules/.bin/vitest run tests/following-tail-list.test.jsx tests/sz182-bookmark-gen-source-reacquisition.test.jsx tests/sz183-bookmark-supply-advance-revalidate.test.jsx --reporter=dot
3 files, 12 tests passed
```

Passing preserved channel-list browser contract:

```text
ATOLL_TEST_WEB_PORT=16528 ATOLL_TEST_MOCK_PORT=19528 npm run test:browser -- tests/browser/tc0310-channel-list.spec.js --workers=1 --reporter=line
1 passed
```

Build:

```text
npm run build
vite build: passed (chunk-size advisory only)
```
