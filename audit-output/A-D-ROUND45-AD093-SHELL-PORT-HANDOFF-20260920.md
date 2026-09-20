# A–D Round 45 — AD-093 minimal Shell port handoff (2026-09-20)

Round 45 turns the retained AD-093 capability definition into the smallest
current public Shell contract. This is a test/audit handoff only; the Shell
owner must decide and implement the product port. No old `panel` store or
private helper is restored.

## Minimal public contract

| Boundary | Contract | Observable invariant |
|---|---|---|
| `WorkspaceLayout` entry | When a readable committed channel is present and the public port `navigation.openReadingHistory` is supplied, render one accessible button named `打开最近阅读` (visible label `最近`). | The edge control is a user entry, not an implementation fingerprint; it is absent when there is no readable committed channel. |
| Shell action port | Clicking that button calls `navigation.openReadingHistory()` exactly once. The callback is the only Shell→Workspace handoff; it must not be inferred from DOM state or call a private panel store. | One click produces one typed public action with the current committed channel context owned by `WorkspaceApp`. |
| Context route | `WorkspaceApp` consumes the action and selects the existing right-panel owner; `WorkspaceRightPanel` must eventually route the Reading context using the current typed files/recent port. | The route is distinct from terminal/files/task/activity; no mirrored Reading state is created in `WorkspaceLayout`. |
| Close/focus | The existing `WorkspaceFeatures.ContextHost`/`SidePanel` lifecycle owns close, backdrop/Escape, and opener-focus restoration once a Reading context is mounted. | Closing returns focus to the edge opener; the test does not require a second focus store. |

The proposed name `openReadingHistory` follows existing public navigation
commands (`openActivity`, `openSearch`, `openSpaceAdministration`) and is a
new contract for the assigned Shell owner, not a production API added by this
test worker. The historical action it replaces is precisely
`panel.open('reading-history')` from `d450400:src/app/AppShell.jsx:472`.

## Case record and evidence

| Case | User capability | Invariant | Public owner | Baseline action/result | Current result/disposition |
|---|---|---|---|---|---|
| AD-093 | Open recent reading from the channel/terminal edge and then close it back to the same opener. | Shell entry, Reading route, recent-file source, and focus lifecycle have one owner chain. | Entry: `WorkspaceLayout`; command source/route: `WorkspaceApp`; context dispatcher: `WorkspaceRightPanel`; focus wrapper: existing `ContextHost`. | Render committed readable `c0`; find `打开最近阅读`; click it; expect exactly one `navigation.openReadingHistory()` call and, after route implementation, a `最近阅读` context with opener-focus return. | **Red at first boundary:** no accessible opener exists, so the port assertion is not reached. Focused latest-head run (`d1ae978`): **1 failed, 19 focused-out skips**; failure `expected null to be truthy` at `tests/blocked-round25-public-owner.test.jsx:523`. The migrated test now carries the port contract without weakening the required entry assertion. **BLOCKED — Shell owner handoff.** |

## Verification

```text
npx vitest run tests/blocked-round25-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-093\\]'

Test Files  1 failed (1)
Tests       1 failed | 19 skipped (20)
Failure    expected null to be truthy
            tests/blocked-round25-public-owner.test.jsx:523
```

The current public test only supplies a `vi.fn()` port as a contract fixture;
it does not export or import private production state. Because the opener is
missing, no expected-fail shortcut is used and no route/focus assertion is
pretended green. The complete historical owner mapping remains in
`A-D-ROUND44-AD093-OWNER-DEFINITION-20260920.md`.

## Shell handoff

- Add the entry at the current `WorkspaceLayout` public navigation boundary,
  gated by the committed readable channel.
- Wire the action to the current `WorkspaceApp` panel/feature composition and
  an explicit `WorkspaceRightPanel` Reading branch using the existing recent
  files/preview port; do not restore `panel.open` or a second store.
- Preserve the existing ContextHost focus/Escape/backdrop semantics when the
  panel is mounted.
- Re-run the current AD-093 public contract before changing its disposition.

AD-093 remains **BLOCKED** pending that owner. The A–D ledger remains **329
PASS / 0 REGRESSION / 36 BLOCKED**. No test was deleted or skipped, and no
product source, private export, compatibility API, vendor, package, or
lockfile changed.
