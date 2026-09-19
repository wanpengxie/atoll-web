# S–Z round 19 owner re-verification

Date: 2026-09-20. Scope: the next S–Z OPEN block (SZ-105–SZ-126, excluding
the already-closed gaps) plus one retained Tasks/Waiting row (SZ-281) revisited
until its current public owner could be proved. Reading/cache rows are audit-
only in this round; no old scheduler, compatibility alias, skip, or private
export is restored.

## Owner-first result

The current Search, Tasks, and Workspace spot checks remain green. Search
visibility/de-duplication/SourceRef behavior, Tasks provider and Waiting
currentness behavior, and Workspace route/composition behavior all pass their
focused public suites. There is no real Search/Tasks/Workspace product red to
patch in this round.

One Tasks/Waiting case was closable through a strict current-owner successor:

| Case | Current public owner and proof | Result |
|---|---|---|
| SZ-281 | `createChannelReplicaStore` → `selectFeatureWaitingFacts`; `tests/waiting-replay-owner.test.js` commits a terminal-first page, trims it to an exact closure, then admits the older request/queued page. | GREEN. The terminal closure remains authoritative and the Waiting projection emits no resurrected action. |

This maps the user-visible invariant, not the deleted `history-scheduler` or
`selectWaitingPresentation` implementation. No source change was needed.

## Twenty OPEN rows reviewed

| Case | Current owner check | Disposition |
|---|---|---|
| SZ-105 | The former Timeline scheduler retry state has no current direct public successor. | OPEN; Reading-boundary handoff. |
| SZ-106 | No current public owner proves demand consumption after a real prepend without reservoir duplication. | OPEN; retain. |
| SZ-107 | No current public owner proves continuation ownership across hidden-row rerender. | OPEN; retain. |
| SZ-108 | Current channel-switch identity coverage does not prove the retired View Session restoration path. | OPEN; retain pending owner-level proof. |
| SZ-109 | The old same-phase admission/receipt oracle is not directly exercised through a current user surface. | OPEN; Reading-boundary handoff. |
| SZ-110 | No current public member-filter owner proves the mixed-member complete-turn contract from the deleted fixture. | OPEN; retain rather than infer from actor chips. |
| SZ-111 | No current public owner proves zero-row filtered semantic supply independent of virtual-list underfill. | OPEN; retain. |
| SZ-112 | No current public owner proves self-less All projection backfill under protocol-hidden facts. | OPEN; retain. |
| SZ-113 | The old IndexedDB deep-supply retry path has no current direct public test. | OPEN; cache/Reading handoff. |
| SZ-114 | No current public owner proves freshness failure plus exact same-owner retry for this deleted fixture. | OPEN; retain. |
| SZ-115 | No current public owner proves known Meta plus zero Replica rows drives scheduler feedback. | OPEN; retain. |
| SZ-116 | Cached-body/freshness-error orthogonality is not directly exported by the current Search/Tasks/Workspace owners. | OPEN; retain. |
| SZ-117 | No current public owner proves scheduler recovery after filtered zero-row supply failure. | OPEN; retain. |
| SZ-118 | No current public owner proves retry reopening the exact source block after a scanned zero-row failure. | OPEN; retain. |
| SZ-119 | No current public owner proves cached body remains readable during foreground history failure with one Retry. | OPEN; Reading handoff. |
| SZ-120 | No current public owner proves a background-only source error cannot replace cached body. | OPEN; Reading handoff. |
| SZ-124 | No current public owner proves an empty-account invitation appears only after completed synchronization. | OPEN; retain. |
| SZ-125 | No current public owner proves reconnect zero-head placeholder is non-authoritative before foreground probing. | OPEN; retain. |
| SZ-126 | No current public owner proves filtered first-batch explanatory text and the same foreground supply. | OPEN; retain. |
| SZ-281 | Current Replica closure + Tasks Waiting successor passes the terminal-first/older-request invariant. | GREEN; closed above. |

Result: 20 rows reviewed, 1 row closed, 19 rows remain OPEN. The central
ledger is now `164 GREEN, 0 RED, 1 PARTIAL, 142 OPEN, 20 GAP, 3 BLOCKED`.
The three blocked obsolete rows (SZ-011, SZ-272, SZ-273) remain unchanged.

## Verification

Passing focused owner command:

```text
npx vitest run tests/waiting-replay-owner.test.js src/model/feature-tasks.test.js tests/feature-search.test.js tests/f5-management.test.jsx tests/tasks-feature-restore.test.jsx tests/work-items-restore.test.js tests/feature-waiting-controls.test.jsx tests/waiting-currentness-public.test.jsx tests/workspace-route-navigation.test.jsx tests/workspace-real-runtime-composition.test.jsx tests/workspace-channel-navigation.test.jsx tests/workspace-governance-features.test.jsx tests/workspace-channel-rail.test.jsx --reporter=dot
```

Result: 13 files, 37 tests passed. No product red, vendor/package/lockfile, or
compatibility change is included.
