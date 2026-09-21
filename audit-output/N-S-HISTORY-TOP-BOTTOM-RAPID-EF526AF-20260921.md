# Browser N–S unique case — history top-to-bottom rapid round trip

Date: 2026-09-21
Case ID: `BROWSER-HISTORY-TB-001`
Product commit under review: `aa99e901de1ccbbb76420edb60afd265bec6e6db`
Owner: Reading/history public projection (`WorkspaceApp` → `ConversationSurface` →
`useConversationProjection`/`useHistoryConsumer` → `VendorListExecutor`).

## CAS / uniqueness decision

This commit registers exactly one browser user contract. Before this report was
added:

- `git log --all -- tests/browser/history-top-bottom-rapid.spec.js` had no
  result;
- no `audit-output/` or `docs/` record contained
  `history-top-bottom-rapid`;
- `BROWSER-N-S-FAE8B70-MIGRATION.md` covers six other N–S specs and 15 cases;
  this case is not one of those rows.

Therefore `BROWSER-HISTORY-TB-001` is the sole user-credit row for this
history top→bottom contract. No duplicate spec, alias case, or suite-level
credit is created.

The source file was an untracked browser baseline in the shared worktree. It
is added here once, in this detached worktree, as the canonical public-owner
test. The detached worktree is based exactly on the product commit above; the
test and this audit are intentionally separate from the SZ160 work.

## Case record

| Field | Contract |
|---|---|
| Baseline file / exact case | `tests/browser/history-top-bottom-rapid.spec.js:156` — `rapid top->bottom round trip on mixed-height-history keeps history loading and keeps every message reachable` |
| User capability | On a long mixed-height history, rapid wheel input can reach the oldest record, return to the tail, and still reach every message; the user never sees a stuck top, a blank viewport, or lost rows. |
| Architectural invariant | The committed Reading/history owner must admit and settle older-history supply under changing scroll input without a wedged admission token; virtualized presentation must preserve stable row identity and tail geometry through the round trip. |
| Setup / action | Real application entry; reset mock scenario `mixed-height-history`, seed `1918`; login as public `root`; rapid native wheel to the physical top, quiet settle, rapid wheel to the tail, then walk back upward while collecting public row IDs. |
| Public observables | `.timeline-message-list` scroll geometry, `[data-presentation-row-id]` rows, visible row count/identity, public history demand phase, reload/environment validity, and screenshots/evidence JSON. No private diagnostics are read or used as a verdict. |
| Disposition | **ACCEPT / PASS** — original focused/repeat5 provenance plus the public-only current-main repeat3 below. |

## Exact verification

The following focused/repeat commands are the original `64892ba` provenance on
`ef526af`; the current-main acceptance is recorded separately below.

Focused run:

```text
ATOLL_TEST_WEB_PORT=25744 ATOLL_TEST_MOCK_PORT=25745 \
npx playwright test tests/browser/history-top-bottom-rapid.spec.js \
  --workers=1 --reporter=line
1 passed (27.0s)
```

Independent repeat:

```text
ATOLL_TEST_WEB_PORT=25746 ATOLL_TEST_MOCK_PORT=25747 \
npx playwright test tests/browser/history-top-bottom-rapid.spec.js \
  --workers=1 --repeat-each=5 --reporter=line
5 passed (2.2m)
```

## Current-main replay

The same test/audit change was replayed without product changes onto exact
current main `aa99e901de1ccbbb76420edb60afd265bec6e6db` in a fresh detached
worktree. The real Chromium repeat was:

```text
ATOLL_TEST_WEB_PORT=25846 ATOLL_TEST_MOCK_PORT=25847 \
npx playwright test tests/browser/history-top-bottom-rapid.spec.js \
  --workers=1 --repeat-each=5 --reporter=line \
  --output=test-results-ns-history-top-bottom-aa99e90-repeat5
5 passed (2.3m)
```

This was the `05cb638` integration replay before the public-only oracle
rework; its private-diagnostics fields are historical evidence only, not a
current verdict. Its evidence JSON is retained under
`test-results-ns-history-top-bottom-aa99e90-repeat5/*/top-bottom-rapid-evidence.json`.

## Public-only revision

The reworked spec removes all `__ATOLL_DIAGNOSTICS__` reads and assertions.
The default gate fixes the ordinary `mixed-height-history` 120-turn scenario,
removes injected transport delay and huge-history overrides, and uses a 90s
normal-case timeout. Huge/slow variants are outside this default contract.

Fresh Chromium repeat3 on the same exact `aa99e90` worktree:

```text
ATOLL_TEST_WEB_PORT=25856 ATOLL_TEST_MOCK_PORT=25857 \
npx playwright test tests/browser/history-top-bottom-rapid.spec.js \
  --workers=1 --repeat-each=3 --reporter=line \
  --output=test-results-ns-history-top-bottom-aa99e90-public-repeat3
3 passed (1.4m)
```

Every public-only repeat reported:

- `oldestReached=1`, `seenTurnCount=120`, `walkSteps=68`;
- `missingTurns=[]`, `stuck=[]`, `blank=[]`;
- `reloadsDuringRun=0`, `missingRootFrames=0`;
- quiet top ended with public history demand `idle`, oldest turn `1`;
- settled tail had newest turn `120`, visible rows `3`, `maxGap=48`, and
  demand `idle`.

The public-only evidence JSON is retained in the detached worktree under
`test-results-ns-history-top-bottom-aa99e90-public-repeat3/*/top-bottom-rapid-evidence.json`.

## Boundary and non-changes

This proof exercises the real browser entry and public DOM. It does not import
private history helpers, add a compatibility owner, alter a fixture contract,
or use a diagnostic snapshot as a substitute for a user-visible assertion.
No `src/`, vendor, package, lockfile, or product owner file changed. No case
was deleted or skipped. SZ160 `964c2dc` is intentionally not included in this
commit; its acceptance remains a separate evidence/credit item.
