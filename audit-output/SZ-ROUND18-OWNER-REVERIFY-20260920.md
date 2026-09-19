# S–Z round 18 owner re-verification

Date: 2026-09-20. Scope: twenty still-OPEN S–Z rows selected away from the
Composer owner and the Reading/cache implementation boundary, with priority
given to the current Search, Tasks, and Workspace surfaces. This report is a
read-only owner review: no old module, skip, compatibility alias, or private
export is restored.

## Current public-owner spot checks

The adjacent current owners all pass their direct focused suites:

- Search: `selectFeatureSearchIndex`/`searchFeatureIndex` and `SearchFeature`
  cover visibility isolation, business-fact de-duplication, token/filter
  search, SourceRef opening, and modal behavior. The focused Search/Governance
  tests pass. The retired Operation Center `it.fails` cases remain untouched
  and are not reclassified as S–Z green.
- Tasks: `feature-tasks`, `TasksFeature`, Waiting controls, and the real
  Workspace composition cover explicit provider/control facts, currentness
  gates, task creation/source retention, and local automation scope. The
  focused Tasks/Waiting tests pass.
- Workspace: the current navigation hook and Workspace composition pass route
  fallback and channel/feature wiring. The old `writeWorkspaceRoute` context
  history contract is not present in the current owner; SZ-331 therefore stays
  OPEN rather than being inferred from the fallback behavior.

No focused Search/Tasks/Workspace repro exposed a real product regression in
this round. Consequently there is no source patch to manufacture; the only
valid dispositions below are direct evidence or explicit handoff/OPEN.

## Twenty OPEN rows reviewed

Each row keeps its original one-case contract and is listed separately even
when several rows share the same retired owner.

| Case | Current owner check | Disposition |
|---|---|---|
| SZ-059 | `tests/system-events.test.js`'s former protocol decoder has no current `src/protocol/system-events.js` owner or public consumer. | OPEN; handoff, not a product red. |
| SZ-060 | The former arbitrary-field rejection oracle has no current system-event decoder/presentation owner. | OPEN; retain pending a product owner. |
| SZ-061 | The former canonical system-event language/standard-actor presentation owner is absent; no replacement behavior is claimed. | OPEN; retain pending a product owner. |
| SZ-100 | The former Timeline reservoir contract is not covered by the current channel-switch identity successor. | OPEN; avoid inventing a Reading scheduler owner. |
| SZ-101 | The old test-only `status`/top-level-port shape is not a current public Search/Tasks/Workspace contract. | OPEN; retain as an owner handoff. |
| SZ-102 | No current public owner proves short-first-screen reservoir release. | OPEN; retain outside this round's owner boundary. |
| SZ-103 | No current public owner proves attach-authoritative underfill demand. | OPEN; retain outside this round's owner boundary. |
| SZ-104 | No current public owner proves attach-after-false demand recovery. | OPEN; retain outside this round's owner boundary. |
| SZ-220 | The deleted timeline-render-authority fixture has no current direct successor; `TimelineRowRenderer` does not expose the old reading-control contract. | OPEN; handoff, not a regression claim. |
| SZ-221 | Current row-render revision coverage explicitly documents that roster/target authority no longer reaches this renderer owner. | OPEN; do not infer the retired measurement behavior. |
| SZ-222 | Current capability-label inputs no longer reach the row renderer; no public rendered-label successor exists. | OPEN; retain pending owner ruling. |
| SZ-244 | The old browser-local timer-record store is deleted. Current `ChannelAutomationPanel` owns server `timer.after`/`timer.cancel` payloads, which is a different contract. | OPEN; retain rather than claim local persistence. |
| SZ-245 | The former `turn-presentation` owner/test is absent and no current public business-progress summary contract is exported. | OPEN; retain pending owner ruling. |
| SZ-280 | The old history scheduler's matched-live-terminal replay entrance is absent; current Replica closure tests do not prove that scheduler sequence. | OPEN; no cache/Reading owner duplication. |
| SZ-281 | No current public scheduler owner proves release of a newer terminal visible-gap page before an older request page. | OPEN; handoff. |
| SZ-282 | No current public owner proves bounded reservoir newest-first reveal across partial segments. | OPEN; handoff. |
| SZ-283 | No current public owner proves live-terminal merge before buffered replay publication. | OPEN; handoff. |
| SZ-284 | No current public owner proves IndexedDB replay ordering for terminal-before-request pages. | OPEN; handoff. |
| SZ-285 | No current public owner proves cached-terminal merge into a materialized request through the retired scheduler. | OPEN; handoff. |
| SZ-331 | Current `useChannelNavigation` proves safe route fallback only; the old context-entry `pushState`/`replaceState` distinction was removed with `workspace-route`. | OPEN; avoid modifying the dirty Workspace owner without a product ruling. |

Result: 20 rows reviewed, 0 rows closed, 20 rows retained OPEN. The central
ledger remains `163 GREEN, 0 RED, 1 PARTIAL, 143 OPEN, 20 GAP, 3 BLOCKED`.
The three blocked obsolete rows (SZ-011, SZ-272, SZ-273) are unchanged.

## Verification

Passing focused owner command:

```text
npx vitest run src/model/feature-tasks.test.js tests/feature-search.test.js tests/f5-management.test.jsx tests/tasks-feature-restore.test.jsx tests/work-items-restore.test.js tests/feature-waiting-controls.test.jsx tests/waiting-currentness-public.test.jsx tests/workspace-route-navigation.test.jsx tests/workspace-real-runtime-composition.test.jsx tests/workspace-channel-navigation.test.jsx tests/workspace-governance-features.test.jsx tests/workspace-channel-rail.test.jsx --reporter=dot
```

Result: 12 files, 36 tests passed. No source/vendor/package/lockfile change is
included in this round.
