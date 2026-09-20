# N–R Round 39 — picker receipts, mobile drawer, Governance, and next baseline cases

Date: 2026-09-20  
Reviewed HEAD: `15e4470` (`fix(reading): revoke notification lease on native leave`)

## Scope and boundary

This round re-ran the public-owner picker, mobile drawer, and Governance contracts at
the current HEAD, then resumed the next N–R baseline cases. The only implementation
change in this round is the test-only restoration of the historical `blockID`
bookmark assertion in `tests/reading-observation-settle.test.jsx`. No `src/`, vendor,
package, or lockfile path was edited; no private owner was exported; no case was
deleted or skipped.

## Public-owner verification

The focused public-owner run was:

```text
npx vitest run \
  tests/workspace-real-runtime-composition.test.jsx \
  tests/workspace-file-picker.test.jsx \
  tests/n-r-round34-picker-governance.test.jsx \
  tests/n-r-round35-shell-filter-notification.test.jsx \
  tests/world-change-reset.test.js \
  tests/blocked-round35-governance-public-owner.test.jsx \
  tests/channel-access.test.js \
  tests/right-panel-file-reference.test.jsx \
  --reporter=dot
```

Result: **8 files, 44 passed, 0 failed**.

| Contract | Result | Evidence |
| --- | --- | --- |
| Picker receipt provenance and refresh failure | ACCEPT | `workspace-file-picker.test.jsx`, `n-r-round34-picker-governance.test.jsx` |
| Mobile drawer focus trap and inert background | ACCEPT | `n-r-round34-picker-governance.test.jsx`, `n-r-round35-shell-filter-notification.test.jsx` |
| World-reset waiter/creation fence | ACCEPT | `world-change-reset.test.js`, `workspace-real-runtime-composition.test.jsx` |
| Registrar template identity and create-parent identity | ACCEPT | `workspace-real-runtime-composition.test.jsx`, `n-r-round34-picker-governance.test.jsx` |
| Governance failed terminal and retry | ACCEPT | `blocked-round35-governance-public-owner.test.jsx` |
| Public Registrar wire chain | ACCEPT | `tests/browser/governance-template-wire-contract.spec.js` (Playwright: 1 passed) |

The browser check was run with isolated ports:

```text
ATOLL_TEST_WEB_PORT=17001 ATOLL_TEST_MOCK_PORT=19001 \
  npx playwright test tests/browser/governance-template-wire-contract.spec.js --reporter=line
```

## Next N–R baseline cases

The focused baseline run was:

```text
npx vitest run \
  tests/reading-observation-settle.test.jsx \
  tests/right-panel-file-reference.test.jsx \
  --reporter=verbose
```

Result: **2 files, 10 passed, 1 failed**. The failure is deliberately retained as
the product gap below.

| Case | Result | Current public evidence |
| --- | --- | --- |
| NR14-01 — user wheel + settled sampling preserves following and bookmark identity | REJECT / `GAP-NR08` | rAF-before-observation (`0`) and `source:user`, `settled:true`, `atTail:true`, `following` all pass; restored baseline `bookmark.blockID === "block:tail"` fails because the owner publishes only `messageID`. |
| NR14-02 — selection/autoscroll cannot acquire following | ACCEPT for current public contract | Settled paint evidence remains non-authoritative and the session remains `browsing`. The old private selection owner is not reintroduced. |
| NR14-03 — input-free layout arrival is non-authoritative | ACCEPT | `source:settled`, `settled:true`, `atTail:true`, session remains `browsing`. |
| NR14-04 — stale user evidence after epoch advance is rejected | ACCEPT | The settled observation is non-authoritative and the session remains `browsing`. |
| NR19-01 — absolute Markdown path opens through Atoll, never browser navigation | ACCEPT | Current `WorkspaceRightPanel` public `files.commands.preview` receives the parsed absolute resource; click is prevented. External link remains `_blank` and unprevented. |
| NR19-02 — nested close has back semantics | ACCEPT | Existing public `ArtifactPreviewPanel` stack contract passes. |
| NR19-03 — recent file reopens through preview command | ACCEPT | Existing public `FilesFeature` recent port contract passes. |

NR14-01 is the only newly surfaced red. It is an owner evidence-shape gap, not a
test-fixture or private-API issue: `topVisibleBookmark` currently has no `blockID`
field. The test also retains the pre-rAF `observations.length === 0` check. No product
change was made to hide this failure.

## Final disposition

Picker receipts, mobile drawer, Governance, and the right-panel link contract are
**ACCEPT** at this HEAD. NR14-01 remains **REJECT / GAP-NR08** until the public
Reading owner publishes the baseline block identity; NR14-02–04 and NR19-01–03 are
green under their current public contracts. No forbidden boundary was crossed.
