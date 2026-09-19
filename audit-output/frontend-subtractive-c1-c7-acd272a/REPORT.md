# C1–C7 subtractive acceptance baseline

Baseline: `acd272a9b44542771da9ed0307d1bdacae38a7f6`

Source contract: `docs/FRONTEND-SUBTRACTIVE-AUDIT.md`.

This is an acceptance checker, not a refactor prescription. Moving code into
new files does not pass a gate if the old owner, storage key, lifecycle, or
write path remains reachable.

## Run

From the repository root:

```sh
test "$(git rev-parse HEAD)" = acd272a9b44542771da9ed0307d1bdacae38a7f6
node audit-output/frontend-subtractive-c1-c7-acd272a/check-architecture.mjs \
  > audit-output/frontend-subtractive-c1-c7-acd272a/result.json
```

The first command pins this baseline. After merge, omit the first command and
record the tested commit beside `result.json`. The checker exits non-zero until
all static hard gates pass. A zero exit is necessary, not sufficient: the
owner ledger and lifecycle checks below are mandatory because regex/import
checks cannot prove that two mutable stores are merely cache and projection.

## Hard thresholds

| Gate | Acceptance threshold |
|---|---|
| Frozen source | `trackedWorktreeChanges=[]`; the JSON's automatically captured `commit` is the source commit under review. |
| Production reachability | Every non-test JS/JSX/MJS/TS/TSX module under `src/` is reachable from `src/main.jsx`; `unreachable=[]`. Tests importing a file do not count. |
| Import cycles | No reachable strongly connected component has more than one module; `importCycles=[]`. In particular, a domain reducer may not import a projection that imports it back. |
| Compatibility | Every B1–B8/B11 deny-list hit is zero; B9 canonical-body and B10 strict-schema boundary assertions are true. A current-version terminal page and ordinary feature fallback are not compatibility debt. |
| Durable facts | Every durable fact appears once in the owner ledger below, has one writer module and one key/schema. Reset code may erase another owner's key but may not parse or rewrite that fact. |
| C1–C7 ownership | Each `violations` array is empty and its manual lifecycle proof is attached. Lower line/hook counts alone never pass. |
| Frozen evidence | Build, invariant tests, checker output, owner ledger, and diff are all from one commit. |

## Baseline result at `acd272a`

- Import reachability: **PASS**, 165/165 production modules reachable.
- Dependency cycles: **FAIL**, one six-module SCC:
  `agent-control → task-controls → fold → live-arrivals → notification-policy → conversation-visibility → agent-control`.
- Compatibility: **FAIL** against the audit's B4/B6 rules. `dynamic-form.js`
  still accepts the internal `meta.input_schema` alias and Timeline retains
  `withExpectedHold()`, which can omit `expected_hold_id`. The canonical
  actor.describe transport-manifest field `input_schema` normalized by
  `capabilities.js` is deliberately excluded: it is the current wire schema,
  not the retired agent-options representation. If either remaining path is a
  newer product decision, amend the source audit explicitly; a stale document
  cannot be counted as completion evidence.
- B9/B10 boundary shape checks pass: flat envelopes expose no business body,
  and view-session storage requires the exact current schema. They are positive
  fail-closed assertions because old ledger/storage bytes may still exist; a
  raw string-absence rule would incorrectly require deleting the boundary.
- C1–C7: **all incomplete** under the responsibility tests below. C2's
  notification receipt extraction is a real completed substep; it does not
  make Timeline a composition-only module.

Supporting size, never used as the pass condition:

| Module | Lines | Direct production imports | Hooks/refs/state calls |
|---|---:|---:|---:|
| `App.jsx` | 2,218 | 51 | 137 |
| `Timeline.jsx` | 2,080 | 38 | 101 |
| `useReadingSession.js` | 2,426 | 5 | 60 |
| `LegendMessageList.jsx` | 2,315 | 7 | 87 |
| `history-scheduler.js` | 2,275 | 1 | 0 React hooks; 75 local functions |
| `useChannelFeed.js` | 1,335 | 17 | 64 |
| `useSubmissions.js` | 985 | 7 | 50 |

## Durable fact owner ledger

The post-refactor ledger must preserve every row or explicitly delete the fact.
For each row, attach `rg` output showing that only the named storage owner writes
the key/schema. A React state/ref mirror is allowed only when it is described as
a projection with a one-way publication edge and epoch/CAS invalidation.

| Durable fact | Semantic owner | Storage owner | Key/schema at baseline | Allowed mirror / reset |
|---|---|---|---|---|
| authenticated principal bootstrap | identity/session controller | `workspace-bootstrap-cache.js` | `atoll.session.principal.v1` | read-only startup cache; logout erases |
| channel membership/profile bootstrap | directory controller | `workspace-bootstrap-cache.js` | `atoll.workspace.bootstrap.v1.<principal>` | App projection only; server boot may erase |
| server ledger world | wire/session world controller | `server-boot.js` | `atoll.server.boot.v1` | no second boot ref may authorize data; its reset may erase world-scoped caches |
| channel display names | directory presentation cache | `channel-name-cache.js` | `atoll.channel.names.v1` | cosmetic only; server boot erases |
| workspace route/focus | routing controller | `workspace-route.js` | URL hash/history schema | React route state is a projection; URL is the durable truth |
| pane widths | shell layout preference owner | `pane-sizes.js` | `atoll.web.pane.<kind>` | AppShell/RightPanelHost call commands; they do not parse storage |
| conversation preferences + durable unseen evidence | view-session owner | `view-session.js` | `atoll.view-session.v3.<principal>`, schema 3 | live Reading state is activation-scoped; persisted bookmark is deliberately cleared |
| read cursor | cursor owner | `cursors.js` | `atoll.read.v4.<channel>` | feed exposes commands only |
| exact read identities | cursor owner | `cursors.js` | `atoll.read-identities.v1.<channel>` | bounded identity map only |
| notification high-water | cursor owner | `cursors.js` | `atoll.notification-high-water.v1.<channel>` | no legacy receipt subtraction |
| read authority | cursor owner | `cursors.js` | `atoll.read-authority.v1`, schema 1 | principal/boot epoch fences every cursor publication |
| retained history priority | HistoryScheduler | `history-scheduler.js` | `atoll.history.priority.v1` | scheduling hint only; server boot erases |
| feed cache rows/meta/world | FeedCache | `feed-cache.js` | IndexedDB `atoll-feed-v8`, schema 1: `rows`, `channelMeta`, `globalMeta` | scheduler reservoir is a bounded projection, never another durable cursor |
| submissions + drafts | submission transaction owner | `outbox-store.js` | IndexedDB `atoll-outbox-v1`, schemas 1/2: `submissions`, `drafts` | one in-memory lease projection; no localStorage fallback |
| local timer receipts | automation controller | `timers.js` | `atoll.timers.<principal>` | ledger remains server truth; server boot erases local receipts |
| file reading recency | file-reading controller | `file-reading-history.js` | `atoll.web.file-reading-history.v1.<principal>.<world>` | App list is a projection; server boot erases |
| terminal session | terminal session controller | `net/pty.js` | sessionStorage `atoll.terminal.session.<channel>.<device>` | tab-scoped by design; server boot erases |
| terminal theme | terminal preference owner | currently `TerminalView.jsx` | `atoll.terminal.theme` | candidate for extraction; component is currently the direct writer |
| diagnostics ring | diagnostics owner | `diagnostics.js` | sessionStorage `atoll.diagnostics.v1` | no business decision may depend on it |
| device performance override | device-profile owner | `device-profile.js` | `atoll.perf.profile.v1` | explicit diagnostic preference only |

Re-run the raw inventory after every merge:

```sh
rg -n "localStorage|sessionStorage|new Dexie|databaseName|DB_NAME|DATABASE_NAME|STORAGE_(KEY|PREFIX)|\.version\([0-9]+\)\.stores" \
  src --glob '!**/*.test.*' --glob '!**/*.spec.*'
```

Acceptance requires explaining every new line by adding exactly one ledger row;
an unmanifested key fails. Two writers for one row fail. Two rows describing
the same semantic fact fail even if their key strings differ.

## C1 — App composition

Current failure evidence: App directly constructs Wire/roster/access lifecycles,
owns attachment upload queues and epochs, agent probe ledgers, directory refresh
fences, feed ownership refs, and 31 React states/32 refs.

Pass only when:

1. App imports committed domain controllers and UI shells, not transport,
   storage, fold, authorization, or migration implementations.
2. Each controller returns one immutable snapshot plus commands; App cannot
   repair a late callback with a subsystem-specific ref/epoch.
3. App-local state is limited to routing/modal/composition state. Roster,
   attachment, probe, submission, feed, timer, and file-operation lifecycles
   each name an external owner.
4. Removing App does not remove a domain's cancellation/epoch logic; unmount
   invokes controller disposal only.

Static threshold: C1 violations empty; no direct persistence access; no direct
`createWire`, `createRoster`, FeedCache, outbox, or ledger-fold construction.

## C2 — Timeline composition

Current failure evidence: Timeline constructs Presentation, owns scope/filter and
fold choices, Waiting continuity, the full edit/hold/replace state machine, role
finalization, row rendering, and 17 states/21 refs. Receipt extraction is already
outside Timeline and must remain outside.

Pass only when four named ports exist and Timeline merely joins them:

1. projection/commit owner;
2. Waiting/editing transaction controller;
3. notification receipt adapter;
4. stateless row renderer.

No protocol frame construction, durable preference mutation, replacement CAS,
or ledger fallback may remain in Timeline. Static threshold: C2 violations
empty and no direct imports of protocol envelope/vocab, fold, task controls, or
conversation-presentation implementation.

## C3 — ReadingSession semantic owner

Current failure evidence: one hook owns semantic mode/bookmarks together with
history retry/deadlines, notification confirmation refs, DOM visibility, cold
entry readiness, and persistence joins.

Pass only when history obligation, notification confirmation, and DOM evidence
are explicit injected ports. `useReadingSession` may reduce their typed facts,
but it may not read `document`, install visibility/DOM listeners, issue history
I/O, or persist another reading record. The view-session store remains the sole
durable reading/preferences owner.

Static threshold: C3 violations empty; zero browser-DOM globals/listeners in the
semantic owner; extracted ports do not import `view-session.js` or construct a
second reading store.

## C4 — List adapter

Current failure evidence: Legend executes DOM commands but also decides runway,
underfill and top history demand, owns input transactions and following
authorizations, writes scroll position, and still listens for
`atoll:input-resize-prepared`.

Pass only when it accepts typed Reading commands and emits typed evidence. It
may own DOM refs and perform the one commanded scroll, but it cannot decide when
history is needed, when the user intent changes, or which mode wins. All vendor
geometry workaround code must be in the pinned vendor patch, not duplicated in
the adapter.

Static threshold: C4 violations empty. Human proof must map every remaining
`scrollTo/scrollBy` to one command type and show one cancellation owner for
wheel, touch, pointer, key, scrollbar, selection, focus and programmatic input.

## C5 — History scheduler internals

Current failure evidence: the single 2,274-line module contains candidate
selection, source choice, reservation, network/cache execution, commit, retry,
cancellation, public snapshots and 75 local functions.

The audit contracts responsibilities, not filenames. The accepted implementation
may use names such as `history-candidate-reducer.js`,
`history-bounded-executor.js`, and `history-source-adapters.js`. The checker
discovers the three owners by their unique exported capabilities
`reduceHistoryCandidates`, `createHistoryBoundedExecutor`, and
`createHistorySourceAdapters`, then checks their effect boundaries. Renaming a
file cannot satisfy this gate, and a correct owner does not fail merely because
its filename differs from an illustrative name.

Pass only when a pure reducer alone selects/advances obligations, a bounded
executor runs selected effects, and cache/network adapters only return source
results. Adapters cannot mutate channel lifecycle state or call each other.

Static threshold: C5 violations empty; exactly one production module exports
each capability; reducer tests use plain values/no I/O; the bounded executor
contains no channel/source policy; adapters do not import reducer/executor
policy; and the global import graph remains acyclic.

## C6 — Feed ingress

Current failure evidence: the hook constructs and coordinates cursors,
FeedCache, Replica, Presentation admission, HistoryScheduler, notification
hydration and sync obligations while exposing many loose callbacks.

Pass only when one committed ingress transaction accepts Wire/cache rows and
publishes one immutable feed snapshot. Notification, access, roster, timer and
submission consumers receive committed events from that port; they cannot be
called halfway through row folding. Cache/scheduler/cursor owners are injected
ports rather than additional hook-local authorities.

Static threshold: C6 violations empty; exactly one production function calls
the ledger/Replica row-commit command; no migration or notification durable
state lives in the ingress coordinator.

## C7 — Submission transaction

Current success to preserve: IndexedDB outbox is the only durable submission
store; no localStorage migration remains.

Current incomplete boundary: pending/draft React states and ledger refs are
mutated together at multiple sites (restore, clear, send) instead of through one
transaction publication boundary.

Pass only when authorization capture, durable transition, transport attempt,
receipt/feed reconciliation, cancellation and retry are phases of one owner.
There is one in-memory lease projection, updated by one publication function;
React never becomes a second writable truth.

Static threshold: C7 violations empty; all outbox writes occur in
`outbox-store.js`; all pending/draft publications pass one named transaction
publisher; every async continuation checks principal, world, channel access,
attempt and transport epochs before publication.

## Double-authority review template

For each C1–C7 owner movement, append one row to the merge evidence:

| Fact | Authoritative mutable object | Writers | Projection/cache | Start | Commit | Cancel/revoke | Durable key |
|---|---|---|---|---|---|---|---|

Reject the merge if either of these questions has two answers:

- Where can this fact be changed?
- Which lifecycle decides that a late result is still current?

An adapter may cache a value only if deleting the cache cannot change a business
decision and the authority can reconstruct it. A React ref mirroring state is
not automatically harmless: every direct assignment must be downstream of the
same commit boundary.

## Final merge command set

```sh
git rev-parse HEAD
node audit-output/frontend-subtractive-c1-c7-acd272a/check-architecture.mjs \
  > audit-output/frontend-subtractive-c1-c7-acd272a/result-final.json
npm run build
npm test
git diff --stat master...HEAD -- src
git diff --numstat master...HEAD -- src
```

The completion report must include the checker JSON, owner ledger, invariant
test names, and the final source diff. A smaller file, a green build, or new
wrappers without deletion does not satisfy C1–C7.
