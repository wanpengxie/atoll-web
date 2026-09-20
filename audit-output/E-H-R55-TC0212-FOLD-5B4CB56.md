# E–H R55: TC0212 historical response fold owner repair

Date: 2026-09-20  
Base: `5b4cb56095d283be8ca4cd376e38794797beea6e`  
Scope: TC0212 only. TC0216 is not changed or rerun in this worktree.

## Contract and baseline

The public user action is: reset `extreme-height-history/1731`, log in, use
native wheel input until `c0-history-request-104` is visible, then click its
public `展开全文 · 182 行` control. The invariant is that the exact row remains
the same row and changes to `收起`/`aria-expanded="true"`, exposing the long
response body. A selector-only or diagnostic assertion is not sufficient.

The exact public successor from `fbfaa1a` reproduced the failure before this
repair: the row was visible and contained `c0 PONG 104`; its public toggle began
at `aria-expanded="false"`; after the real click, `收起` never appeared and the
button stayed collapsed. This was the first user-visible red.

## Owner and cause

The unique fold presentation path is:

- `src/ui/timeline/FoldableBody.jsx`: pure fold decision and public button;
- `src/ui/timeline/TimelineRowRenderer.jsx`: turn row fold IDs and row render
  revision;
- `src/ui/timeline/useTimelinePreferences.js`: the existing preference owner
  receives the click and stores the explicit override.

`useTimelinePreferences.toggleFold` already stored the historical response
override under `<requestId>:response`. `TimelineRowRenderer.rowRenderRevision`
only included `<requestId>:body` for a turn row, however. `MessageRow` therefore
kept the same memo revision after a response-body click and never rerendered the
existing `FoldableBody`. This was a stale row-render revision, not a Reading,
virtual-list, new-store, or compatibility problem.

## Minimal repair

`rowRenderRevision` now includes both `<requestId>:body` and
`<requestId>:response` for turn rows. Standalone rows retain their existing
single body ID. No virtual-list/Reading code, fold owner, new store, or storage
API was added or changed.

Unit coverage in `tests/e-h-tc0212-fold-revision.test.jsx` proves that a turn row
revision changes when only its response fold override changes. The browser
coverage in `tests/browser/f7-history-extreme-expand-0212.spec.js` proves the
complete public action and body exposure.

## Verification

Unit:

```text
npm test -- --run tests/e-h-tc0212-fold-revision.test.jsx tests/foldable-body.test.jsx tests/timeline-preferences.test.jsx
Test Files  3 passed; Tests 8 passed
```

Browser, three independent runs with one worker:

```text
ATOLL_TEST_WEB_PORT=28138 ATOLL_TEST_MOCK_PORT=29138 npx playwright test tests/browser/f7-history-extreme-expand-0212.spec.js
1 passed (8.1s)

ATOLL_TEST_WEB_PORT=28139 ATOLL_TEST_MOCK_PORT=29139 npx playwright test tests/browser/f7-history-extreme-expand-0212.spec.js
1 passed (8.8s)

ATOLL_TEST_WEB_PORT=28140 ATOLL_TEST_MOCK_PORT=29140 npx playwright test tests/browser/f7-history-extreme-expand-0212.spec.js
1 passed (7.4s)
```

The repair closes the original public red without weakening or skipping the
assertion and without touching TC0216.
