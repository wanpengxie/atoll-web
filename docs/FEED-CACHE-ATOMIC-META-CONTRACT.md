# FeedCache atomic Meta publication contract

## Authority

- IndexedDB `rows`, `channelMeta`, and `globalMeta` are the durable authority.
- The process-local `meta` Map is a read model of committed `channelMeta`; it is
  never transaction scratch state and never becomes newer than IndexedDB.
- `writeTail` serializes commit quanta for one cache instance. A commit quantum
  may publish its new Map value only after the enclosing Dexie transaction has
  resolved successfully.

## Commit quanta

1. A channel row append/replacement, its per-channel FIFO trim, the resulting
   `channelMeta`, and its `globalMeta.totalBytes` delta commit in one transaction.
2. A zero-fact coverage update and its `channelMeta` commit in one transaction.
3. Each global-pressure or quota-recovery trim commits deleted rows,
   `channelMeta`, and `globalMeta.totalBytes` in one transaction.
4. Owner, boot, and explicit clear transactions publish `meta.clear()` only
   after their complete durable reset commits. The process-local owner token is
   likewise assigned only after `globalMeta.owner` commits; a failed principal
   switch cannot be reused by a later boot transaction.

Each transaction builds an unpublished local Meta value. On rejection, that
value is discarded and `metaSnapshot()` continues to expose the last committed
state. A failed trim must not hide rows that IndexedDB rolled back; a failed
append or coverage update must not claim rows or coverage that never committed.

## Bounded multi-transaction writes

`writeBatch` intentionally remains a sequence of bounded transactions rather
than one unbounded transaction. A crash or failure can leave a committed prefix,
but the in-memory Map mirrors exactly that prefix. Projection coverage commits
only after its preceding fact chunks, so a partial write may cause a safe
refetch but cannot create a false cache hit. Retries are idempotent by
`[channelId+seq]`.

Quota recovery may commit one or more trims before a retry. Each trim is
independently published only after commit; if a later retry fails, both memory
and IndexedDB still describe the same successfully trimmed state.

## Required failure evidence

- Append transaction fails at `channelMeta.put`: no new in-memory Meta and no
  durable row/Meta.
- Global trim fails after row deletion but before `channelMeta.put`: both the
  deletion and Meta update roll back, and memory keeps the pre-trim snapshot.
- A zero-byte row still counts as trim progress: its committed deletion must
  publish Meta and the global limiter must continue to the next channel.
- Zero-fact coverage transaction fails: no in-memory or durable coverage claim.
- Principal switch fails at `globalMeta.put`: the old process owner remains
  authoritative and a later boot write cannot launder the failed owner draft.
- One-shot quota failure: committed recovery trim and retry converge to the
  same rows, coverage, byte counts, and Meta snapshot.

Multi-tab external mutation remains outside this owner contract; this change
does not add a second polling or cross-tab synchronization lane.
