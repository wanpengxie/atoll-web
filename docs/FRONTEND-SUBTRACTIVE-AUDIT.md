# Frontend subtractive audit

Status: first complete static pass on `refactor/conversation-frontend-r3` at
`c896b52`. This document audits production ownership and compatibility debt;
passing tests are evidence, not a reason to retain a second authority.

Execution status on `refactor/frontend-subtractive-cleanup`:

- A1–A2 deleted.
- B1–B10 removed from the current runtime. Flat ledger rows remain inert for
  continuity; they do not enter business projection.
- C8 complete: `fold.js` is the ledger fold; live-arrival provenance now has a
  dedicated owner in `live-arrivals.js`, with no compatibility re-export.
- E partially complete: tracked browser prototypes and diagnostic-only specs
  are deleted; the vendor directory now keeps one final package and one
  reproducible source patch instead of intermediate generations.
- C1–C7 and E remain the active subtractive work. They require owner movement
  and deletion, not compatibility wrappers.

## Acceptance rule

One business fact has exactly one owner, one write boundary, and one lifecycle.
Old-version compatibility is not implemented inside the current runtime. A
version mismatch terminates that runtime and asks the person to refresh. Network
fallback, durable-cache fallback, and explicit retry remain valid failure
strategies when they operate under the same current-version owner.

## Measured shape

- Production JS/JSX: 35,527 lines.
- Eight largest stateful/core modules: 14,558 lines (41% of production JS/JSX).
- Compared with local `master`: product source `+18,788 / -2,516` across 94
  files.
- New production files: 26 files / 9,405 lines.
- Entire old modules removed: 5 files / 936 lines.
- Static import reachability from `src/main.jsx`: 162 of 164 production modules.

The branch therefore contains a real new architecture, but it has not completed
the corresponding subtractive pass.

## A. Delete directly

These files are unreachable from the production entry graph. Tests importing
them do not make them production dependencies.

1. `src/model/fold-admission.js`
2. `src/ui/primitives/FormField.jsx`

Required action: delete the files and either delete their isolated tests or move
the still-valid assertions to the canonical owner.

## B. Remove version-compatibility paths

These paths deliberately keep two representations or two protocol generations
alive. They violate the current product decision that an incompatible runtime
must stop and request a refresh.

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

## C. Consolidate ownership before deleting code

These are not all duplicate truths today, but their boundaries are too large or
too implicit to prove that reliably.

### C1. `App.jsx` (2,219 lines, 63 hooks/refs)

Currently combines wire lifecycle, identity/world, roster, directory,
attachments, submissions, notifications, search/activity projections, timers,
files, UI routing, and modal state.

Target: App composes committed ports only. Move each lifecycle into one domain
controller and expose an immutable snapshot plus commands. App must not contain
domain migrations or late-callback fencing for every subsystem.

### C2. `Timeline.jsx` (2,080 lines, 39 hooks/refs)

Currently combines projection, Admission commit, Waiting, editing leases,
notification acknowledgement, folding, message rendering, activity hints, and
row-revision optimization.

Target: split into:

- conversation projection/commit owner;
- waiting/editing controller;
- notification receipt adapter;
- stateless row renderer.

Timeline becomes composition and must not implement protocol compatibility.

### C3. `useReadingSession.js` (2,425 lines, 25 hooks/refs)

Currently owns activation, mode, bookmarks, notification receipts, cold-entry
readability, history-demand retries, Admission joins, DOM evidence, and
persistence.

Target: keep ReadingSession as the semantic reading owner, but extract three
pure ports with explicit inputs/outputs:

- history consumer obligation;
- notification confirmation;
- DOM evidence adapter.

No extracted module may create another persisted reading state.

### C4. `LegendMessageList.jsx` (2,286 lines)

Currently contains the virtualizer adapter, measurement, DOM coverage, input
transactions, underfill demand, following/browsing handoff, public commands, and
instrumentation.

Target: the adapter executes typed Reading commands and reports typed DOM
evidence. Input ownership and history-demand policy belong above it. Vendor
workarounds belong in the pinned vendor patch, not in parallel App logic.

### C5. `history-scheduler.js` (2,274 lines, 22 exports)

Currently combines global scheduling, per-channel state, source selection,
cache/network execution, reservations, retry, cancellation, diagnostics, and
public snapshots.

Target: one scheduler owner remains, but split its implementation into a pure
candidate reducer, bounded executor, and source adapters. Only the reducer may
decide which obligation runs; adapters cannot advance lifecycle state.

### C6. `useChannelFeed.js` (1,357 lines, 36 hooks/refs)

Currently bridges Wire, scheduler, cache, Fold, notifications, access, roster,
timers, submissions, and diagnostics.

Target: it becomes one feed ingress coordinator. Remove notification migration
logic and move domain callbacks behind a single committed ingress port.

### C7. `useSubmissions.js` (994 lines, 26 hooks/refs)

Target: IndexedDB outbox + one in-memory lease projection. Remove localStorage
migration and keep authorization/transport continuations inside a single
submission transaction owner.

### C8. `fold.js` (923 lines)

Target: remain the canonical ledger fold only. Presentation fallbacks,
notification policy, and UI loading decisions must not enter this module.

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

## E. Branch-size cleanup

The branch also contains large non-product additions. They do not create runtime
authority, but they obscure review and should be curated before merge:

- tests: 187 changed files, `+40,159 / -1,332`;
- docs: 33 changed files, `+8,062 / -3`;
- vendor patches: 12 files, `+5,661`.

Actions:

1. Keep contract/regression tests that protect a current invariant.
2. Delete one-off diagnosis tests and prototypes after extracting the invariant.
3. Keep exactly one reproducible vendor patch plus license/build metadata;
   remove superseded patch generations.
4. Archive historical ledgers outside the product merge if they are not needed
   to build or operate the application.

## F. Ordered removal plan

1. Delete the two unreachable modules.
2. Remove browser-local compatibility bridges (notifications, submissions,
   feed-cache, view-session) behind an explicit local-schema reset boundary.
3. Remove protocol compatibility (agent options, task controls, edit lease,
   attachment world); unsupported capability becomes unavailable, never guessed.
4. Decide and execute the server-side ledger migration boundary for flat
   payloads.
5. Shrink App/Timeline by moving existing canonical owners, without introducing
   alternate stores or adapters.
6. Split Reading/List/Scheduler implementations while preserving exactly one
   owner per fact.
7. Remove superseded tests, prototypes, docs, and vendor patch generations.
8. Recompute branch diff. The result must show meaningful deletion in product
   source, not only more wrapper modules.

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
