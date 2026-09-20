# A–D Round 42 — AD-105 public-owner fixture recovery (2026-09-20)

Round 42 selects AD-105 as one remaining BLOCKED case with an existing public
owner and a fixture mismatch. The current product boundary is the public
`WorkspaceLayout` handoff/navigation composition. No product source was
changed.

## Case contract

| Case | User capability | Invariant | Current public owner | Baseline setup/action/observable result | Current result/evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-105 | During a rapid A→B→A channel choice, the user does not lose the latest presentation choice to an older pending handoff. | The committed channel owns the terminal/focus handoff; a superseded pending target cannot replay navigation or retain a stale terminal gate. | `WorkspaceLayout` presentation handoff and injected canonical navigation port | Render committed `c0`; click `c1`; immediately click the already-committed `c0`; the former Round25 fixture expected canonical calls `['c1', 'c0']`. | **Green:** the current public owner records only `['c1']` because reselecting committed `c0` cancels the presentation gate without replaying c0's canonical navigation effect; the public terminal entry is enabled (`disabled === false`). The existing Round18 public-owner contract passes the same behavior (`tests/blocked-round18-public-owner.test.jsx:124-133`), and the migrated Round25 declaration passes it (`tests/blocked-round25-public-owner.test.jsx:546-557`). Focused run: `2 files passed; 2 passed; 38 skipped (40)` for the two AD-105 declarations. | **PASS — fixture migration.** The prior `['c1', 'c0']` assertion was a stale side-effect oracle, not evidence that the user-visible handoff capability was absent. |

## Verification

```text
npx vitest run tests/blocked-round18-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx --reporter=dot \
  -t '\\[AD-105\\]'

Test Files  2 passed (2)
Tests       2 passed | 38 skipped (40)
```

The skipped declarations are unrelated focused-out cases and are not counted
as completion evidence. The existing jsdom canvas `getContext()` message is
environment noise. No declaration was deleted, skipped, or converted to
`it.fails`; no private export, compatibility API, product source, vendor,
package, or lockfile changed.

AD-105 moves from BLOCKED to PASS. The A–D ledger is now **329 PASS / 0
REGRESSION / 36 BLOCKED**. The remaining BLOCKED rows retain their explicit
case-level evidence and are not declared obsolete.
