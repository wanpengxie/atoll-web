# A–D Round 44 — AD-093 real capability and owner definition (2026-09-20)

Round 44 refines the AD-093 handoff from Round 43. The case is not merely
“Reading state exists”; its user capability is a shell entry plus a right-side
recent-reading context with an owned return-focus path. The latest shared head
is `9896328`; the product changes after the requested `0ba7fa7` anchor are
Feed-only and do not add this shell entry. This round changes only the
public-owner test annotation and audit records.

## Contract definition

| Contract part | Historical/current public boundary | Required user-visible fact | Evidence / current result |
|---|---|---|---|
| Entry | Historical `AppShell` shell edge; current first boundary is `WorkspaceApp` → `WorkspaceLayout` | When a readable channel is active, a right-edge button named `打开最近阅读` / label `最近` is discoverable. | Historical `d450400:src/app/AppShell.jsx:472` rendered the edge tab only for an active readable channel. Current `WorkspaceLayout` exposes terminal/files actions and generic `rightPanel`, but no Reading entry port (`src/app/WorkspaceLayout.jsx:109-117,349-365`). Current public query returns `null` at `tests/blocked-round25-public-owner.test.jsx:517`. |
| Route | Historical `panel` state → `RightPanelHost`; current `WorkspaceApp` panel state → `WorkspaceRightPanel` | Clicking the entry opens the `reading-history` context rather than a terminal/files/task route. | Historical `d450400:src/app/AppShell.jsx:472` called `panel.open('reading-history')`; historical `RightPanelHost` routed that value to `RecentFilesContext` (`d450400:src/app/RightPanelHost.jsx:44,71-72`). Current `WorkspaceApp` exposes `openActivity`, `openSearch`, and feature routes but no Reading route (`src/app/WorkspaceApp.jsx:295,1825-1870`); current `WorkspaceRightPanel` has no `reading-history` branch (`src/ui/features/WorkspaceFeatures.jsx:16-25,274-320`). |
| Content | Historical `RecentFilesContext` backed by the artifact/recent-files port; current `FilesFeature` is a different owner | The opened context lists recent readings and can reopen a selected file through the public preview command. | Historical `RecentFilesContext` consumed `artifacts.recentFiles` and `onPreview` (`d450400:src/ui/context/RecentFilesContext.jsx:1-25`). Current `FilesFeature` only renders a channel-files inline “最近查看的文件” section when the Files surface is already open (`src/ui/features/FilesFeature.jsx:168-173`); it is not a right-edge global drawer and has no `reading-history` route. |
| Focus/lifecycle | Historical/current `ContextHost` boundary | Opening transfers focus into the context; close/backdrop/Escape returns focus to the opener without inventing a second Reading state owner. | Historical `RightPanelHost` captured the active opener and restored it on unmount (`d450400:src/app/RightPanelHost.jsx:17-40`). Current `WorkspaceFeatures.ContextHost` preserves the same generic focus/Escape behavior (`src/ui/features/WorkspaceFeatures.jsx:223-249`), but it is unreachable for AD-093 because no current panel kind produces Reading content. |

## Case-level record

| Case | User capability | Invariant | Current public owner | Baseline action / expected result | Current result / disposition |
|---|---|---|---|---|---|
| AD-093 | From the channel/terminal edge, open recent reading and reopen a selected item without losing the originating focus. | Entry, `reading-history` route, recent-item source, and context focus lifecycle have one public owner chain; an inline Files list cannot substitute for the shell drawer. | First divergence: `WorkspaceApp` panel/navigation composition and `WorkspaceLayout` edge; next dispatcher boundary: `WorkspaceRightPanel`; data source candidate: existing `files.recent` port. No current AD-093 route is mounted. | Render a committed readable channel through the public shell; discover `打开最近阅读`; click it; observe a right-side `最近阅读` context; close it and observe opener focus restored. | **Blocked product gap:** current ordinary public-owner fixture cannot discover the entry (`null`), so route/content/focus assertions cannot begin. Latest focused run on `9896328`: **1 failed, 19 focused-out skips** at `tests/blocked-round25-public-owner.test.jsx:517`. |

## Minimal verification

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-093\\]'

Test Files  1 failed (1)
Tests       1 failed | 19 skipped (20)
Failure    expected null to be truthy
            tests/blocked-round25-public-owner.test.jsx:517
```

The test annotation now names the complete current public-owner contract while
leaving the behavioral assertion unchanged. The query is an accessible public
entry assertion, not a private DOM fingerprint. The historical `FilesFeature`
inline recent-files list is deliberately not promoted to PASS: it has different
scope, location, route, and focus lifecycle from AD-093.

## Product-owner handoff

- Minimal reproduction: render `WorkspaceLayout` with a readable committed
  channel and current public feature composition; query the accessible
  `打开最近阅读` button; receive `null`.
- Baseline behavior: the edge button called `panel.open('reading-history')`,
  `RightPanelHost` mounted `RecentFilesContext` from `artifacts.recentFiles`,
  and `ContextHost` returned focus to the opener on close.
- Current behavior: `WorkspaceApp` has no Reading panel command,
  `WorkspaceLayout` has no edge entry, and `WorkspaceRightPanel` has no
  `reading-history` branch. `FilesFeature.port.recent` is only an inline
  current-channel list.
- First public divergence: shell entry/routing (`WorkspaceApp` →
  `WorkspaceLayout` → `WorkspaceRightPanel`), before any Reading drawer
  content or focus transition can be observed.
- Required decision: the assigned Workspace/Reading owner must either restore
  this public capability through the current typed panel/feature ports or
  explicitly decide its product disposition. The test worker does not choose
  either path and does not alter product code.

AD-093 remains **BLOCKED**, not obsolete or expected-fail completion. The A–D
ledger remains **329 PASS / 0 REGRESSION / 36 BLOCKED**. No test was deleted or
skipped; no private export, compatibility API, vendor, package, lockfile, or
product source changed.
