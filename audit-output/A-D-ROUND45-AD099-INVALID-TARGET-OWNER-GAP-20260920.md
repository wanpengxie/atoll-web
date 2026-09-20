# A–D Round 45 — AD-099 invalid-target rollback owner gap (2026-09-20)

Round 45 also rechecks the next Workspace handoff case without adding another
red declaration. AD-099 is a separate capability from AD-093: it protects
rollback after a directory rejects the selected target. The current public
owner still exposes no rollback/fallback fact, so the case remains BLOCKED.

## Case contract

| Case | User capability | Invariant | Current public owner | Baseline setup/action/observable result | Current result/evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-099 | If the user selects a target that the directory rejects, return to the original committed channel and end the old pending handoff. | The committed channel identity is authoritative; an invalid target cannot remain selected or retain the terminal transition gate. | `WorkspaceLayout` selection handoff plus the public navigation/ directory commit boundary. No public rollback/fallback result port is currently supplied. | Render committed `c0`; click `c1`; rerender with `activeChannelId='c1'` but `channel=null` to represent directory rejection; expect the original committed `c0` heading and a settled terminal handoff. | **Red:** current render exposes heading `选择频道`, not `c0`; the invalid target remains the visible navigation identity. Focused latest-head run (`d1ae978`): **1 failed, 19 focused-out skips**, failure at `tests/blocked-round25-public-owner.test.jsx:557`. Existing Round18/19 `it.fails` declarations are evidence only and are not counted. | **BLOCKED — product gap.** Shell/navigation owner must expose an explicit rejected-target rollback/fallback fact; the test worker does not synthesize one or change product code. |

## Minimal reproduction

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-099\\]'

Test Files  1 failed (1)
Tests       1 failed | 19 skipped (20)
Failure    Unable to find an accessible heading named "c0"
            tests/blocked-round25-public-owner.test.jsx:557
```

The current ordinary test uses only the public `WorkspaceLayout` navigation
object and a missing committed channel to model the rejection; it does not
import a private rollback helper or mock a successful fallback. The failure is
therefore a reproducible first-boundary gap, not a stale selector migration.

AD-099 remains BLOCKED and independent of AD-093's Reading-entry contract. The
A–D ledger remains **329 PASS / 0 REGRESSION / 36 BLOCKED**. No test was
deleted, skipped, or converted to expected-fail; no product source, private
export, compatibility API, vendor, package, or lockfile changed.
