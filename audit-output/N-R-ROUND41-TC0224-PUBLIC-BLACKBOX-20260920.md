# N–R Round 41 — TC0224 public black-box restore baseline

Date: 2026-09-20  
Reviewed run head: `c071b9b` (`test(e-h): verify reading closure boundaries`)

## Decision

**TC0224: REJECT — real public Reading geometry gap.** The smallest public
reproduction keeps the same presentation row mounted and visible, but the
row's screen top moves by `120px` during the return paint sequence
(`-118.5px ↔ 1.5px`). This is a restore/geometry handoff failure, not evidence
that the retired `blockID` field must be restored.

The current browser test remains an explicit expected-red baseline (`test.fail`)
so the product gap is recorded without deleting or skipping the contract. If a
future product change makes the assertion pass, Playwright will report that the
expected failure unexpectedly passed and the owner must re-adjudicate the case.

## Minimal public black box

The new case is
`tests/browser/n-r-round41-reading-restore-blackbox.spec.js`. It performs only
the user-visible flow:

1. reset the public mock scenario to `deep-history`,
2. log in through the form,
3. wheel upward in the visible `c0` timeline,
4. click public channel buttons `c0.project` and `c0`, and
5. sample the target `[data-presentation-row-id]` geometry with
   `requestAnimationFrame`.

It does not import a private owner, call a runtime binding, read diagnostics,
write scroll state, or inject a session/bookmark. The observer records DOM
geometry only.

Command:

```text
ATOLL_TEST_WEB_PORT=17008 ATOLL_TEST_MOCK_PORT=19008 \
  npx playwright test tests/browser/n-r-round41-reading-restore-blackbox.spec.js \
  --reporter=line
```

Result: **1 passed as expected-red**. The underlying assertion is
`spread <= 2px`, and the captured evidence is:

```text
anchor: c0-history-request-109
before top: -119.875px
visible return frames: 46
visible top samples: -118.5px, 1.5px, -118.5px, ...
spread: 120px
```

The same public row ID remains visible, so this is not a missing-row or
selector failure. The first contract break is the geometry stability assertion.

## Canonical F7 browser case

The existing contract was independently rerun at the reviewed state:

```text
ATOLL_TEST_WEB_PORT=17009 ATOLL_TEST_MOCK_PORT=19009 \
  npx playwright test tests/browser/f7-history-water-baseline-0222-0226.spec.js \
  -g 'TC0224' --reporter=line
```

Result: **1 failed**, at the existing `<=2px` return-frame spread assertion;
Playwright reported `Expected: <= 2`, `Received: 120`.

## Old baseline semantics and `blockID`

The old observable contract is a stable semantic row anchor, not a private
adapter field:

- the bookmark resolves a stable message/row ID and a row-local
  `rowViewportOffset`; the public initial placement is one-shot;
- a browser return must keep that same row visible at the same screen position;
  the historical target was within `1px`, while the current F7 gate checks
  `<=2px` over the return frames;
- after the first viewability signal, wheel/touch/key input invalidates stale
  initialization; post-mount retries must not fight the user.

These rules are documented in
`docs/CONVERSATION-LEGEND-INTEGRATION-SPEC.md` (§3.3 and gate 7.2). Round 40
already exercised the current public `VendorListExecutor` path with a bookmark
containing `messageID + rowViewportOffset`, and with the same bookmark plus
legacy `blockID`; both produced the same visible index and typed offset command.
Therefore `blockID` is retained only as retired observation metadata and is not
reintroduced as a restore compatibility field.

## N–R supporting cases

The current coordinator/session/observation support set was run together:

```text
npx vitest run \
  tests/reading-navigation-coordinator.test.js \
  tests/reading-session-ports.test.js \
  tests/reading-observation-settle.test.jsx --reporter=dot
```

Result: **3 files passed, 20 tests passed, 0 failed**.

NR13-01 through NR13-06 remain covered by the current coordinator/session/list
public-owner evidence. NR13-07 remains `GAP-NR08`: the retired selection
navigation owner is not present in the current single-list path. No private
wrapper or old owner API was restored to make that row green.

## Boundary audit

Round 41 changes are limited to the new browser evidence and this audit. No
`src/`, vendor, package, or lockfile path was edited. No test was deleted or
skipped, and no private owner was exported or imported.
