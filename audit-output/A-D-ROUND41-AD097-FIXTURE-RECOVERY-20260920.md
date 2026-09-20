# A–D Round 41 — AD-097 public-owner fixture recovery (2026-09-20)

Round 41 selects AD-097 as one remaining BLOCKED contract with an existing
public owner and a recoverable fixture mismatch. The latest clean relevant
candidate is `c777ef2`; its shell grant-fence change does not modify
`WorkspaceLayout` or the navigation owner.

## Focused verification

```text
npx vitest run tests/blocked-round18-public-owner.test.jsx \
  tests/blocked-round25-public-owner.test.jsx --reporter=dot \
  -t '\\[AD-097\\]'

Test Files  2 passed (2)
Tests       2 passed | 38 skipped (40)
```

The focused selector executes both AD-097 public-owner declarations; the 38
skips are unrelated declarations in those two files and are not used as
completion evidence. The canvas `getContext` message is existing jsdom noise.

## Case contract

| Case | User capability | Invariant | Current public owner | Baseline action / expected result | Current result / evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-097 | Before target B commits, the user can reselect committed channel A and end the stale pending handoff. | The latest presentation choice owns the pending handoff; reselecting already-committed A cancels the presentation gate without replaying A's canonical navigation side effect; the committed terminal entry becomes usable again. | `WorkspaceLayout` presentation handoff + canonical navigation port | Render committed `c0`, click `c1`, immediately click `c0`; expect only the `c1` canonical selection, no stale terminal gate, and no c0 re-navigation side effect. | **Green:** the existing public Round18 contract asserts `nav.select === ['c1']` and terminal gate enabled after the reselect (`tests/blocked-round18-public-owner.test.jsx:70-79`); the migrated Round25 fixture now asserts the same current public behavior (`tests/blocked-round25-public-owner.test.jsx:517-527`). Latest clean focused run: **2/2 passed**. | **PASS — fixture migration.** The old Round25 expectation of `['c1','c0']` was a stale side-effect oracle; no product source changed. |

## Ledger update and boundary proof

AD-097 is promoted from BLOCKED to PASS. The current A–D ledger is now
**328 PASS / 0 REGRESSION / 37 BLOCKED**. No capability is obsolete, no test
is deleted or skipped, and no expected-fail result is counted.

Round 41 changes only the current public-owner fixture
`tests/blocked-round25-public-owner.test.jsx`, this audit packet, and the
AD-097 row in `RESTORE-CASES-A-D-20260919.md`. It does not modify product
source, vendor, package or lock files, private exports, compatibility APIs, or
any cross-owner behavior.
