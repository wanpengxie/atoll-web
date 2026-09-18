# W5 View-backed task evidence: bounded projection contract

Updated: 2026-09-17. This is an implementation hand-off, not a replacement for the product specification or execution ledger.

## Owner and data flow

There is one history owner: `HistoryScheduler`. Task evidence never submits a
request, owns a cursor, starts a timer, reads storage, or retries. After the
Scheduler has validated the source cursor/generation, it synchronously emits a
semantic page before reservoir/reveal handling. A feed-owned
`createTaskEvidenceProjection()` consumes those pages and accepted live rows.

The attach generation freezes `discoveryHead`. Physical head growth only
advances `freshThrough`; it does not open another discovery round. Old
generation pages and same-generation events carrying a different discovery
head are rejected before changing active/scope/freshness state. A new
generation page arriving before React activation clears the old attach and
roster authority and remains unavailable until the matching activation.

The React hook only installs `(principal, channel, generation, roster scope)`
and subscribes to frozen snapshots. It does not rescan Replica. The former
`_rowOrder.length` cursor was removed because trim followed by append can keep
the same length and skip newly appended facts.

## What is retained

The projection does not retain raw request/terminal envelopes:

- Small request bodies are copied into a core request envelope. Large bodies
  become a bounded text preview plus bounded attachment summaries and expose
  `contentComplete=false`.
- A queued/processing response retains only status, bounded actor-authored
  controls, and the small work/control fields used by the waiting UI.
- A terminal retains only `(seq, status, sender id)`. Its body is never kept.
- A live terminal whose request is not materialized is not discarded. It keeps
  that same minimal tombstone until the older request page arrives. Terminal
  classification imports the protocol `FINAL` set, so caller cancellation
  (`failed` with cancelled metadata) and ordinary failure follow Fold's status
  semantics rather than a second task-specific terminal vocabulary.
- Once request and terminal are both inside verified continuous coverage, the
  whole closed record is deleted. Replica remains the preferred source of the
  complete turn when it is materialized; `projectTaskEvidence` already resolves
  `state.turns.get(requestID)` before using the bounded detached turn.

The production bridge must not enable edit/download actions on a detached item
whose `contentComplete` is false. It must show a clear “preview only; open the
conversation to load full content” state and use the existing Scheduler/reveal
path to materialize it. No second fetch or pagination owner is permitted.

## Bounded overflow without generation-wide blindness

Defaults are 1,024 records and 4 MiB of retained evidence. Enforcement order:

1. Delete safely closed records whose complete request-to-terminal interval is
   verified.
2. If response-before-request tombstones alone exceed the bound, stop accepting
   only older historical evidence and discard those unmatched partials. This is
   necessary because selectively dropping a terminal could let an older queued
   frame revive it. Accepted live requests remain usable.
3. If true open records exceed the bound, retain the newest bounded subset,
   prefer live over historical records, and increment `omittedEvidence`.

An explicitly evicted request ID is recorded in a separate bounded tombstone
ring (1,024 IDs / 256 KiB). Responses for those IDs cannot recreate the task.
This is distinct from an unseen parent: unseen live responses remain minimal
partial records so a later history request can close or activate them. Ring
entries can be forgotten only after their request seq is already in verified
coverage; a replay of that request is then rejected by coverage, and a live
duplicate never passes Replica acceptance.

Overflow therefore sets `discovery.overflow=true`, keeps
`discovery.complete=false`, and publishes the retained/current items. It does
not turn the whole generation unavailable. The waiting UI must visibly render
the partial-evidence state before production integration; an empty retained
subset must never be presented as “no waiting tasks.” `omittedEvidence` counts
evidence evicted at pressure time, not a claim about the current number of open
tasks.

The exact bounded-memory impossibility remains explicit: with more than 1,024
simultaneously open tasks and no second storage/index owner, every full task
cannot remain resident. The legal UX is a visible partial state plus existing
history materialization, not unbounded memory, silent omission, or a permanent
generation-wide unknown state.

## Current completeness boundary

The server history view carries `agent.ask`, `agent.queue`, and
`agent.replace`, but filters `agent.new`, `agent.steer`, and `agent.compact`.
Reaching origin therefore proves `projectedComplete`, not the full six-word
waiting collection. A limited warm budget that has not reached origin remains
partial. Roster authority is a separate same-identity/current-generation gate;
`true + empty Set` is authoritative empty, while `null` fails closed.

## Production feed and roster integration

The production path now uses the following narrow integration:

1. `useChannelFeed` owns one projection ref for its lifetime. The Scheduler's
   `observeTaskPage(page)` callback immediately calls
   `projection.observeHistoryPage({...page, principalId: preparedPrincipal})`.
   Generation-zero IndexedDB pages are staged in the bounded projection and are
   promoted when the matching remote generation/head is accepted. A principal
   change or cache/server-world mismatch must clear that principal before
   Scheduler attach; otherwise local staging must not be promoted.
2. `applyRows` collects only rows actually accepted by Replica. For the live
   batch, Scheduler `observeLive` runs first. The feed then groups accepted rows
   by channel and calls `projection.observeRows` with the Scheduler's fixed
   `discoveryHead`, generation, `freshThrough`, and verified coverage. A live
   checkpoint with no content rows calls the same port with `rows=[]` only after
   its coverage has been accepted by the existing Scheduler/cache checkpoint
   path. Replayed history rows are not sent again; their Scheduler page was the
   observation seam.
3. `historyFor(channel)` exposes the frozen task snapshot, not raw pages or the
   projection object. App calls `useTaskEvidence` for the active identity and
   joins that snapshot into the existing history status consumed by Timeline.
4. Roster freshness is not inferred from `rosters.has(channel)`: bootstrap
   seeding is cached and `ensure()` currently returns it without a network OBS
   refresh. App owns an authority token
   `(principalId, channelId, attachGeneration)` set only by a completed
   `channelActors` refresh whose identity/generation still match. Seed,
   reconnect, governance invalidation, principal change, and refresh failure
   clear that token. Only a matching token yields
   `actorScopeCurrent=true`; its actual Set may legitimately be empty.
5. Timeline may render retained items while discovery is partial, but must show
   the partial/omitted state. Detached items with incomplete content or controls
   must not expose edit or attachment actions until both content and controls
   are complete. Insert/cancel/other task controls require complete controls,
   but do not require complete body content. The existing materialization path
   restores full content; this rule adds no request path.
6. Actor ids are opaque. Task discovery retains a task word only when it has
   one non-empty audience id, then classifies that id through the authoritative
   current-generation roster Set at publication. It must not infer actor kind
   from an id prefix; validated ledgers can contain both canonical ids and
   opaque ids such as `steward`.
7. `historyStopped` stops allocation, not lifecycle reconciliation. Later
   validated history pages may not add request bodies or unknown orphan
   records, but queued/processing/final facts for already retained records must
   still be folded before their coverage can advance freshness. Otherwise an
   ignored terminal could certify an older queued claim as current.

This path adds no query RPC, timer, cursor, retry, raw-page copy, or second
pagination owner. The former `queryLog` port is absent and must not be restored
or reused.

## Prototype D fixed cases

Focused model and bridge tests establish:

- 1,025 ordinary request → queued → terminal tasks compact to zero records and
  zero retained bytes without overflow.
- 1,025 simultaneous queued tasks retain exactly 1,024, explicitly report one
  omitted evidence item, stay under 4 MiB, and retain the newest task.
- A 1,000-character open request under a 64-byte body threshold remains visible
  through a 32-character preview with `contentComplete=false` and under 2 KiB
  retained evidence.
- A 1 MiB terminal body leaves zero retained bytes after covered closure.
- Unmatched-terminal pressure stops only unsafe older history; a later accepted
  live queued task remains visible and current.
- A live completed terminal, caller-cancelled failed terminal, and ordinary
  failed terminal arriving before their historical request each prevent the
  older queued frame from reappearing.
- Completed, ordinary failed, dismissed (`failed/error_code=dismissed`) and
  replaced (`completed/replaced_by`) terminals all remove a lagging detached
  queued snapshot. This also holds while Replica is still carrying the
  terminal in its response-before-request buffer.
- A disconnect revokes the old generation synchronously. The next generation
  remains unavailable until matching activation; old-generation pages and
  cache evidence are rejected and cannot revive the old queued item.
- Late provisional after a retained terminal cannot revive it; overlapping
  already-verified history rows are ignored.
- Every non-empty/history-filtered generation remains `partial`; no regression
  may promote projected-range coverage to full six-word completeness.
- Opaque and canonical actor ids both reach the same authoritative-roster
  publication gate.
- After bounded history admission stops, cross-page completed, failed,
  dismissed, and replaced terminals still close retained queued evidence;
  replay of the older page cannot revive it.

Focused command:

```text
npx vitest run tests/task-evidence.test.js tests/task-discovery.test.js tests/task-evidence-hook.test.jsx tests/channel-feed-startup.test.jsx tests/history-scheduler.test.jsx tests/conversation-behavior-fuzz.test.js --reporter=dot --silent
```

Production wiring is feed-owned: `useChannelFeed` passes validated history
pages, accepted live rows, and accepted checkpoint coverage to the projection;
`useTaskEvidence` only activates the current principal/channel/generation and
subscribes; Timeline consumes the frozen snapshot through history status.
There is no `wire.submit` port anywhere in this projection/hook path. Focused
integration tests install a submit spy and require zero calls while queued,
terminal, cache promotion, and checkpoint facts converge. Dormant
`system.log.query` plumbing is not part of this mechanism and must not be
restored.

## Terminal monotonicity seam

`projectTaskEvidence(state, {taskSnapshot, ...})` treats Replica as the newer
same-world lifecycle authority over a detached snapshot:

- a materialized turn is emitted only when `agentMessageStage(turn)` is still
  `queued`;
- a terminal response already accepted by Replica but waiting for its older
  request in `_unmatchedByParent` vetoes the detached queued evidence
  immediately;
- terminal evidence is monotonic: later queued/provisional frames do not
  resurrect the item;
- snapshot `complete` is passed through only when freshness, actor scope, and
  `discovery.complete` are all authoritative.

Fold publishes `_taskEvidenceRevision` as the single semantic invalidation
clock for this join. It advances for task requests, queued/processing control
changes, every final response, response-before-request lifecycle facts, and
memory-window removal. Body-only token growth is intentionally excluded.
Timeline's task-evidence memo joins that revision with the frozen task snapshot
identity, so a same-DOM render observes a newer Replica fact even while the
feed-owned snapshot still contains the older queued candidate.

The public integration surface stays small:

- `createTaskEvidenceProjection().observeHistoryPage(page)` — validated
  Scheduler page handoff;
- `.observeRows(batch)` — accepted live rows or accepted checkpoint coverage;
- `.activate(scope)` / `.deactivate(identity)` — generation and roster
  authority only;
- `useTaskEvidence(props)` — subscription bridge with identity/generation
  fencing;
- `projectTaskEvidence(replicaState, {taskSnapshot, ...})` — final pure join
  that prevents a lagging snapshot from overriding newer Replica lifecycle
  facts.
