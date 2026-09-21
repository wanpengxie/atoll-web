# Browser A–F — TC-0293 / A-BR-08/09 public revocation and retirement

Date: 2026-09-22
Exact snapshot: `c749458b3c887aa4944a562ea81f01369c83276d`

## Atomic claim and dedupe

This packet claims exactly one previously uncredited baseline contract:

- key: **TC-0293**;
- baseline declaration: `fae8b70:tests/browser/phase-a.spec.js:70`;
- user label: **A-BR-08/09 断线、权限撤销和频道退役后界面收敛**;
- migration ledger row: `audit-output/TEST-CASE-MIGRATION-LEDGER.md:644`;
- first public owner boundary: `WorkspaceApp` / `WorkspaceLayout` navigation and the
  `useWireSession` access projection; the Composer disabled state and channel removal
  are downstream projections.

An exact-key/source search over `audit-output`, `docs`, `tests`, and git history found
no earlier TC-0293 claim or successor. TC-0291 (phase-a line 18) and TC-0292
(phase-a line 35) are separately claimed by other browser lanes. Existing public
revoke tests are not equivalent: TC-0227 covers revoke→grant freshness, while the
Composer revoke test covers queued-send rejection; neither covers this complete
disconnect→revoke→retire workspace journey.

## Preserved public contract

The successor uses only visible workspace behavior and the existing mock control
boundary for fixture actions:

1. sign in as `root`, open `c0.project`, and observe its heading and enabled Composer;
2. drop the connection, observe the public reconnecting/closed state, and wait for
   the public `OPEN` state to return;
3. revoke `c0.project` membership, observe the Composer become disabled while the
   channel remains visible in the public rail;
4. retire `c0.project`, observe the active heading return to `c0` and the retired
   channel disappear from the public rail.

No private store, diagnostic marker, source inspection, selector-only result, or
fixture shortcut is used as an acceptance gate.

## Exact browser result

Added successor: `tests/browser/tc0293-phase-a-revocation.spec.js`.

```text
ATOLL_TEST_WEB_PORT=17103 ATOLL_TEST_MOCK_PORT=26103 \
npx playwright test tests/browser/tc0293-phase-a-revocation.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **3 passed (20.5s)**, exit code 0. Expected wire close/reconnect console
warnings occurred during the explicit drop; no assertion was relaxed and no case
was skipped.

## Owner boundary

The first user-visible handoff is the Workspace navigation/access projection:
`useWireSession` records revoked/retired access and `WorkspaceLayout`/`WorkspaceApp`
chooses the surviving channel. `ChannelAccessPlaceholder`/Composer capability
projection owns the disabled revoked surface; retirement must commit the navigation
fallback and remove the retired channel from the rail. The test does not treat
internal access state or diagnostics as proof.

No product, vendor, package, fixture, or existing test was changed outside this
dedicated successor and audit packet.
