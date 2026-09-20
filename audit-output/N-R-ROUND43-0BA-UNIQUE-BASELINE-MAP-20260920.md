# N–R Round 43 — `0ba` candidate recheck and unique-baseline map

Date: 2026-09-20  
Reviewed exact head: `0ba7fa7` (`fix(reading): make visible reentry epoch handoff idempotent`)

## Candidate recheck

### TC0224 public Reading black box

```text
ATOLL_TEST_WEB_PORT=17013 ATOLL_TEST_MOCK_PORT=19013 \
  npx playwright test tests/browser/n-r-round41-reading-restore-blackbox.spec.js \
  --repeat-each=3 --reporter=line
```

Result: **3 passed**. The test is the public DOM-only flow: login, wheel,
`c0 → c0.project → c0`, then requestAnimationFrame samples of the same
`data-presentation-row-id`. It requires the row to remain visible and the
return-frame top spread to stay `<=2px`. It does not call diagnostics,
`runtime.bind`, a private owner, or a manually injected bookmark/session.

The prior pre-candidate `120px` oscillation remains a historical red in the
Round 41 audit; it is not silently deleted. At exact `0ba7fa7`, the candidate
passes three independent repetitions.

### NR19-01 public right-panel link

```text
npx vitest run tests/right-panel-file-reference.test.jsx --reporter=dot
```

Result: **1 file, 7 tests passed**. The absolute-path Markdown case now proves
through `WorkspaceRightPanel`/`ArtifactPreviewPanel` that the current channel's
typed preview command is used, the browser navigation is prevented, and no
`_blank` target is added. The companion stale-channel, ordinary external-link,
nested back/close, and recent-reopen contracts also pass. NR19-01 is therefore
**ACCEPT/current**; the historical `GAP-NR09` label in the older ledger is
superseded by this current public-owner evidence.

## Unique baseline mapping

The authoritative N–R ledger remains **22 suites / 98 expanded rows**. The
following ranges are a partition of those rows; each row has one ledger owner
and is counted once. Round 43 adds no duplicate baseline row:

| Unique rows | Count | Current owner/evidence boundary | Round 43 disposition |
| --- | ---: | --- | --- |
| NR01–NR09 | 42 | node/access/OBS/offline/attachment/pane/abbreviation owners in the ledger | historical blocked/gap decisions remain; no replacement owner invented |
| NR10–NR12 | 17 | inline progress, handoff, and navigation coordinator tests | existing current-owner evidence; no duplicate row |
| NR13–NR15 | 17 | Reading session/coordinator/list/admission evidence | current surviving contracts rechecked separately; retired selection owner and old observation metadata remain oracle/gap boundaries |
| NR16–NR18 | 8 | Composer reply, request-owner, and attachment transaction public ports | existing current-owner evidence; no duplicate row |
| NR19–NR22 | 14 | right-panel, roster, and actor-visibility public owners | NR19-01 refreshed to ACCEPT; NR19-02/03 and NR20–22 retain their existing one-row mappings |
| **Total** | **98** | one-to-one partition of the ledger | **98/98 accounted for** |

TC0224 is a browser regression supplement to Reading geometry; it is not a new
top-level N–R row and must not be counted again as NR13/NR14. Likewise, the
NR19-01 rerun updates evidence for its existing row rather than creating a
second right-panel baseline.

There is no honest “next unique N–R baseline” after NR22-01. Remaining items
such as the retired selection-navigation owner and direct private self/feed
receipt cases are implementation oracles/gaps; they require a product-owner
contract decision, not private API restoration or a new duplicate test row.

## Supporting checks and boundary

The Reading coordinator/session/observation support set remains **3 files / 20
tests passed**. The public notification/Reading smoke set run during this round
was **3 files / 12 tests passed**.

Round 43 changed only this audit. No `src/`, Reading owner, vendor, package, or
lockfile path was edited; no test was deleted or skipped; no private owner was
exported or imported.
