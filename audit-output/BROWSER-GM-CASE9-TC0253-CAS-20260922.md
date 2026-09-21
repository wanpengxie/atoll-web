# Browser G–M case 9 / TC-0253 CAS

Date: 2026-09-22  
Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`)  
Current base: `28bc0b832414f2a7fcc4df4351a9b296ffe49500` (`28bc0b8`)

## Atomic ledger and cross-browser CAS

The central migration ledger records this declaration as:

```text
TC-0253 — fae8b70:tests/browser/horizontal-table-scroll.spec.js:204
wide Markdown table keeps native horizontal reading position through background App updates
target a8c9165: path absent; blocked pending product decision
```

The G–M migration packet has a current public successor and reports this
contract as passing, but no dedicated TC-0253 successor/CAS report existed
before this claim. TC-0248 and TC-0250/TC-0251 are separate declarations;
a repository-wide search found no other TC-0253 claim. This packet claims
exactly one previously uncredited G–M declaration.

## Preserved public contract

On the real `/` AppShell, a wide Markdown table remains a native horizontal
reading surface:

1. Shift+wheel moves the table's native `scrollLeft` and produces a trusted
   user scroll event.
2. A background pulse and dense progress update keep the same scroll node
   connected and do not reset its horizontal position.
3. The public evidence records zero application `scrollLeft` writes; no cache,
   React fiber, private diagnostic, or alternate scroll owner is inspected.

## Exact Chromium evidence

Clean detached worktree:

```text
worktree: /tmp/gm-case9-28bc0b
base:     28bc0b832414f2a7fcc4df4351a9b296ffe49500
```

Focused repeat-three run:

```text
ATOLL_TEST_MOCK_PORT=26353 ATOLL_TEST_WEB_PORT=17353 \
npx playwright test tests/browser/horizontal-table-scroll.spec.js \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=/tmp/gm-case9-28bc0b-r3
```

Result: **3 passed (16.3s)**.

`npm run build`: **PASS**; Vite emitted only the existing chunk-size warning.

## Adjacent owner note

The separate `legend-production-admission.spec.js` smoke was independently
repeated and failed before TC-0253's table action: its agent anchor was not
visible after the older wheel (`0/1`, then `0/2`). This is a distinct Reading /
production-admission regression and is not used as evidence against the
horizontal-table contract; it remains unmodified and unclaimed here.

## Boundary and result

This claim adds audit evidence only. No product source, browser spec, fixture,
vendor, package/lockfile, skip, or assertion weakening is included.

**ACCEPT — test/audit-only atomic claim.** TC-0253 is the next unique,
previously uncredited G–M browser declaration. The adjacent anchor regression
is retained as a separate owner packet, not hidden by this claim.
