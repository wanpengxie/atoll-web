# N–R Round 40 — public restore adjudication for `blockID`

Date: 2026-09-20  
Reviewed run head: `b5ad7c5` (`test(timeline): define Presentation authority receipt`)

## Decision

`blockID` is **not part of the current user restoration contract**. It is legacy
detailed observation metadata from the retired list adapter, not a field the public
restore path needs to locate or position a row.

The current public contract is the stable row identity plus its row-local viewport
offset. The current integration specification describes this as resolving a browsing
bookmark by stable ID and `rowViewportOffset`; it does not require a content block
identity. The old adapter's detailed settled/lifecycle diagnostic could additionally
report a block, but its initial placement still consumed the row ID and row offset.

No product compatibility field was restored.

## Public owner unit evidence

`tests/reading-observation-settle.test.jsx` now exercises the actual
`VendorListExecutor` public surface with two saved browsing bookmarks:

1. `messageID + rowViewportOffset`;
2. the same bookmark plus legacy `blockID`.

Both cases produce the same `initialTopMostItemIndex` and the same typed
`scrollToIndex({ index: 0, align: 'start', offset: 24 })` command. This is the
user-visible restore decision at the current owner boundary, not a private helper or
a direct model-only assertion. The historical NR14-01 observation keeps the rAF gate,
source/settled/tail, and following assertions, but no longer treats the retired
detailed field as a required user capability.

Focused unit command:

```text
npx vitest run \
  tests/reading-observation-settle.test.jsx \
  tests/reading-session-ports.test.js \
  tests/message-list-lifecycle.test.jsx \
  tests/i-m-exact-path-contracts.test.jsx \
  -t "TC-0975|TC-0977|TC-0978|TC-0979|reading observation settlement|public Reading geometry bookmark|restores a committed content anchor" \
  --reporter=dot
```

Result: **3 files passed, 1 unmatched file skipped; 10 tests passed, 167 skipped**.
The dedicated Reading observation file is **5/5 passed**, including the new
blockID/no-blockID public restore equivalence case.

## Actual user-visible restore check

The Chromium public channel-switch restore check was also run:

```text
ATOLL_TEST_WEB_PORT=17003 ATOLL_TEST_MOCK_PORT=19003 \
  npx playwright test tests/browser/f7-history-water-baseline-0222-0226.spec.js \
  -g "TC0224" --reporter=line
```

Result: **REJECT — existing geometry/restore product red**, independent of
`blockID`. The saved row becomes visible, but its top oscillates from approximately
`-118.5px` to `1.5px` during the return paint sequence (spread `120px`; contract is
`<=2px`). The failure is therefore a real public restore stability issue, not proof
that the old block field must return. No product file was changed to mask it.

## Per-case disposition

| Case | Result | Reason |
| --- | --- | --- |
| NR14-01 observation settlement | ACCEPT after contract correction | rAF-before-observation, user source, settled tail, following authority, and row bookmark semantics pass; `blockID` is classified as retired diagnostic metadata. |
| Public row restore with/without `blockID` | ACCEPT | Same visible row index and same typed offset command through `VendorListExecutor`. |
| Chromium TC0224 channel-switch restore stability | REJECT / product gap | Public row remains visible but moves `120px` during restore; first actionable owner is the current restore/geometry handoff, not a missing block field. |

Boundary audit: only `tests/reading-observation-settle.test.jsx` and this audit were
changed by this round. No `src/`, vendor, package, or lockfile path was edited; no
private owner was exported; no case was deleted or skipped.
