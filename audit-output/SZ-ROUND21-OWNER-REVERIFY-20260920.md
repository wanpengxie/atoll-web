# S–Z round 21 owner re-verification

Date: 2026-09-20. This packet reviews twenty contracts without repeating the
already-green UI-VIS-09 or Waiting-control cases: eighteen previously unreviewed
S–Z OPEN rows (SZ-159–SZ-176) and two new public Workspace pending-selection
regression probes. The Workspace probes are extensions of AD-097/AD-105, not
new owner claims; they exercise the keyboard route that the prior rail packet
did not cover.

## Workspace pending-selection regression packet

The current public owner is `WorkspaceLayout`. Its click path now has a
same-channel cancellation branch in `selectChannel`, but the keyboard
`switchChannel` path returns when the direct target is already the committed
channel, before it reaches that cancellation branch. The exact owner boundary
is visible at [`WorkspaceLayout.jsx:157`](../src/app/WorkspaceLayout.jsx:157)
and [`WorkspaceLayout.jsx:268`](../src/app/WorkspaceLayout.jsx:268).

The new public probes are in
[`blocked-round21-workspace-pending.test.jsx`](../tests/blocked-round21-workspace-pending.test.jsx):

| Packet | User capability / invariant | Public owner and repro | Result |
|---|---|---|---|
| AD-097-K | Keyboard A→B→A before commit must cancel the old pending target; the latest selection is the only pending owner. | `WorkspaceLayout` document shortcut, [`blocked-round21-workspace-pending.test.jsx:56`](../tests/blocked-round21-workspace-pending.test.jsx:56), Ctrl+2 then Ctrl+1. | **PRODUCT RED / HANDOFF**: only `c1` reaches `navigation.select`; the keyboard path returns before shared cancellation. |
| AD-105-T | The same rapid A→B→A handoff must release the terminal transition lock; an old pending target cannot disable a current command path. | `WorkspaceLayout` terminal toggle, [`blocked-round21-workspace-pending.test.jsx:68`](../tests/blocked-round21-workspace-pending.test.jsx:68), Ctrl+2 then Ctrl+1. | **PRODUCT RED / HANDOFF**: `workspace-terminal-toggle` remains disabled while stale `c1` is pending. |

Both cases remain `it.fails` expected-fail evidence, not skips or recovered
rows. No Workspace source was changed; the owner worktree is outside this
packet's edit boundary.

## Eighteen S–Z OPEN rows reviewed

The central ledger remains `164 GREEN, 0 RED, 1 PARTIAL, 142 OPEN, 20 GAP,
3 BLOCKED`. No row below is closed by an adjacent unit port. The current
Feed/Reading/Presentation owners prove useful local fences, but none is a
one-to-one public successor for the original integration contract; therefore
each row remains OPEN rather than being called obsolete.

| Case | User capability / invariant | Current public owner check | Disposition |
|---|---|---|---|
| SZ-159 | Aborted render cannot lend candidate history status to a committed request promise. | `history-presentation-admission` and `useHistoryConsumer` carry owner tokens, but no current public composition case proves the promise cannot receive an aborted candidate. | **OPEN**; retain at the Reading/Admission boundary. |
| SZ-160 | Late history completion cannot cache exhaustion for a newer committed generation. | `channel-feed-runtime` fences generation on history completion, but no one-to-one public case covers late exhaustion caching after a replacement. | **OPEN**; retain. |
| SZ-161 | An old-generation failure cannot block current-generation anticipatory recovery. | Current Feed generation and background-interest ownership are visible, but the exact failure/recovery sequence has no current public owner test. | **OPEN**; retain. |
| SZ-162 | Aborted render cannot redirect committed arrival disposition to its candidate port. | `live-arrivals` and Feed expose receipt ports, but no direct Surface case proves aborted render cannot redirect the disposition. | **OPEN**; retain. |
| SZ-163 | While hidden, the Surface must not claim read; visibility loss invalidates old tail evidence. | `ConversationSurface` publishes `surfaceVisible` and Feed accepts exact observations, but no one-to-one hidden/return composition case proves the full read invariant. | **OPEN**; retain. |
| SZ-164 | Without explicit Surface visibility or with old DOM high-water, new seq must not be marked read. | Current `VendorListExecutor`/Feed ports carry visibility and high-water facts, but no direct public case proves both negative gates together. | **OPEN**; retain. |
| SZ-165 | Arrivals while hidden remain unread; returning foreground must not reuse stale DOM evidence to clear them. | Feed notification/read owners retain generation and observation authority, but no current public Surface case proves the hidden-return sequence. | **OPEN**; retain. |
| SZ-166 | A passive same-row arrival joins already-committed visible-tail evidence. | `channel-feed-runtime` exposes following/arrival receipts, while no current public integration test proves the same-row join. | **OPEN**; retain. |
| SZ-167 | No transient unseen count is published before the matching visible row revision commits. | Feed computes unread from committed Replica facts, but no direct public test couples the row revision and the transient-count boundary. | **OPEN**; retain. |
| SZ-168 | An undisposed arrival transfers to the successor activation before Replica acknowledgement. | `live-arrivals` has explicit consumer receipts and activation fences, but the successor handoff order is not proven through the current Surface owner. | **OPEN**; retain. |
| SZ-169 | A committed arrival is published only after observation proves its exact row was not visible. | Current Feed observation admission checks exact authority fields, but no one-to-one public case proves the not-visible prerequisite. | **OPEN**; retain. |
| SZ-170 | A staged arrival is dropped when a later filter commit removes every row identity. | `ConversationPresentation` handles filter projection, but no current arrival/Reading owner proves staged-disposition cancellation after an empty filter commit. | **OPEN**; retain. |
| SZ-171 | An orphan terminal rekey keeps the stable root identity. | `ChannelReplica` and Presentation expose stable row IDs, but no current public integration case proves this orphan-terminal rekey path. | **OPEN**; retain. |
| SZ-172 | While browsing, only the exact visible arrival identity is acknowledged. | ReadingSession and Feed expose exact observation/receipt tuples, but no current public browsing case proves selective identity acknowledgement. | **OPEN**; retain. |
| SZ-173 | Durable acceptance resolves after user-up without minting a fresh bottom intent. | `reading-session` separates input intent from DOM commands, but no current Surface owner proves the durable acceptance/user-up sequence. | **OPEN**; retain. |
| SZ-174 | Only the exact failed Composer intent is revoked; a newer latest intent cannot be revoked. | Composer correlation ports are current, but the Reading integration contract has no direct public case for this exact failed-intent race. | **OPEN**; retain without duplicating Composer ownership. |
| SZ-175 | Unseen remains until an explicit latest intent is acknowledged by the installed visible tail. | Feed high-water and notification cursors are current, but no one-to-one public case proves the installed-tail acknowledgement boundary. | **OPEN**; retain. |
| SZ-176 | Legacy key-only unseen state is not admitted to the active controller. | Current `view-session`/Feed storage boundaries reject unsupported shapes, but no current public integration case proves admission into the active controller is blocked. | **OPEN**; retain pending owner-level proof. |

## Adjacent product regression signal

The current reading owner also has a real direct-suite red outside the new
Workspace packet. `tests/reading-observation-settle.test.jsx` reports four
failures against the committed `VendorListExecutor` behavior:

- the user-settled tail observation loses the expected `bookmark.blockID`;
- pointer selection and input-free layout observations arrive as `source:
  layout, settled:false` instead of the user/settled contracts;
- after an input-epoch advance, the observation remains `source:user` rather
  than the expected settled fallback.

This is a product regression handoff only. It is not reclassified as a closed
S–Z row, and no dirty Reading/Vendor owner was modified here.

## Verification

The selected current-owner run passed all non-regression files:

```text
npx vitest run \
  tests/reading-session-ports.test.js \
  tests/history-presentation-admission.test.js \
  tests/history-demand.test.js \
  tests/live-presentation-arrivals.test.js \
  tests/notification-state-contract.test.js \
  tests/blocked-round21-workspace-pending.test.jsx --reporter=dot

6 files passed; 43 passed, 2 expected fail.
```

The focused reading-observation command is retained as an explicit red
reproduction (`1 file, 4 failed`); it is not hidden behind a skip or expected
failure. This round changes only the new public regression test and this audit
report. No Workspace/Reading/Vendor product source, Outbox, package/lockfile,
private export, compatibility layer, or old test was deleted.
