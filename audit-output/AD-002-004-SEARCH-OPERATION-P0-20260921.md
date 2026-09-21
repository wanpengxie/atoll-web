# AD-002 / AD-003 / AD-004 Search Operation P0

Base: `75a9f4a6ecb7c4d309b91a459ebc0e59ce936634`
Owner: `selectFeatureSearchIndex` in `src/model/feature-search.js`, fed by the existing `WorkspaceApp.activityPort.operations` typed projection.
Scope: Search projection and its existing Workspace wiring only; no backend, second store, compatibility API, or private export.

| Case / baseline | User capability | Invariant | Public owner | Setup → action → observable | Disposition / result |
| --- | --- | --- | --- | --- | --- |
| AD-002 — `tests/blocked-round15-activity-owner.test.js` | Activity/search exposes one locatable unresolved terminal/WorkItem/Operation fact. | Same channel/request facts are deduped; SourceRef contains only public location fields. | `selectFeatureSearchIndex` | Feed a failed approval state, matching WorkItem, and failed Operation; inspect the surviving WorkItem source. | Product owner restored. PASS: WorkItem remains canonical for the same request (`rank 0`); Operation is available when no WorkItem owns the request, with sanitized SourceRef. |
| AD-003 — `tests/blocked-round15-activity-owner.test.js` | Repeated Operations show the newest unsettled state and hide completed work. | Channel + native operation id is the dedupe boundary. | `selectFeatureSearchIndex` | Feed old/new rows for one native id plus a completed row; inspect operation projection. | Product owner restored. PASS: latest `updatedAt` wins; completed/cancelled/success terminal rows are omitted. |
| AD-004 — `tests/blocked-round15-activity-owner.test.js` | Global search finds visible in-progress Operations and retains their public SourceRef. | Search consumes the same visible operation projection; no private ticket/payload. | `selectFeatureSearchIndex` / `searchFeatureIndex` | Feed a visible waiting Operation with an artifacts SourceRef; search its title terms. | Product owner restored. PASS: operation title terms match and the result keeps channel/view/object identity. |

## Evidence

- Unit: `npx vitest run tests/feature-search-operations.test.js tests/blocked-round15-activity-owner.test.js --reporter=dot` — 2 files, 7 passed.
- Related unit regression: `npx vitest run tests/f5-management.test.jsx tests/artifacts.test.jsx tests/feature-search-operations.test.js tests/blocked-round15-activity-owner.test.js --reporter=dot` — 4 files, 16 passed.
- Browser: `ATOLL_TEST_WEB_PORT=16984 ATOLL_TEST_MOCK_PORT=18984 npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js --grep 'TC-0193|TC-0194|TC-0195|AD-004' --reporter=line` — 4 passed. AD-004 uses the real Composer → Agent activity snapshot → Workspace typed port path and verifies the same-request WorkItem result remains the searchable public row; the unit contract covers an Operation-only row.
- Build: `npm run build` — passed.

The former Round-15 `it.fails` declarations for AD-002/003/004 are now ordinary tests; no case is skipped or expected-fail. Same-request dedupe is intentionally WorkItem-first (`work_item` rank 0, `operation` rank 1, `turn` rank 2). A completed channel-creation operation is intentionally not used as the browser search fixture because AD-003 requires settled operations to disappear from the search projection.
