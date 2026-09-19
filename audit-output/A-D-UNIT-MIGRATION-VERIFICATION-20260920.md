# A–D unit migration verification (2026-09-20)

Scope is the top-level `tests/` A–D partition from baseline `fae8b70`: 42
suites and 365 declarations. The complete case ledger remains
[`RESTORE-CASES-A-D-20260919.md`](./RESTORE-CASES-A-D-20260919.md), with one
row per baseline declaration and the current result, public owner, invariant,
and disposition. Its accepted case totals remain **237 PASS / 12 REGRESSION /
116 BLOCKED**.

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
| `tests/channel-access.test.js` | 6 passed, 1 red | AD-143 only: current public owner exposes actor/lobby rows instead of hiding them |
| `tests/agent-activity.test.js` | 4 passed, 1 red | AD-011 only: boot-reset history closure drops the settled projection |
| A–D owner slices including Agent/Waiting/Composer/Artifact/Content/Workspace tests | PASS cases green; registered regression cases red | AD-018, AD-021, AD-022, AD-031, AD-032, AD-038, AD-041, AD-062, AD-103, AD-123 remain explicit product-gap reproductions; `it.fails` cases remain expected failures |

The red assertions are intentionally not weakened, skipped, or deleted. The
unrelated `tests/channel-replica-cache-redaction.test.js` red result belongs to
the deleted `feed-cache.test.js` successor (data-plane/F scope), not to the
42-suite A–D baseline ledger.

## Boundary proof

- Changed files are confined to `tests/` A–D unit tests and this A–D audit
  report (plus the existing case ledger owner/evidence wording).
- No `src/`, `vendor/`, package manifest, lockfile, or private production export
  changed.
- No baseline declaration was deleted or skipped. BLOCKED rows remain explicit
  product-gap packets until a product owner supplies a current public owner.
