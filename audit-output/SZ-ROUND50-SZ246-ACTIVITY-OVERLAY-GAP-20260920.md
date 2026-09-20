# S–Z Round 50 — SZ-246 activity-overlay owner check

Date: 2026-09-20

Scope: the next non-Feed/non-Reading-visibility S–Z baseline after SZ-245.
`SZ-149` and the completed SZ-245 successor are not repeated. This round is
read-only product verification; no source, test, vendor, package, or lockfile
was changed.

## Exact baseline contract

`SZ-246` is the exact fae8b70 case from
`tests/ui-activity-overlay.test.jsx`:

> 没操作过就什么都不显示

The old user capability was an automatically mounted, transient activity
overlay whose empty input rendered no DOM. The contract is not merely that an
explicit Activity Center can show an empty-state message.

## Current owner decision

The old `src/ui/UiActivityOverlay.jsx` owner is absent, and the current source
has no `ui.navigate`/`ui.open`/`ui.state` receipt consumer. The current public
surface is a different one:

- `WorkspaceLayout` exposes an explicit `打开活动中心` rail action;
- `WorkspaceFeatures` mounts `ActivityFeature` only after that navigation;
- an empty activity list intentionally renders the side panel and the text
  `没有需要关注的活动`, rather than rendering no overlay.

The current accessibility owner was exercised without treating it as an
equivalent successor:

```text
npx vitest run tests/activity-center-accessibility.test.jsx --reporter=dot
Test Files  1 passed (1)
Tests       4 passed (4)
```

Those four tests prove the explicit Activity Center's accessible opener,
close/focus return, source callback, and fail-closed unavailable-operation
state. They do not prove the removed automatic overlay contract.

## Disposition

**GAP — product decision required.** No unique current public owner exposes
the old empty-overlay behavior, so this case stays unclosed and is not called a
product RED. The smallest product ruling is either:

1. assign the existing Activity Center/agent-activity owner a sanctioned
   automatic overlay contract and add its direct public test; or
2. explicitly retire the old overlay capability and update the migration
   ledger/baseline.

Recreating `UiActivityOverlay`, a `ui.*` compatibility consumer, or a second
activity store would not be an owner-preserving migration.
