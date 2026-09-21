# Browser G–M TC0267 / case 21 — production admission anchor

## Claim and deduplication

- **Unique claim:** TC0267, the ledger's case-21 contract: when a mounted
  production row below the user's browsing viewport grows, the visible
  reading anchor remains stable and the list does not become blank.
- **Old source:** `fae8b70:tests/browser/legend-production-admission.spec.js:4`.
  The old fixture grew one row by 28px after a real browsing gesture and
  required the same anchor identity, no blank paint, and an anchor offset
  delta of at most 1px.
- **Current successor:**
  `tests/browser/legend-production-admission.spec.js` in this commit. It uses
  the production app and mock control API, not the deleted
  `reading-viewport.html` fixture.
- Repository-wide `git log --all`, refs, audit reports, and the migration
  ledger were checked before this claim. No TC0267/case-21 successor or
  claim was found. TC0247–TC0266, TC0264's T–Z menu claim, and the TC0258
  no-loop claim are distinct baselines and are not reused here. No
  TC0267/TC0268/TC0269 claim exists in the current refs.

## Contract and owner

The user logs into channel `c0`, scrolls the production timeline into
`browsing`, and observes a mounted conversation row in the viewport. A new
progress/terminal transaction grows a row below that anchor. The public
contract is:

1. the timeline remains in `browsing`;
2. at least one row remains visible in the list (no user-visible blank); and
3. the same DOM row's screen `y` position changes by no more than 2px.

The production Reading/Virtuoso adapter is the sole behavior owner. The test
uses only public DOM state (`data-viewport-mode`, row identity, bounding boxes,
and visible intersection) plus the public mock action endpoint. It does not
read diagnostics, private state, or writer counters.

## Test-only correction

The inherited successor selected the first mounted `.agent-conversation-turn`.
Virtuoso intentionally keeps measured off-screen shells mounted with
`visibility:hidden`, so that selector always chose
`c0-history-request-46` at `y=-918px` and failed before the growth action. This
was a fixture/test selector error, not a product result. The successor now
selects the first conversation row whose public bounding box intersects the
actual `.timeline-message-list` viewport and whose shell is not hidden. The
semantic contract and strict geometry oracle are unchanged.

## Exact verification

Base: `b34b59d3ed825237033a8e35d1003f18b26dc6c5` (detached clean worktree).

```text
CHOKIDAR_USEPOLLING=true CHOKIDAR_INTERVAL=1000 \
ATOLL_TEST_MOCK_PORT=26370 ATOLL_TEST_WEB_PORT=17370 \
npx playwright test tests/browser/legend-production-admission.spec.js \
  --repeat-each=5 --workers=1 --reporter=line \
  --output=/tmp/gm-tc0267-b34b59d-repeat5-fixed
```

Result: **5/5 passed** in real Chromium (31.8s). The pre-correction selector
was independently reproduced as **0/5** with the hidden off-screen shell; no
product change was made.

```text
npm run build
```

Result: **passed**. Vite emitted only the existing large-chunk advisory.

## Scope and disposition

Changed files are limited to this test-only public-selector correction and
this audit. No product source, vendor code, mock behavior, package metadata,
or unrelated test was changed.

**Disposition: ACCEPT TC0267 / case 21, one unique credit.**
