# S–Z round 100 — SZ-211 staged arrival above reached tail

Date: 2026-09-22  
Case: `SZ-211`  
Base: `79a69d3` (`test(browser): migrate TC0324 channel creation convergence`)

## User capability

When a live arrival is already in the canonical Reading projection but the
settled DOM observation has installed only the older tail, the user must not
lose that arrival. The older tail may settle its already-installed range, but
the staged arrival remains pending until a later settled observation reaches
its sequence.

## Invariant and public owner

The public contract is the typed `reading-authority` observation consumed by
`useConversationProjection`, together with the public
`state.arrivalReceipts.timeline()` receipt. An acknowledgement through
`installedHighSeq=40` may remove only arrivals at or below 40; an arrival at
sequence 44 remains in the public receipt journal. A later settled observation
through 44 removes it. The test uses a real `createChannelReplicaStore`, real
`createViewSessionStore`, and the public hook/receipt APIs; it does not inspect
private Replica maps or add an export/store.

## Distinctness

This is not SZ-209's pre-tail navigation/visibility contract: the test starts
with a live row admitted into the current projection and proves the old
installed high-water cannot consume it. It is not SZ-210's durable future
record/high-water contract, nor SZ-214's unfiltered physical cursor above the
viewport. The unique assertion is the two-step live journal boundary: 40 keeps
`incoming@44`, then 44 clears it.

## Evidence and result

`tests/sz211-staged-arrival-tail-public-owner.test.jsx` proves:

1. the public live receipt contains `incoming@44` after the live commit;
2. the settled tail observation at installed high-water 40 catches up the
   existing tail but leaves `incoming@44` in the public receipt;
3. the next settled observation at 44 clears exactly that arrival.

Focused result: `1/1` passed. No product, vendor, package, lockfile,
compatibility, skip, or legacy API file was changed.
