# TC0375 browser migration — tail downward input preserves Following

## Identity and scope

- Baseline: `fae8b70:tests/browser/reading-viewport.spec.js`, P1 case “tail downward wheel with no movement keeps following and the next append reachable”.
- Exact migration base: `a08ecd792a0b7fce6a28ae86112c5ac3e330cfa9`.
- Reservation: `275506dd2d6bea5001e4e5dbac4b01c42b94fbfe`.
- Scope is the public Reading surface only. No product, fixture, mock, package, snapshot, or assertion-threshold changes.
- Before reservation, full refs/worktree search found no TC0375 claim/spec; TC0361, TC0342, TC0357, Space, and SZ claims were excluded.

## Contract mapping

The migrated test preserves the baseline sequence on the current public owner:

1. Reset the real `long-running-history` scenario with seed `0x510918` and
   enter channel `c0`.
2. Confirm the canonical active Reading list is Following and already at the
   physical tail (`gap <= 24`).
3. Perform a real Chromium downward wheel (`deltaY=560`) while the pointer is
   over the list. Since the reader is already at the tail, this input must not
   move the list or revoke Following.
4. Submit one real public `q_tail_append` control action, then require its
   returned row to appear exactly once, remain readable, and stay at the
   physical tail under Following.

The oracle reads only user-visible DOM state (`.timeline`, the active public
message list, row identity/text, and scroll geometry). It does not inspect
private diagnostics, internal input epochs, or implementation-specific list
engines. A page-level error listener is also required to remain empty.

## Evidence

### Chromium

Command:

```text
ATOLL_TEST_WEB_PORT=15239 ATOLL_TEST_MOCK_PORT=18935 \
  npx playwright test tests/browser/tc0375-phase-reading-tail-downward-following.spec.js \
  --repeat-each=3 --reporter=line
```

Result: **PASS 3/3**, 18.8s. Every fresh context kept the same tail geometry
and `following` mode after the real downward wheel; the subsequent canonical
append appeared once with its marker, remained at the tail, and produced no
page error.

### Build

Command: `npm run build`

Result: **PASS** (`vite v8.0.16`, 4306 modules transformed, built in 2.96s).

## Verdict

**ACCEPT** — the current product satisfies TC0375's public user contract on
the exact migration base. No product gap was found. The final commit contains
only the browser successor and this audit; remove the temporary `node_modules`
symlink before committing.
