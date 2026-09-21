# Browser G–M case 20 / TC-0266 CAS

Date: 2026-09-22  
Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`)  
Current base: `e329ca5a1d4b0c47f4387c3a23848a8f46345536` (`e329ca5`)

## Atomic ledger and uniqueness

The central migration ledger records this declaration as:

```text
TC-0266 — fae8b70:tests/browser/layout-responsive.spec.js:132
LAYOUT-05 Context takes the workspace at 800px and the full surface at 600px
target a8c9165: path absent; blocked pending product decision
```

No dedicated TC-0266 successor or audit claim was found in repository history.
TC-0264 (LAYOUT-03 member menu) and TC-0265 (LAYOUT-04 completed Agent
answer) are separate declarations. This packet claims exactly one previously
uncredited G–M browser declaration.

## Preserved public contract

On the real `/` AppShell using the documented `resource-workflow` scenario:

1. at an 800px viewport, opening the public `成员` context panel starts it at
   the channel-rail edge and makes it occupy the remaining workspace through
   the viewport edge;
2. at a 600px viewport, the same panel takes the full surface from `left=0`
   through the viewport edge; and
3. both states keep document width within the visual viewport, with no
   horizontal overflow.

The successor uses public roles and DOM geometry only. It does not inspect
private layout state, React internals, cache, diagnostics, or writer traces.

## Exact Chromium evidence

Clean detached worktree:

```text
worktree: /tmp/gm-case20-tc0266-e329ca5
base:     e329ca5a1d4b0c47f4387c3a23848a8f46345536
```

Successor:

```text
tests/browser/gm-tc0266-context-responsive.spec.js
```

The first disposable run exposed a test-only geometry API mistake: Playwright
`boundingBox()` returns `x`/`width`, not a `right` field. All three repetitions
stopped at that assertion before the product contract was evaluated. The
successor was corrected to compare `panel.left` with `rail.x + rail.width`,
which is the same public geometry contract; no threshold or product code was
changed.

Focused corrected repeat-three run:

```text
CHOKIDAR_USEPOLLING=true CHOKIDAR_INTERVAL=1000 \
ATOLL_TEST_MOCK_PORT=26367 ATOLL_TEST_WEB_PORT=17367 \
npx playwright test tests/browser/gm-tc0266-context-responsive.spec.js \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=/tmp/gm-case20-tc0266-e329ca5-r3-fixed
```

Result: **3 passed (18.0s)**. A non-fatal Vite WebSocket proxy `ECONNRESET`
was logged between repetitions; Chromium assertions and the final run all
passed.

`npm run build`: **PASS** (`4306 modules transformed`; existing large-chunk
warning only).

## Boundary and result

This delivery adds only the dedicated browser successor and audit packet. No
product source, CSS, mock scenario, fixture, vendor, package/lockfile, skip,
or weakened assertion is included. TC-0258's two Reading/geometry red oracle
cases remain untouched and are not used as evidence here.

**ACCEPT — test/audit-only atomic claim.** TC-0266 is one unique G–M browser
declaration with a public 800/600px successor and 3/3 real Chromium passes.
