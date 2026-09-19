# Frontend subtractive audit

Status: subtractive implementation review on
`refactor/frontend-subtractive-cleanup` at `c3952b5`. This document records
production ownership and compatibility boundaries. Tests detect regressions;
they do not establish that an owner model is correct.

Execution status on `refactor/frontend-subtractive-cleanup`:

- A1–A2 deleted.
- B1–B11 removed from the current runtime. Flat ledger rows remain inert for
  continuity; they do not enter business projection.
- C1 implemented: App composes Wire/session, roster, attachment transaction,
  probe, feed and submission owners. One static gate still reports the names of
  probe registries returned by `useAgentProbes`; those registries are no longer
  constructed or mutated by App, so this is a checker classification issue,
  not permission to put probe state back in App.
- C2 implemented: projection/commit, Waiting/editing, notification receipts,
  preferences and row rendering have named owners. Timeline composes their
  snapshots and commands.
- C3 implemented: ReadingSession is the only semantic reading owner. History
  obligations, notification confirmation and DOM evidence are separate ports;
  none persists a second reading record.
- C4 implemented: `ReadingNavigationOwner` is the only physical input
  transaction owner, browsing/following controllers choose typed commands, and
  `executeReadingDOMCommand` is the only timeline scroll writer. The retired
  input-resize event/attribute/class protocol has been deleted.
- C5 implemented: the scheduler remains the lifecycle owner while a pure
  candidate reducer, policy-free bounded executor and I/O-only source adapters
  provide its three internal capabilities.
- C6 implemented: `useChannelFeed` only binds React to one
  `ChannelFeedRuntime`; cache, cursors, Replica, scheduler, hydration and row
  commit live for the runtime lifetime and publish one committed snapshot.
- C7 implemented: pending submissions and drafts publish through one
  transaction projection; IndexedDB outbox remains the sole durable owner.
- C8 remains complete: `fold.js` is the ledger fold; terminal parsing and
  live-arrival provenance have dedicated acyclic owners.
- E implemented for tracked merge artifacts: diagnosis prototypes were
  removed, tests were reduced to current contracts, and vendor keeps one
  package, one reproducible patch and its license/build metadata.

## Acceptance rule

One business fact has exactly one owner, one write boundary, and one lifecycle.
Old-version compatibility is not implemented inside the current runtime. A
version mismatch terminates that runtime and asks the person to refresh. Network
fallback, durable-cache fallback, and explicit retry remain valid failure
strategies when they operate under the same current-version owner.

## Measured shape

- Production JS/JSX/TS/TSX/MJS: 35,170 lines.
- Eight largest stateful/core modules: 10,325 lines (29.4% of production code).
- Compared with local `master`: product source `+7,319 / -7,861` across 66
  files, net `-542` lines.
- New production files: 24 files / 6,287 lines. They are named owner/port
  modules, not compatibility facades.
- Entire old production modules removed: 2 files / 240 lines; the larger
  deletion is code removed from surviving former monoliths.
- Static import reachability from `src/main.jsx`: 187 of 187 production modules;
  dependency cycles: 0.

The branch is now subtractive in product source. C1–C8 owner movements and
compatibility removal are represented in the current production graph; final
tests remain regression evidence, not the mechanism proof.

## A. Delete directly — complete

These files were unreachable from the production entry graph. Tests importing
them did not make them production dependencies.

1. `src/model/fold-admission.js`
2. `src/ui/primitives/FormField.jsx`

They and their isolated compatibility tests are deleted; still-valid assertions
live at the canonical owners.

## B. Removed version-compatibility paths

The original audit found the following duplicate representations/protocol
generations. They are retained here as the deny-list rationale; none remains a
reachable current-runtime compatibility path.

### B1. Notification acknowledgement migration bridge

Files:

- `src/model/cursors.js`
- `src/app/hooks/useChannelFeed.js`

Debt:

- `legacyAcknowledged` is stored beside the canonical channel high-water.
- `notificationMigrationSignature` makes notification derivation depend on both
  the new scalar boundary and old per-message receipts.
- `baselineNotifications()` imports old exact-read identities into the new
  notification state.

Target: `notificationHighWater(channelId)` is the only durable notification
fact. Remove the legacy map, signature, import bridge, and all branches that
subtract legacy identities.

### B2. Submission localStorage migration

Files:

- `src/model/submissions.js`
- `src/app/hooks/useSubmissions.js`

Debt: IndexedDB outbox restore falls back to `atoll.submissions.v1` localStorage,
then migrates it asynchronously. During that period both stores can claim the
same submission.

Target: the IndexedDB outbox is the only durable owner. Remove
`restoreSubmissions`, `saveSubmissions`, `removeStoredSubmissions`, the migration
branch, and the old storage prefix. An unsupported stored version gets the same
explicit refresh/reset UX as other incompatible local state.

### B3. Feed-cache v5/localStorage owner bridge

File: `src/model/feed-cache.js`

Debt:

- removes `atoll.feed.v5.*` keys during current cache open;
- reads `atoll.feed.owner.v1` as a second owner source;
- retains a v5 cutover compatibility branch.

Target: the current IndexedDB global metadata row is the only cache owner.
Remove legacy key scanning, legacy owner reads, and cutover branches. An
incompatible DB schema is deleted/recreated with visible recovery feedback.

### B4. Old agent-options schema

File: `src/model/agent-selection.js`

Debt: reads both canonical `types/inputSchema` and old `words/input_schema`, and
derives choices from old `describe.oneOf` when `agent.options` is unavailable.

Target: `agent.options` is the sole value-domain/current-selection protocol.
Missing support is an unavailable capability, not a second parser.

### B5. Old task-control payloads

File: `src/model/task-controls.js`

Debt: controls without an actor-authored payload fall back to a caller-built
request/turn target.

Target: actor-authored control payload is mandatory. Missing payload makes the
control unavailable; the frontend must not reconstruct an older command shape.

### B6. Old backend edit-lock protocol

File: `src/ui/Timeline.jsx`

Debt:

- `withExpectedHold()` conditionally omits `expected_hold_id` for older actors;
- edit release retains a frontend-only compatibility guard for those actors.

Target: lease CAS is mandatory. An actor that does not advertise it cannot
offer edit/unhold UI and should surface a version/capability error.

### B7. Unversioned attachment worlds

File: `src/App.jsx`

Debt: when the server has no boot/world identity, untagged legacy drafts remain
visible in a synthetic single world.

Target: attachment drafts require a world identity. Missing identity disables
restore and asks for refresh/re-entry instead of merging unversioned rows into
the current world.

### B8. CSS token aliases

File: `src/styles/tokens.css`

Debt: canonical surface tokens and aliases for older components coexist.

Target: rewrite every production selector to canonical tokens, then delete the
aliases in one change. Do not leave indefinite alias chains.

### B9. Old envelope payload shape

File: `src/protocol/envelope.js`

Decision: historical flat payloads are unsupported internal-development data.
The envelope may remain in the ledger, but `argsOf()` returns an empty business
body for it: no migration, no error UI, and no downstream compatibility path.
Only canonical `{ body }` payloads enter the presentation model.

### B10. Older view-session payloads

File: `src/model/view-session.js`

Debt: the current reader silently reconstructs state from partial v2 persisted
records.

Target: version the persisted record at its read boundary. Reject/reset an old
version once; downstream reading code receives only the canonical shape.

### B11. Retired control-action persistence

The old `atoll.controls.v1` localStorage reader/writer had no production
caller; only its isolated compatibility test kept it alive. It is deleted.
Control feedback is now session-local UI state and the ledger terminal remains
the durable fact.

## C. Consolidated ownership

The original monolith boundaries are now replaced by the named owners and
invariants below.

### C1. `App.jsx` — implemented (1,355 lines)

App now composes `useWireSessionPort`/`useWireConnection`,
`useChannelRoster`, `useAttachmentTransactions`, `useAgentProbes`,
`useChannelFeed` and `useSubmissions`. Each domain owner contains its own
cancellation and epoch fencing; App keeps route, shell, modal and committed-port
wiring. App may retain refs that connect committed ports, but it must not mutate
the domain owner's registries or reconstruct its lifecycle.

Invariant: a late callback is accepted only by the domain owner that issued it.
App can dispose or replace an owner; it cannot repair a stale result.

### C2. `Timeline.jsx` — implemented (375 lines)

Timeline now joins:

- conversation projection/commit owner;
- waiting/editing controller;
- notification receipt adapter;
- stateless row renderer;
- one preference owner for scope, actor filters, fold choices and layout.

Invariant: projection rows, editing transactions, notification receipts and
preferences each have one mutable owner. Timeline only passes their immutable
snapshots and commands; it does not construct protocol frames or persist them.

### C3. `useReadingSession.js` — implemented (1,281 lines)

ReadingSession remains the semantic reading owner. Three lifecycle ports have
explicit inputs and receipts:

- history consumer obligation;
- notification confirmation;
- DOM evidence adapter.

Invariant: only ReadingSession changes mode, activation and persistent reading
state. The ports may request history, confirm a presented boundary or observe
DOM facts, but cannot write `view-session` or create another reading session.

### C4. List DOM boundary — implemented

`ReadingNavigationOwner` owns the native input transaction. Browsing/following
controllers choose typed commands from committed evidence, and
`executeReadingDOMCommand` is the only timeline scroll writer. The list adapter
measures DOM geometry and delegates accepted commands; it does not choose mode
or mutate scroll position itself. The retired input-resize custom
event/attribute/class protocol is absent.

Invariant: one semantic controller chooses mode and command; one
activation/input epoch cancels wheel, touch, pointer, key, scrollbar,
selection, focus and programmatic input; one DOM executor performs the accepted
command. Native scroll listeners publish evidence only and no global custom
event can grant or restore authority.

### C5. History scheduler — implemented

`history-scheduler.js` remains the only obligation lifecycle owner. Candidate
selection is in the pure `history-candidate-reducer`, physical concurrency is
in `history-bounded-executor`, and cache/network shape plus validation is in
`history-source-adapters`.

Invariant: only the scheduler/reducer pair selects and advances an obligation.
The executor knows neither channel nor source policy. Source adapters return a
validated result and cannot mutate scheduler state or choose the next job.

### C6. Feed ingress — implemented

`useChannelFeed.js` is a 28-line React binding over
`createChannelFeedRuntime`. The runtime constructs cache, cursors, Replica,
scheduler, Presentation admission and notification hydration once, folds an
accepted row batch, then publishes one immutable owner snapshot.

Invariant: one `applyRows` transaction changes the Replica. Consumers observe
only a committed runtime snapshot/event; none is called halfway through row
folding. Runtime disposal cancels effects and closes its owned resources.

### C7. Submission transaction — implemented (973 lines)

IndexedDB outbox is the sole durable submission/draft owner. Pending and draft
React state share `publishTransaction`; restore, clear, send, retry and receipt
reconciliation cannot publish one side from a stale snapshot of the other.

Invariant: every continuation rechecks principal, world, channel access,
attempt and transport epochs before transaction publication. React is a
projection of durable state and the active lease, never a second writable
truth.

### C8. Ledger fold — implemented

`fold.js` remains the canonical ledger fold. Terminal interpretation lives in
`terminal-result.js`; live-arrival provenance lives in `live-arrivals.js`.
Neither owner re-exports through Fold, and the production import graph is
acyclic.

## D. Keep: failure strategies, not compatibility

These paths are legitimate when they preserve one owner and one canonical
shape:

- IndexedDB-to-network source fallback inside HistoryScheduler.
- Cache rows remaining visible while network freshness is pending/error.
- Explicit retry after bounded failure.
- Version-incompatible terminal page with a manual refresh button.
- CSS/browser feature fallback that does not create a second business truth
  (for example clipboard or focus mechanics).

The removal pass must not confuse availability strategy with old data-model
compatibility.

## E. Branch-size cleanup — implemented for tracked merge content

Current diff against local `master`:

- tests: 79 changed files, `+902 / -4,246`;
- docs: 2 changed files, `+158 / -120`, including this final audit update;
- vendor: 11 changed paths, `+1,446 / -1,575`, ending with exactly one package,
  one reproducible patch, `LICENSE`, and `README`.

Contract/regression tests remain. Tracked one-off browser investigations and
prototype fixtures were removed. Untracked local evidence directories are not
part of the product merge and are not completion evidence.

## F. Removal result

Steps 1–3 and 5–8 are represented in the current source. Step 4 is deliberately
fail-closed instead of a migration: historical flat payloads remain inert
ledger bytes and never enter business projection. C4's retired input-resize
protocol is deleted and its physical command boundary is explicit.

## Completion proof

The subtractive pass is complete only when all of the following are true:

- no production import is unreachable;
- no `legacy`, `migration bridge`, `older actor/server`, or compatibility alias
  remains in production business-state code;
- every durable fact has one named owner and one storage key/schema;
- unsupported versions fail closed at one boundary;
- App and Timeline contain composition, not parallel lifecycle stores;
- the same frozen commit passes build and invariant tests;
- a final diff against `master` documents which new lines are product capability
  and which old lines were actually removed.
