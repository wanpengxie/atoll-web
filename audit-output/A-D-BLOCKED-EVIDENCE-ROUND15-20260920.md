# A–D blocked-evidence recovery, round 15 (2026-09-20)

This packet recovers evidence for exactly 20 rows that were `BLOCKED` in the
A–D ledger. Selection is by user capability, current public owner, baseline
action, and current result, with Activity/Operation, node update, and
terminal/channel handoff prioritized. It does not modify product code, export
private helpers, restore an old store, delete or skip a declaration, or merge
case semantics.

## Focused result

```text
npx vitest run tests/blocked-round15-activity-owner.test.js \
  tests/blocked-round15-node-update.test.jsx \
  tests/blocked-round15-terminal-owner.test.jsx --reporter=verbose

Test Files  3 passed (3)
Tests       12 passed | 11 expected fail (23)
```

At the original packet boundary the six green cases were AD-094, AD-095,
AD-100, AD-102, AD-104, and AD-107. The current public-owner rerun is **12
passed / 11 expected-fail (23 declarations)**: AD-096 (four handoff
declarations), AD-098, and AD-101 are now green through the subsequent shell
owner closures (`764627c`, `3d1c061`); AD-002–004 and AD-202–203 remain
explicit product-gap reproductions alongside the unresolved terminal rows.
Expected-fail assertions remain public-owner evidence, not an obsolete-case
decision or a hidden skip.

## Activity / Operation owner boundary

| ID | User capability | Invariant | Current public owner and action | Current result / disposition |
|---|---|---|---|---|
| AD-002 | Activity center locates one business fact spanning terminal, WorkItem, and Operation and provides a public SourceRef. | Same channel/request facts dedupe without leaking private ticket payloads. | `selectFeatureSearchIndex` receives public `states`, `channels`, `tasks`, and `operations` at `tests/blocked-round15-activity-owner.test.js:56`. | `it.fails`: no Operation row is emitted. `BLOCKED` product-gap packet; no Operation Center owner exists. |
| AD-003 | Repeated Operations dedupe by channel/native ID, retain latest unsettled state, and omit completed work. | Channel identity and native operation ID are the dedupe boundary. | `selectFeatureSearchIndex` is called with duplicate public `operations` at `tests/blocked-round15-activity-owner.test.js:72`. | `it.fails`: no Operation projection exists, so latest-state dedupe cannot be observed. `BLOCKED`; no current Operation owner. |
| AD-004 | Global search finds an in-progress Operation and returns its public artifact SourceRef. | Search consumes visible public Operation facts only. | `searchFeatureIndex` is called on the public index with `kinds: ['operation']` at `tests/blocked-round15-activity-owner.test.js:88`. | `it.fails`: the current index has no Operation row. `BLOCKED` product-gap packet; no current Operation Center owner. |

The Activity cases are not replaced by task/artifact assertions: those adjacent
owners remain present but do not satisfy the Operation capability.

## Terminal / channel-handoff owner boundary

All cases below drive the public `WorkspaceLayout` and, where a terminal
surface is required, the public `WorkspaceFeatures` composition. The fixture
uses `navigation.select`, `navigation.openTerminal`, the committed channel
identity, and the real terminal region; it does not import a private terminal
store.

| ID | User capability | Invariant | Current public owner and action | Current result / disposition |
|---|---|---|---|---|
| AD-093 | Open a recent-reading drawer from the terminal/channel edge. | Reading owns the source and return focus. | `WorkspaceLayout` is rendered at `tests/blocked-round15-terminal-owner.test.jsx:63` and queried for the public drawer entry. | `it.fails`: no Reading drawer owner/entry is mounted. `BLOCKED`; first boundary is WorkspaceLayout terminal/navigation. |
| AD-094 | Keep terminal out of main tabs, show it beside messages, and close it through the same toggle. | Terminal is a parallel surface owned by the committed Workspace channel. | Public `WorkspaceLayout` + `WorkspaceFeatures` composition at `:69` toggles the terminal and checks the real region. | PASS: message surface remains mounted, terminal region appears, and the public toggle closes it. |
| AD-095 | Ctrl+F12 invokes the terminal toggle and prevents browser default behavior. | Keyboard and pointer use the same public terminal command. | Public `WorkspaceLayout` keydown owner at `:95` dispatches a cancelable Ctrl+F12 event. | PASS: browser default is canceled and `navigation.openTerminal` is called once. |
| AD-096 | Disable the old terminal entry while a new channel selection is pending. | Terminal remains bound to the committed channel, not a pending target. | Public `WorkspaceLayout` selection path at `:104` clicks `c1` before commit and inspects the terminal entry. | `it.fails`: entry is not disabled. `BLOCKED` product-gap packet; WorkspaceLayout is the first boundary. |
| AD-097 | A fast reselect of the committed channel cancels a pending target. | Latest user selection is the only handoff authority. | Public `WorkspaceLayout` selection path at `:114` performs `c0 → c1 → c0`. | `it.fails`: both selection calls are emitted without a latest-target cancellation owner. `BLOCKED`; WorkspaceLayout is the first boundary. |
| AD-098 | A committed third-channel directory fallback supersedes the old pending target. | Directory fallback and committed Workspace identity are one handoff. | Public `WorkspaceLayout` rerender at `:123` changes the committed navigation from pending `c1` to `c2`. | PASS in the current rerun: the committed identity clears the old terminal gate; the original blocked assertion is superseded by owner `764627c` and the round-18 fixture. |
| AD-099 | An invalid target rolls back to the original channel and ends the old pending handoff. | Invalid commit cannot leave terminal pending. | Public `WorkspaceLayout` rerender at `:139` supplies an invalid channel record after selecting `c1`. | `it.fails`: public composition does not expose the invalid-target rollback/pending-end behavior. `BLOCKED`; WorkspaceLayout is the first boundary. |
| AD-100 | Close an already-open terminal from its original entry after content access is revoked. | Closing does not depend on content write permission. | Public `WorkspaceLayout` rerender at `:155` changes access to `access_denied`, then clicks `#workspace-terminal-toggle`. | PASS: the entry remains enabled and calls the public close command once. |
| AD-101 | Publish explicit message-surface visibility when a mobile terminal covers it. | Layout/accessibility consumers receive a truthful visible-surface fact. | Public `WorkspaceLayout` + `WorkspaceFeatures` composition at `:175` is rendered under mobile `matchMedia`. | PASS in the current rerun: `data-surface-visible="false"` is published and returns to `true`; owner `3d1c061`. |
| AD-102 | Keep the message surface mounted and visible during a desktop terminal split. | Terminal is parallel to Dynamic rather than replacing the message tab. | Public composition at `:183` checks the message surface and real terminal region. | PASS: both surfaces are present and the terminal region is visible. |
| AD-104 | Do not steal focus on initial render, background rerender, or supersession. | Only an explicitly committed user target may own focus. | Public `WorkspaceLayout` rerenders at `:191` with background and superseding navigation while the member control owns focus. | PASS: focus remains on the user-focused member control in every state. |
| AD-105 | A rapid A→B→A handoff leaves focus with the latest target only. | Stale pending work cannot overwrite the latest selection. | Public `WorkspaceLayout` selection path at `:206` performs the rapid sequence. | `it.fails`: no latest-target focus handoff is exposed. `BLOCKED`; WorkspaceLayout is the first boundary. |
| AD-106 | Preserve a channel's terminal split when leaving and returning. | Terminal session/layout state is isolated and retained by channel. | Public `WorkspaceLayout` rerenders at `:215` from open `c0` to `c1` and back to `c0`. | `it.fails`: returned channel has no retained split. `BLOCKED`; WorkspaceLayout is the first boundary. |
| AD-107 | Keep at most one live terminal feature for the committed channel. | Workspace consumes only the current channel's terminal port. | Public `WorkspaceLayout` + `WorkspaceFeatures` composition at `:226` queries real terminal regions after mount. | PASS: exactly one terminal region is rendered and points to the public toggle. |
| AD-108 | Closing one channel split does not close another channel split. | Terminal visibility is independent per channel. | Public `WorkspaceLayout` rerenders at `:234` across `c0`/`c1` and closes one entry. | `it.fails`: no per-channel terminal visibility owner preserves the other split. `BLOCKED`; WorkspaceLayout is the first boundary. |

## Node-update owner boundary

| ID | User capability | Invariant | Current public owner and action | Current result / disposition |
|---|---|---|---|---|
| AD-202 | Show one confirmation-gated node upgrade action only when an update is available. | `VersionIncompatible` is a protocol terminal and cannot impersonate a node-update owner. | Public `WorkspaceLayout` receives a public `navigation.update` value at `tests/blocked-round15-node-update.test.jsx:24` and is queried for the upgrade button. | `it.fails`: no upgrade button/confirmation owner exists. `BLOCKED` product-gap packet; no node-update owner is mounted in WorkspaceLayout/WorkspaceApp. |
| AD-203 | Use the same disabled action for update progress and show the current version after success. | Progress, success, and version come from one node-update owner. | Public `WorkspaceLayout` receives a succeeded `navigation.update` value at `tests/blocked-round15-node-update.test.jsx:35` and is queried for the version title. | `it.fails`: no node-update progress/version owner exists. `BLOCKED` product-gap packet; no node-update owner is mounted in WorkspaceLayout/WorkspaceApp. |

## Boundary proof and handoff

Only the three `tests/blocked-round15-*` files and A–D audit reports are in
this packet. No Feed runtime, node-update product code, terminal/navigation
product code, vendor, package manifest, lockfile, or private export changed.
The six PASS rows are public behavioral evidence. The 14 remaining rows are
quantified, reproducible owner gaps returned to the appropriate product
boundary; they are not declared obsolete or discarded.
