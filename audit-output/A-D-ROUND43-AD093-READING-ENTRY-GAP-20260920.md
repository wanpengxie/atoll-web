# A–D Round 43 — AD-093 public Reading-entry gap (2026-09-20)

Round 43 selects AD-093 as the next unresolved case. The current public
composition still has no user-visible recent-reading entry at the Workspace
right edge. This packet records the gap at the first public boundary; it does
not add a duplicate red declaration and does not modify product code.

## Case contract

| Case | User capability | Invariant | Current public owner / entry point | Baseline setup/action/observable result | Current result/evidence | Disposition |
|---|---|---|---|---|---|---|
| AD-093 | From the channel/terminal edge, the user can open the recent-reading drawer. | The Reading owner supplies a visible entry and can return focus to the originating surface after the drawer closes. | `WorkspaceLayout` shell composition is the first public boundary; the mounted conversation Reading owner is `ConversationSurface` → `ReadingContainerHandoff`. No public Workspace edge/drawer entry is currently mounted. | Render the public `WorkspaceLayout` with a committed channel, navigation port, conversation surface, and terminal features; query for the accessible button `打开最近阅读`. The baseline contract expects that button to be present at the right edge. | **Product gap:** the public query returns `null` (`tests/blocked-round25-public-owner.test.jsx:511-515`). Focused latest-head run on `0ba7fa7`: **1 failed, 19 focused-out skips**. The same user-visible assertion was already preserved as an explicit owner-gap reproduction in `tests/blocked-round15-terminal-owner.test.jsx:68-72`; the current Reading session/viewport owners do not provide the missing Workspace edge entry. | **BLOCKED — product owner decision/implementation required.** Keep the capability and focus-return invariant; do not relabel obsolete, add a private export, or weaken the visible-entry assertion. |

## Minimal reproduction

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-093\\]'

Test Files  1 failed (1)
Tests       1 failed | 19 skipped (20)
Failure    expected null to be truthy
            tests/blocked-round25-public-owner.test.jsx:514
```

The failure is not a stale selector or mock-only result: it queries the public
accessible button named by the baseline capability, and the current shell
composition renders no such edge entry. The existing Reading owner remains
available inside the conversation surface, but that does not expose the
requested drawer control or its focus-return path from the Workspace edge.

## Handoff

- Baseline behavior: a right-edge recent-reading button is discoverable from
  the channel/terminal shell.
- Current behavior: the first public `WorkspaceLayout` boundary exposes no
  recent-reading button, so the user cannot begin this flow.
- First divergence: `WorkspaceLayout` shell/Reading-entry composition, before
  any Reading drawer action or focus-return event can be observed.
- Affected capability/invariant: recent-reading access plus Reading-owned
  return focus; neither is declared obsolete.
- Evidence: ordinary public-owner reproduction above and the preserved
  Round15 owner-gap reproduction. Product implementation is left to the
  explicitly assigned Reading/Workspace owner.

The A–D ledger remains **329 PASS / 0 REGRESSION / 36 BLOCKED**. No expected
fail is counted, no test is deleted or skipped, and no product/private API,
vendor, package, or lockfile changed.
