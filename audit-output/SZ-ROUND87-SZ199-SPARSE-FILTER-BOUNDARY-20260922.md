# S–Z round 87 — SZ-199 sparse-filter exhaustion boundary

## Atomic claim

- **Case:** `SZ-199`, the S–Z numeric row for “only derive the sparse-filter
  top boundary from current-generation authoritative exhaustion”.
- **Baseline:** `fae8b70:tests/timeline-reading-integration.test.jsx` (the
  original S19 case around line 2529).
- **Current base:** `d289d320f002b88570def91efa37bd9bcac62a43`.
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-sz199-sparse-filter`.
- **Branch:** `codex/sz199-sparse-filter`.

The central S–Z ledger still marks SZ-199 **OPEN**. Exact search found no
existing SZ-199 test/report, branch, or worktree before this claim. The nearby
SZ-190 history-demand upgrade and SZ-191 EOF/reservoir reopen are separate
contracts; neither owns sparse-filter boundary publication. This claim is
therefore unique and does not duplicate an existing Reading owner packet.

## User contract and owner

In a sparse member-filtered timeline, a visible matching row does not prove
that the physical history scan is exhausted. A transient `hasOlder: false`
with buffered physical supply must leave the top boundary absent. Only when
the current generation is attached/current, the semantic range is established,
loading is settled, `hasOlder` is false, and buffered supply is zero may the
Reading projection expose a filtered `historyBoundary` with the current
generation. No filter-specific store or second authority is needed.

The current public owner chain is:

`useConversationProjection` → `viewport.historyBoundary`.

The test drives the public projection with the existing `history.status` facts
and observes the rendered Presentation row plus the public viewport boundary;
it does not inspect `useHistoryConsumer` refs, Feed internals, private maps, or
invent a filter store.

## Public evidence

`tests/sz199-sparse-filter-boundary-public-owner.test.jsx` starts with the
current generation `4`, an installed sparse match at sequence 78, and
`hasOlder: true`. The public Presentation contains exactly `oldest-match`, but
`viewport.historyBoundary` is `null`.

The same generation then publishes `hasOlder: false` with `buffered: 25`; the
boundary remains `null`, so physical reservoir supply cannot be mistaken for
authoritative filtered EOF. Finally, the current status settles with
`buffered: 0`; the public viewport publishes exactly:

```text
{ kind: 'exhausted', filtered: true, actorFiltered: true, generation: 4 }
```

This is the old user-visible sequence migrated to the current public Reading
owner. It preserves the sparse row, the no-boundary intermediate state, and the
authoritative exhausted terminal state without changing product code.

## Verification

Focused command:

```text
npm test -- --run tests/sz199-sparse-filter-boundary-public-owner.test.jsx --reporter=verbose
```

Result:

```text
Test Files  1 passed (1)
Tests       1 passed (1)
```

The existing adjacent public Reading owner suite was not modified. Product
source, Workspace, Feed, Vendor, package, lockfile, old helper, compatibility
path, second store, and second writer are unchanged.

**Disposition: ACCEPT / PROVEN-DIRECT.** SZ-199 is now covered at the current
public Reading/Presentation boundary; the original sparse-filter boundary
contract is preserved without restoring the deleted `useReadingSession` path.
