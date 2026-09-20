# N–R Round 47 — Reading visibility unit oracle

Date: 2026-09-20  
Reviewed head: `6ca25ae` (`audit(e-h): define tc0231 startup background contract`)

## Scope

This round adds only a test oracle and this audit. The public Reading
projection is exercised through `useConversationProjection`; the visibility
adapter is exercised through its public `reportDomEvidence` result. No source
owner, private export, legacy store/API, vendor, package, or lockfile path was
changed.

## Visibility matrix

| Case | Required public result | Current result |
| --- | --- | --- |
| old root / activation | retired activation is ignored; current session identity is unchanged | **ACCEPT** |
| old `domPresentationRevision` | observation is not settled | **ACCEPT** |
| empty `visibleRowIDs` | observation is not settled | **ACCEPT** |
| old `observationIdentity` | observation is not settled | **REJECT — product gap** |
| current tuple | current activation/input/presentation/DOM/visible-ID tuple settles | **ACCEPT** |
| old `inputEpoch` after visibility re-entry | `observeReading` rejects it and projection must not install `nextEvidence` | **REJECT — product gap** |

The two rejected rows are retained as `it.fails` evidence until the Reading
architecture owner approves the placement of the input/observation identity
fence. They are not skipped tests: each assertion names the expected user
contract and currently fails against the product behavior.

## Focused run

```text
npx vitest run tests/n-r-round47-reading-visibility-unit-oracle.test.jsx --reporter=verbose
```

Result at the reviewed visibility candidate: **1 file, 4 passing assertions,
2 expected failures (6 total)**.

The old-input test first establishes a positive current receipt, performs a
public surface hide/re-entry (minting a successor epoch), and then delivers
the old epoch. The old identity test supplies a retired identity while all
other positive fields remain present. Both currently reach the owner’s
evidence state, so the test records a genuine owner/architecture gap rather
than weakening the tuple.

## Boundary

No product files were edited; no private owner/API was exported or imported
for compatibility; no test was deleted or skipped. The new test is
`tests/n-r-round47-reading-visibility-unit-oracle.test.jsx` and this audit is
the only audit change for Round 47.

