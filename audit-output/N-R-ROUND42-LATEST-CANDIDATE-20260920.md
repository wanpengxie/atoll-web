# N–R Round 42 — latest public candidate verification

Date: 2026-09-20  
Reviewed product-candidate head: `ff6efd2` (`fix(reading): mint successor epoch after surface hide`)

## Decision

The latest Reading candidate closes the TC0224 geometry red, and the next
ledger gap (NR19-01 absolute-path right-panel references) is also green through
the current public panel owner. No private Reading owner or legacy store was
restored.

## TC0224 latest candidate

The Round 41 DOM-only black box in
`tests/browser/n-r-round41-reading-restore-blackbox.spec.js` now runs as a
normal regression contract. The old `test.fail()` marker was removed only after
the candidate had passed repeatedly; the test still requires the same row ID to
remain visible and the return-frame top spread to be `<=2px`.

```text
ATOLL_TEST_WEB_PORT=17012 ATOLL_TEST_MOCK_PORT=19012 \
  npx playwright test tests/browser/n-r-round41-reading-restore-blackbox.spec.js \
  --repeat-each=3 --reporter=line
```

Result: **3 passed**. The flow uses only login, public channel clicks, wheel
input, and DOM row geometry sampled with `requestAnimationFrame`; it does not
read diagnostics, call `runtime.bind`, inject a bookmark/session, or import a
private owner. The prior `120px` oscillation was reproduced at the pre-candidate
head and is no longer observed at `ff6efd2`.

## Next N–R item: NR19-01 right-panel link

The ledger's former `GAP-NR09` case was rerun with the current public
`WorkspaceRightPanel`/`ArtifactPreviewPanel` composition:

```text
npx vitest run tests/right-panel-file-reference.test.jsx --reporter=dot
```

Result: **1 file, 7 tests passed**. The surviving public behavior proves:

- an absolute Markdown path is intercepted and sent to the current channel's
  typed preview command (`defaultPrevented === true`, no `_blank` target);
- an unavailable command fails closed without fabricating an internal open;
- an artifact from a retired channel cannot borrow the new channel's command;
- ordinary web links remain unprevented with `_blank`;
- nested close/back and recent-file reopen preserve the one preview-stack owner.

Therefore NR19-01 is **ACCEPT/current**, superseding the stale `GAP-NR09`
classification in the older ledger. The two companion NR19 cases remain
passing as before.

## Supporting N–R checks

The current public roster/resource/right-panel support set also passes:

```text
npx vitest run \
  tests/right-panel-file-reference.test.jsx \
  tests/roster-self-from-attach.test.js \
  tests/roster.test.js \
  tests/resources.test.jsx --reporter=dot
```

Result: **4 files, 28 tests passed**.

The Reading coordinator/session/observation set remains **3 files, 20 tests
passed**. The surviving observation contracts are green; NR13-07 remains an
implementation-gap/oracle classification because the retired selection
navigation owner itself has no current public equivalent. That old private
owner is not reintroduced merely to make the historical row green.

## Boundary audit

Round 42 changes are limited to the public browser test's expected-red marker
removal and this audit. No `src/`, vendor, package, or lockfile path was edited;
no test was deleted or skipped; no private owner was exported or imported.
