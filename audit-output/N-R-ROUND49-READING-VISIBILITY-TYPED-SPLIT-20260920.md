# N–R Round 49 — Reading visibility typed split

Date: 2026-09-20  
Reviewed committed candidate: `fdb346f` (`fix(reading): retire detached root observations`), with visibility implementation from `0b62556`.

## Acceptance contract

| Lane | Required behavior | Result against committed candidate |
| --- | --- | --- |
| Ordinary observation | May update the public Reading bookmark/session only; it must not mint or retain tail authority evidence. | **REJECT — product gap** |
| Authority tail receipt | Must carry the complete typed tuple: current activation/input/intent/presentation identity, root identity/node, tail ID, installed high sequence, visible row IDs and hit-test rows, current DOM/presentation revisions, and settled surface state. | **ACCEPT** |
| Incomplete authority receipt | Missing root/typed tuple data must not promote the viewport to `tailCaughtUp`. | **ACCEPT** |

## Focused evidence

```text
npx vitest run tests/n-r-round47-reading-visibility-unit-oracle.test.jsx --reporter=dot
```

Result on the committed candidate: **1 file, 6 passed, 0 expected failures**. The two former Round 47 expected failures (old input epoch and old observation identity) are now ordinary passing tests.

The current tuple is accepted only after the public adapter supplies the complete receipt. Old activation/root, DOM revision, visible-ID, observation identity, and re-entry input epoch cases are rejected. A temporary split probe with `rootNode: null` also stayed unsettled, confirming that incomplete authority data does not grant tail authority.

The ordinary probe entered browsing through `viewport.beginNavigation({ direction: 'older' })`, then supplied only a bookmark/session observation (`settled: false`, no typed DOM tuple). It returned `false` before updating the bookmark. This is the first product gap: ordinary observations are still forced through the authority receipt gate instead of remaining a non-authority bookmark/session lane.

## Boundary review

The committed candidate has no permissive `!strictEvidence` fallback: `authorityCurrent` requires `evidence.authorityVerified === true` and the complete current tuple. The latest shell subsequently produced an uncommitted `useConversationProjection.js` dirty diff tightening defaults further; it was not included in this run and must be committed before re-running the oracle.

No product file was edited by this review. The temporary split probe was removed after classification; no expected-fail test or private API export was retained.
