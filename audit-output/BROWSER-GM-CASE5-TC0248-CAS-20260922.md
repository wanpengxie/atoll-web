# Browser G–M case 5 / TC-0248 CAS

Date: 2026-09-22  
Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`)  
Current base: `640d4459317e472ad3d9912ac36f21c95208d481` (`640d445`)

## Atomic ledger and cross-browser CAS

The central migration ledger records this declaration as:

```text
TC-0248 — fae8b70:tests/browser/history-reveal-prototype.spec.js:355
activation replacement drops an in-flight reveal token without replay
target a8c9165: path absent; blocked pending product decision
```

The G–M migration packet has a current public successor, but no dedicated
TC-0248 successor/CAS report existed before this claim. The preceding
G–M case-4 claim closes only TC-0247 at line 294; TC-0250/TC-0251 are the
separate history-start-boundary declarations. A repository-wide search found
no other current report claiming TC-0248. This packet claims exactly one
previously uncredited G–M declaration.

## Preserved public contract

On the real `/` AppShell, after an in-flight delayed-history gesture:

1. Replacing `c0` with `c0.project` must not replay the old c0 reveal rows into
   the project surface; the project heading and public list remain usable.
2. Returning to `c0` must restore a visible c0 reading list with rows, without
   leaking project rows into the restored channel.
3. The evidence uses real Chromium input, production DOM row identities and
   public heading/list state. It does not inspect cache state, React fibers,
   private diagnostics, request IDs, or a second list owner.

## Exact Chromium evidence

Clean detached worktree:

```text
worktree: /tmp/gm-case5-640d445
base:     640d4459317e472ad3d9912ac36f21c95208d481
```

Focused repeat-three run:

```text
ATOLL_TEST_MOCK_PORT=26348 ATOLL_TEST_WEB_PORT=17348 \
npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='channel activation replacement drops in-flight history without replaying old rows' \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=/tmp/gm-case5-640d445-r3
```

Result: **3 passed (19.8s)**.

Adjacent same-file smoke (TC-0247 plus this case):

```text
ATOLL_TEST_MOCK_PORT=26349 ATOLL_TEST_WEB_PORT=17349 \
npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='history status identity and reduced-motion|channel activation replacement drops' \
  --workers=1 --reporter=line \
  --output=/tmp/gm-case5-640d445-adjacent
```

Result: **2 passed (13.0s)**.

`npm run build`: **PASS**; Vite emitted only the existing chunk-size warning.

## Boundary

This claim adds audit evidence only. No product source, mock scenario,
fixture, vendor, package/lockfile, skip, or assertion weakening is included.

## Result

**ACCEPT — test/audit-only atomic claim.** TC-0248 is the next unique,
previously uncredited G–M browser declaration.
