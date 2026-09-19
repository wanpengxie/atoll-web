# A–D unit migration verification (2026-09-20)

Scope is the top-level `tests/` A–D partition from baseline `fae8b70`: 42
suites and 365 declarations. The complete case ledger remains
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md), with one
row per baseline declaration and the current result, public owner, invariant,
and disposition. After the P0 batch and the first P1 composed-interaction
fixture batch plus the follow-up Waiting-owner regression packet, accepted case
totals are **250 PASS / 10 REGRESSION / 105 BLOCKED**.

The P0 batch recovered AD-057/058, AD-125–127, and AD-138–141 through
`useAgentProbes`, `useIdentitySession`, and the public Describe projection.
AD-316 remains an explicit blocked red reproduction: the current
`SpaceDevices` owner submits a device command but does not request an
authoritative refresh after terminal.

The first P1 composed-interaction batch now passes AD-014 and AD-017 through
the Waiting composition: the timeline edit action stays out of the Composer
until the target's matching queued+resumed fact, and an overlaid edit hold
restores the underlying interrupt pause after release/expiry. No feed runtime
or product code outside the Waiting/edit owner was changed.

The follow-up Waiting-owner packet also passes AD-018 and AD-021: compact
unhold closures no longer clear a hold without authoritative release facts, and
the held target's second core `processing` transition after matching
`queued+resumed` clears the hold without mistaking unrelated `tool.started`
business progress for queue advancement.

## Public-boundary migration completed in this pass

`tests/channel-access.test.js` and `tests/channel-name-cache.test.js` no longer
import `createSessionAccess`, `accessMode`, `rememberChannelLabels`, or
`cachedChannelLabel`. Those helpers are private implementation details of
`useWireSession.js`; the tests now drive the exported `useWireConnection` hook
with a mocked OBS/Wire boundary and inspect the `accessRef` port consumed by
`WorkspaceApp`. This keeps the user-visible access, membership, serving, label,
restart, and cache invariants without widening production API surface.

`tests/agent-activity.test.js` now fails at an explicit assertion when the
current owner drops the boot-reset channel projection; it no longer crashes on
an incidental `undefined.agents` access. That is the AD-011 product-gap
reproduction recorded in the ledger.

The two red packets have reproducible public-owner boundaries:

- AD-011: admit live processing for `c0` in generation 1, disconnect, admit a
  failed terminal from history in generation 2 with the same boot, then inspect
  `runtime.getSnapshot().agentActivity`. The expected settled Agent projection
  is absent (`byChannel.c0` is `undefined`) before the boot-change clear. The
  first current owner is `ChannelFeedRuntime`'s public activity snapshot.
- AD-143: attach profiles for `c0`, `c0.public`, `c0.agent-runtime` (actor), and
  `c0.lobby`, with active membership only for `c0`, then inspect the public
  `useWireConnection().accessRef.rows()` port. The expected visible rows are
  `c0` and `c0.public`; the current owner returns actor/lobby rows as well. No
  private helper or production branch is used by the reproduction.

## Focused verification

The focused slices were run with Vitest against current public owners:

| Slice | Result | Interpretation |
|---|---|---|
| `tests/channel-name-cache.test.js` | 8 passed | all eight cache/access cases pass through `useWireConnection().accessRef` |
| P0 public-owner fixture slices | 9 passed across Agent/Identity/Describe; AD-316 remains red | nine P0 rows now have one-to-one fixtures; the device refresh gap remains explicit |
| `tests/channel-access.test.js` | 6 passed, 1 red | AD-143 only: current public owner exposes actor/lobby rows instead of hiding them |
| `tests/agent-activity.test.js` | 4 passed, 1 red | AD-011 only: boot-reset history closure drops the settled projection |
| `tests/agent-control.test.jsx -t '\[AD-(014|017)\]'` | 2 passed | AD-014/017: public Waiting composition now gates edit admission and restores interrupt overlay state |
| `tests/agent-control.test.jsx tests/task-controls-restore.test.jsx` | 21 passed | AD-018/021 now pass through the Waiting owner; AD-020's unrelated business-progress guard remains green |
| A–D owner slices including Agent/Waiting/Composer/Artifact/Content/Workspace tests | PASS cases green; registered regression cases red | AD-022, AD-031, AD-032, AD-038, AD-041, AD-062, AD-103, AD-123 remain explicit product-gap reproductions; `it.fails` cases remain expected failures |

The red assertions are intentionally not weakened, skipped, or deleted. The
unrelated `tests/channel-replica-cache-redaction.test.js` red result belongs to
the deleted `feed-cache.test.js` successor (data-plane/F scope), not to the
42-suite A–D baseline ledger.

## Boundary proof

- Changed files are confined to `tests/` A–D unit tests, A–D audit reports, and
  the existing Waiting/edit owner `src/ui/timeline/useWaitingEditingController.jsx`.
- No Workspace, Reading, Outbox, Feed runtime, vendor, package manifest,
  lockfile, or private production export changed.
- No baseline declaration was deleted or skipped. BLOCKED rows remain explicit
  product-gap packets until a product owner supplies a current public owner.
