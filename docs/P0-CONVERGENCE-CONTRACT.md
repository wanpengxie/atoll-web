# P0 Convergence Contract

This contract prevents a difficult lifecycle bug from turning into an
unbounded search for counterexamples. It applies to every P0 owner, reviewer,
and integrator.

## What correctness means

Correctness is not seamless recovery from every possible intermediate state.
It has three ordered obligations:

1. **Safety facts:** never let stale authority overwrite current facts, report
   failure as success, lose acknowledged durable data, or create a second
   owner for the same fact.
2. **Normal user paths:** entry, navigation, reading, sending, editing, and
   explicit user control transfers must work continuously.
3. **Bounded failure:** if an uncommon state cannot be reconstructed from an
   authoritative source, terminate the local lifecycle honestly and offer a
   retry, re-entry, refresh, or restart path.

Ephemeral work may be discarded. Durable facts may not be guessed. A local,
understandable fail-stop is preferable to a larger recovery state machine.

## Classify before changing code

Every proposed P0 change must classify the observed condition as exactly one
of these:

- **Authoritative fact:** durable input accepted from the current authority.
- **Observation:** transient DOM, geometry, timing, connectivity, or cache
  evidence. Re-observe it after remount; do not persist it as truth.
- **Consumer obligation:** work still owed to a user-visible surface. It ends
  only in visible progress, authoritative exhaustion, explicit error, or
  lifecycle replacement.
- **Ephemeral work:** a request, timer, waiter, or render attempt. It may be
  cancelled, fenced, timed out, or abandoned without reconstructing it.

If the classification is unclear, implementation stops until the root agent
decides it.

## Complexity budget

A new state, epoch, lease, persisted field, compatibility path, or owner is
allowed only when it is required by a normal user path or a safety fact.

Do not add machinery merely to guarantee:

- exact scheduling order across arbitrary interleavings;
- immediate physical cancellation after a result is already fenced;
- exact priority downgrade for short-lived work;
- compatibility with stale tabs or older application versions;
- a fixed frame count, diagnostic-event time, or internal DOM arrangement;
- reconstruction of in-flight control state after refresh or restart.

Unsupported versions or malformed protocol shapes fail closed and may ask the
user to refresh. Bounded late work may finish and be discarded by authority.

## Three-failure escalation

After the same P0 candidate fails three times, stop patching. The root agent
must publish a short decision containing:

1. the user-visible normal path;
2. the safety facts that must survive;
3. the authoritative owner and lifecycle boundary;
4. observations and ephemeral work that may be discarded;
5. the allowed fail-stop/retry/refresh behavior;
6. states or branches to delete rather than extend.

No further implementation begins until this decision is accepted. One owner
implements it and one independent verifier tests it. Additional agents do not
invent more counterexamples for that P0.

## Acceptance evidence

A P0 is accepted when all of the following hold on one exact commit:

- the normal user scenario succeeds;
- the safety facts hold under the smallest relevant stale/late-result case;
- the declared failure path terminates and is understandable;
- no new owner, compatibility layer, or persisted transient state was added;
- browser timing or internal diagnostics are not used as product truth;
- the implementation and verifier used isolated worktrees and report the base,
  branch, worktree, commit, and changed-file boundary.

Tests are necessary evidence, not the definition of the architecture. A test
whose only failure is frame count, diagnostic timing, or a non-user-visible
internal arrangement must not force a product-state change.

## Current P0 decisions

- **Reading/notification re-entry:** explicit return to tail mints a successor
  Reading authority. Visibility loss and root replacement revoke evidence;
  they do not reconstruct it. Old receipts are discarded.
- **History underfill:** while the visible viewport is underfilled and Feed has
  older supply, Reading owes one demand until visible progress, authoritative
  EOF, explicit error, or lifecycle replacement. Exact diagnostic timing and
  retained DOM coverage are not authority.
- **Feed physical join:** physical I/O may be shared, but semantic waiters are
  owned by one current demand. Replacement retires the old demand; public state
  cannot be `idle` with an error. Priority downgrade and immediate physical
  cancellation are outside the P0 unless they affect user facts.
- **Reading anchor:** Vendor is the only scroll writer. An accepted position
  lease preserves the same hit-tested visible content position; first user
  input revokes old restoration work.

