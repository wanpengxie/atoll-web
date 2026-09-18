# Interaction request transaction contract

Source boundary: `fba269191c4373560a54b09c5ed5410c88e30f5d`.

This contract covers user message submission, edit-control submission and
attachment upload. It does not add a background service. A request owns one
immutable identity and advances through explicit phases; phase authorization is
implemented once by the request-owner reducer rather than by ad-hoc checks after
individual `await`s.

## Owner

Every request owner contains:

| Field | Meaning | Invalidated by |
|---|---|---|
| `principalId`, `principalEpoch` | committed signed-in owner | logout/login, principal restore reset |
| `channelId` | immutable target channel | never rewritten by navigation |
| `worldEpoch` | server-ledger world named by local durable ids | server boot/world reset |
| `attemptEpoch` | process-local reset fence; never persisted as the durable world id | in-process world/context reset |
| `accessEpoch` | exact authorization lifetime (`existence`, `relationship`, `selfActorId`) | revoke, retire, actor replacement or later grant |
| `transport`, `transportEpoch` | exact live transport attempt | disconnect/reconnect or wire replacement |
| `draft` | accepted editor/draft revision or attachment draft epoch | used by the durable CAS; newer editing does not rewrite the captured request |

`accessEpoch` is monotonic per access tracker and changes only when the
authorization tuple changes. `runtime` and `unavailable` are retryable attempt
gates, not access-lifetime changes: a transient 503 must not erase the evidence
that would distinguish revoke → regrant. Repeated observations of the same
authorization tuple do not cancel useful work.

## State table

| State | Entry authority | Side effect | Success | Invalidation / failure |
|---|---|---|---|---|
| `captured` | principal + world + channel access | none | `acquiring` | reject before durable mutation |
| `acquiring` | principal + world + access; transport only for online attempt | hydrate draft/outbox or acquire message lease | `persisting` | denied/retired → rejected; transport replacement → queued; identity/world replacement → old owner only |
| `persisting` | same owner; durable draft CAS checks captured draft revision | persist immutable outbox frame / transmitting attempt | `submitting` or durable offline `queued` | stale owner cannot advance; expected-state CAS prevents overwriting a concurrent rejection |
| `submitting` | full owner including access + transport immediately before call | one `wire.submit` or one upload PUT | `settling` | pre-call stale → no external write; uncertain call → immutable id remains uncertain |
| `settling` | principal + durable world + local attempt for current UI publication; immutable id for durable reconciliation | persist receipt/rejection and reconcile feed | terminal / accepted / uncertain | later access or transport change does not erase a submit that already crossed the wire |
| `release-pending` | edit session + exact hold id + same-channel authority | durable `agent.unhold` request | `release-accepted` only after outbox id exists | failure remains retryable and observable; never recorded sent before acceptance |
| `attachment-committing` | principal + world + access + transport + attachment draft epoch | attach stable resource id to per-channel draft | durable draft association | cleared draft or stale authority cannot resurrect association; completed unassociated resource is reported, not silently deleted |

## Async side effects

1. IndexedDB hydrate, draft write, outbox bulk put and message lease.
2. Wire frame preparation and submit.
3. Receipt/feed reconciliation and lease release.
4. Resource ticket acquisition and HTTP PUT.
5. Durable attachment association with a channel draft.
6. Edit hold/context/replace/unhold, all sent through the same durable request
   path.

Read-only device discovery is not a state transition, but its result may only be
used by an owner that is still current.

## Cancellation and retry

- Navigation is not cancellation. The owner retains its original channel.
- Principal/world/attempt replacement cancels publication into the new world. Old
  durable records are settled only under their old principal identity.
- Access denial/retirement cancels work before submit and produces a durable
  rejection without allowing an older continuation to overwrite it.
- Transport replacement before submit returns the immutable record to `queued`;
  one later open epoch may retry it.
- Once submit/PUT has started, cancellation cannot pretend it did not happen.
  The immutable id/ticket outcome is settled; access loss only prevents a new
  attempt or draft association.
- Edit release is idempotent by its durable request id and `expected_hold_id`.
  A failed pre-acceptance attempt is retained by an App-owned obligation outside
  Timeline and retries the same id on a timer or authority recovery; an accepted
  outbox id is the earliest point at which the UI may mark release sent. Browser
  process termination still cannot promise delivery without a backend worker.
- Clearing an attachment draft aborts any abortable in-flight transfer and
  invalidates association. It does not silently delete a remote resource whose
  PUT already completed.

## State reduction rules

- There is one request-owner assessment function and one owned-phase executor.
- Access UI gates are presentation only; they never substitute for execution
  authority.
- Pending React state is a projection of the durable record. Expected-state CAS
  wins over stale continuations.
- `settling` deliberately has weaker authority than `submitting`: a later revoke
  cannot make an already accepted server fact disappear.
