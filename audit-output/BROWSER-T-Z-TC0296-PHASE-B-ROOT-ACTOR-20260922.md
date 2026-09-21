# Browser T–Z — TC-0296 / B-BR-01 root, lobby, and actor visibility

Date: 2026-09-22
Claim base: `72113de2c210057ac4c68976c4c28e8a78216739`

## Atomic claim and CAS precheck

This packet atomically claims the next uncredited public Browser T–Z baseline:

- numeric key: **TC-0296**;
- fae8b70 declaration: `tests/browser/phase-b.spec.js:61`;
- user label: `B-BR-01 c0 根频道、内部 lobby 与标准 Actor 分别处理`;
- migration-ledger row: `audit-output/TEST-CASE-MIGRATION-LEDGER.md:647`;
- current public owner boundary: `WorkspaceApp` / `WorkspaceLayout` channel rail and the existing public roster projection.

The exact key/source search covered the current refs and every registered detached worktree before this claim. No TC-0296/B-BR-01 successor or dedicated audit claim was found. Neighboring claims were excluded from this CAS: TC-0291 (`35a69e4`, root/lobby reload), TC-0292 (`44f8122`, project-channel isolation/approval), TC-0293 (`a90213d`, revoke/retire convergence), and TC-0294 (`d7da123`, first-login owner root). Their user contracts do not replace this single B-BR-01 assertion set combining the visible root/project/public rail with standard-actor filtering.

The old `tests/browser/phase-b.spec.js` path is absent from the current executable tree; the legacy source is retained only as the fae declaration. No source, vendor, package, fixture, existing spec, skip, or private diagnostic was changed or staged by this claim.

## Preserved public contract

The future successor must use the current public Workspace surface and preserve all original result gates:

1. Reset the `multi-channel` fixture and sign in as `root` through the visible Auth form.
2. In the public channel rail, show the owner root `c0`, `c0.project`, and `c0.public`.
3. Keep the internal `lobby` absent from the user-visible surface.
4. In the public roster panel, hide the system actors `system`, `registrar`, and `svcactor` while retaining standard actor visibility according to the current fixture.

Evidence must be public DOM and the existing public mock control boundary only. IDB/cache/source ordering, private diagnostics, selector-only inference, or a fabricated compatibility route cannot satisfy this contract. No assertion may be removed or weakened to avoid overlap with the separately owned phase-A contracts.

## Successor and exact evidence

Successor: `tests/browser/tc0296-phase-b-root-actor.spec.js`.

The successor keeps the original reset/login/rail/lobby/actor result gates and
uses the current public `成员` button and `频道成员` complementary panel. It
also asserts one ordinary fixture actor (`steward`) is visible, so the hidden
system-actor checks cannot pass vacuously against an empty roster.

Focused Chromium run on this exact detached worktree:

```text
ATOLL_TEST_WEB_PORT=17297 ATOLL_TEST_MOCK_PORT=26297 \
playwright test tests/browser/tc0296-phase-b-root-actor.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
# 3 passed (13.7s)
```

The production build on the same worktree passed (`4306 modules transformed`,
Vite build complete; existing chunk-size advisory only). No page-error or
assertion failure occurred in the focused run.

## Status

**PASS — successor and public browser evidence are complete.** This detached
commit changes only the dedicated browser spec and this audit packet; root
integration remains the caller's decision.
