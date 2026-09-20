# E–H Round 49 — Feed v2 failure matrix and test plan

Date: 2026-09-20  
Scope: read-only plan for the next Feed candidate. No source or test product
change was made in this round.

This plan is an attack contract, not an implementation prescription. It keeps
the existing Feed, Replica/cache, bounded executor, and Reading Admission
owners. It must be run against the next exact candidate before any green claim
is accepted.

## Ownership model under test

| Concern | Existing public owner | What the test may observe |
|---|---|---|
| Physical source operation | ChannelFeedRuntime plus HistorySourceAdapters and the bounded executor | wire.historyBefore arguments, wire.pageEnd/late-page return, one history.batch_complete per physical page, current Replica rows |
| Durable cache | ChannelReplicaCache | cache owner/world reads, physical row count, owner-change rejection; no second cache or direct Replica write |
| Semantic demand | ChannelFeedRuntime's caller/demand lease boundary | each loadHistory promise, onOperation lease release/promote, historyFor loading/urgency/phase |
| Presentation reveal | existing history-presentation-admission owner consumed by Reading | historyFor presentationAdmissionState token/phase/committed value, public projection |
| Reading interaction | useHistoryConsumer and ConversationPresentation | user action diagnostics and waiter projection, never a raw batch or cache owner |
| Authority | Feed principal epoch, world epoch, generation, attach epoch | old pageEnd/enqueue rejection, stale waiter outcome, no old cache rows under replacement owner |

The raw operation may carry physical identity and normalized scheduler facts
needed by the existing executor (channel, cursor/range, limit/bytes, source,
authority fence, and priority). It must not carry caller presentation semantics:
viewSpec, actor filter, local echoes, reveal token, baseline IDs, first visible
row, or a caller-specific result kind. Those belong to the semantic lease.

## Required v2 layers

### 1. Pure raw batch, no caller semantics

Two callers request the same admitted range with different view specs and
different reveal tokens. The Feed must issue one physical request and install
one raw canonical page. Each caller receives its own projection from the same
Replica rows, and each caller's immutable lease retains its own view/reveal
inputs.

The wire and batch-completion evidence must be identical with respect to the
physical range and must not contain the other caller's filter or reveal state.
A caller abort must not mutate the raw rows or the other caller's projection.

This is stronger than checking that the promises are not the same: a promise
split can still leave one caller's semantic state inside the physical owner.

### 2. Two-range active aggregate

The same channel may have two admitted physical ranges in flight. A channel
status is an aggregate of active semantic demand leases, not the latest
operation's revision:

* any active lease keeps loading true;
* foreground is true if any active lease is foreground;
* background is true only when active work exists and no foreground lease is
  active;
* completing or failing one range cannot clear a still-active range;
* the aggregate becomes idle only after the last active lease releases or
  settles;
* a per-range error is returned to its waiter; it must not hide an unrelated
  active range, and an all-failed terminal may expose the aggregate error.

Exact ranges must not join merely because they share a channel. Exact physical
identity still joins one source operation; different cursors remain separate
operations whose leases contribute to the same channel aggregate.

### 3. Semantic demand lease

Every caller receives a lease even when the raw operation is shared. The lease
owns:

* immutable semantic inputs and the Admission token, if any;
* one idempotent release/abort path;
* one waiter settlement;
* promotion request for that caller's urgency;
* cleanup of its own Admission state.

The first caller aborting releases only its lease. The second caller remains
attached to the physical operation. The last lease aborting retires the raw
operation, cancels the remote page once, rejects late input, and leaves the
aggregate idle. A settled waiter must be removed before a late abort can touch
the operation.

### 4. Admission authority

Admission has two intentionally different cases:

* **Same authority join:** duplicate callers with the same existing
  operation/activation/view/epoch authority may join one Admission transaction.
  They must not create two conflicting pending-baseline commits or let the
  second duplicate settle the first twice.
* **Different authority replace:** a new activation/view/input epoch replaces
  the old Admission transaction. The old waiter/result may not settle, reset,
  or commit the new transaction. If the physical authority is also replaced
  (principal/world/generation/attach), the old raw page is stale and must be
  rejected before Replica/cache publication.

A raw physical join across different semantic authorities is allowed only when
the existing Feed contract can preserve the new Admission owner and explicitly
retire the old semantic lease. Otherwise the callers must remain separate at
the existing owner boundary; a compatibility owner may not be invented.

## Failure matrix

| Attack | Setup and exact action | Required public observable | Failure signature |
|---|---|---|---|
| Raw contamination | A and B same channel/cursor/limit; A viewSpec all + reveal A, B viewSpec mine + reveal B. Hold one page. | One historyBefore with same physical detail; two lease callbacks; two projections; no wire/batch detail contains filters/reveal. | More than one source request, one projection applied to both waiters, or raw completion carrying caller fields. |
| Raw late page | Abort A, keep B; deliver the original page and then a duplicate/late pageEnd. | A cancelled only; B settles once; one canonical completion; duplicate pageEnd false. | A abort cancels B, duplicate completion, or late rows mutate raw result. |
| Range aggregate settle order | Start A beforeSeq 3 and B beforeSeq 5 on c0; hold A, complete B first. | After B, historyFor(c0) remains loading/pending for A; after A, idle. | B clears loading while A is in flight. This is the d4c5eb0 red at clearPhysicalDemand. |
| Range aggregate error | Start A and B; fail B page; keep A pending, then complete A. | B waiter gets failed; aggregate stays active/pending for A; only all-terminal state may expose error/idle. | B's error globally clears A, or A result is hidden by B's error. |
| Mixed priority aggregate | Start A background and B foreground, then settle B first; keep A. | Foreground remains true while B is active; after B settles, background remains true for A. | Status becomes idle or background false while A remains active. |
| First semantic abort | Same raw operation, A aborts, B remains. | A cancelled; B's lease and raw request continue; no remote cancel. | Shared operation cancelled or B's demand cleared. |
| Second semantic abort | Same setup with B aborting first. | A continues and settles normally; B cannot release A's Admission token. | Abort callback uses operation-global token or clears A status. |
| Last semantic abort | One waiter aborts while page is held. | One remote cancel, idle aggregate, no late Replica row/completion. | Multiple remote cancels, stuck pending, or late commit. |
| Same-authority Admission join | A and B use the same operationID, activationID, viewID, epoch, and authority; same physical range, different projection only if the existing contract permits it. | One Admission token/authority, one valid settle path, pending-baseline-commit remains until the normal presentation acknowledgement. | Second begin resets the first; duplicate settle resets/loses the commit. |
| Different semantic authority replace | A starts with token A; B starts with a new activation/view/input epoch before A materializes. Deliver the shared raw result. | B is the only current Admission token; A result is cancelled/stale or otherwise side-effect free; B remains pending/settles normally. | A's stale observe/settle resets B, or both promises report success while Admission is idle. |
| Different physical authority replace | Start A, then change principal, world, generation, or attach epoch before pageEnd; start B under the replacement and deliver A late. | A pageEnd/enqueue false; no A rows/cache save/completion; B gets a new physical identity and current Admission. | Old rows land, old completion publishes, or old cache save is readable by B. |
| Queued promotion | Occupy executor slots, start c0 background, then join same range with foreground. | Eventually emitted historyBefore has foreground/interactive priority; queue order and wire detail both change. | Only executor order changes while adapter sends background/anticipatory. This is the d4c5eb0 red. |
| Cache-save fence | Complete a network page, delay its fire-and-forget save, replace owner, then let the transaction finish. | Replacement owner reads no old rows; old owner may reject/retain only its own keyed rows; no current cache metadata from old authority. | Old rows appear under new owner, or current Meta advertises stale rows. |
| Cache prefix + network error | Seed partial cache, let cache page install, fail the network continuation. | Prefix remains visible; waiter gets failed; hasOlder remains true; onError once; retry remains possible. | Prefix is reported as EOF/satisfied, status silently idle, or network partial rows are committed as success. |
| No-progress terminal | Return hasOlder true with zero accepted rows or unchanged next cursor. | One bounded terminal, no repeated same cursor; no false EOF. | Retry loop, duplicate completion, or local EOF claim. |

## Test sequence and evidence rules

1. Start with the pure raw contamination case. Record request count, exact
   physical request fields, waiter lease identities, projections, and one
   completion reference.
2. Run the semantic abort trio on the same fixture. Assert status after each
   release before delivering the page, then assert late input after last abort.
3. Run the two-range aggregate in settle, fail, and mixed-priority orders.
   Never use a single range with two callers as a substitute for two active
   physical operations.
4. Run same-authority Admission join and different-authority replacement
   separately. Capture presentationAdmissionState before page, after raw
   completion, and after the normal presentation acknowledgement. A promise
   resolving is not enough evidence.
5. Repeat replacement tests for principal, world, generation, and attach. Each
   must use a new physical ref and must prove the old ref is rejected.
6. Run queued promotion with two executor blockers. Assert both scheduler
   ordering and the actual wire detail passed to historyBefore.
7. Run the cache-save fence and cache-prefix error separately. The cache
   owner test must inspect the durable owner key/Meta, not only the in-memory
   Replica.

Public-only evidence is preferred: snapshot.historyFor, snapshot.stateFor,
snapshot.presentationAdmissionState, onOperation leases, wire history
callbacks, diagnostics, and durable cache reads through the existing public
cache owner. No private export, test-only control owner, synthetic local echo,
or old API may be introduced.

## Current d4c5eb0 witness carried forward

The previous audit [E-H-R48-D4C5EB0-PHYSICAL-OPERATION-AUDIT.md](./E-H-R48-D4C5EB0-PHYSICAL-OPERATION-AUDIT.md)
already established:

* ordinary same-range different-viewSpec projections and first/second/last
  abort behavior passed;
* principal/world/attach late pages and cache owner isolation passed;
* cache-prefix plus network error passed;
* different-range status clearing, queued promotion wire detail, and two
  different reveal tokens failed.

The next candidate must be attacked with the matrix above even if the
implementation claims those three fixes. No test count may substitute for the
raw/lease/Admission semantics.

## Acceptance gate

Do not mark Feed v2 ACCEPT until every row in the matrix is independently
green, the same-authority and different-authority Admission traces are
distinguishable, and the two-range aggregate has no interval in which an
active operation is invisible to public demand status. A green exact-once
physical join alone is insufficient.
