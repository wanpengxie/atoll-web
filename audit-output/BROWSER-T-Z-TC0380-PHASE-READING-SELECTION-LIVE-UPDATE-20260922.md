# TC0380 browser migration — native selection survives a live update

## Identity and scope

- Baseline: `fae8b70:tests/browser/reading-viewport.spec.js`, C2/C4 case
  “keeps a live DOM selection while the visible content is stable”.
- Exact migration base: `546a3d53dd59d16d04dc28a19bada7117dc46650`.
- Reservation: `823268ca82c54d8027fe7bda83365759f9b9400a`.
- Scope is the public Reading surface only. No product, fixture, mock,
  package, snapshot, or assertion-threshold changes.
- No other TC0380 ref, worktree, or spec was found before reservation.

## Contract mapping

The old callback used the retired `reading-viewport.html` fixture and its
private `window.readingFixture` API. The current successor keeps the same
user-visible contract on production `long-running-history`:

1. Enter `c0`, scroll upward with a real wheel, and verify public `browsing`
   mode.
2. Create a native browser selection across visible message rows using
   Playwright's real `selectText` gesture followed by Shift+ArrowDown. The
   selection must have distinct presentation-row anchor/focus IDs, non-empty
   text, and connected endpoints.
3. Submit one canonical public `q_tail_append` and require its returned row to
   materialize exactly once with the marker text.
4. Require `browsing` to remain user-owned, the exact selected text to remain
   unchanged, both selection endpoints to remain connected, and page errors to
   remain absent.

The oracle reads only public DOM rows, `window.getSelection()`, the public
viewport mode, and the canonical mock action response. It does not inject a
Range, inspect private diagnostics, or read internal Replica/Reading state.

## Evidence

### Chromium

Command:

```text
ATOLL_TEST_WEB_PORT=15247 ATOLL_TEST_MOCK_PORT=18943 \
  npx playwright test tests/browser/tc0380-phase-reading-selection-live-update.spec.js \
  --repeat-each=3 --reporter=line
```

Result: **PASS 3/3**, 31.6s. Every fresh browser context selected text across
visible rows, installed one live tail row with its marker, preserved exact
selection text and connected endpoints, stayed in browsing mode, and emitted
no page error.

### Build

Command: `npm run build`

Result: **PASS** (`vite v8.0.16`, 4306 modules transformed, built in 3.11s).

## Verdict

**ACCEPT** — the current product satisfies TC0380's public user contract on
the exact migration base. No product gap was found. The final commit contains
only the executable browser successor and this audit; remove the temporary
`node_modules` symlink before committing.
