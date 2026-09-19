# A–D blocked-evidence recovery, round 16 (2026-09-20)

This packet selects exactly 20 rows that were `BLOCKED` at the start of this
round.  The scope is three Activity/Operation rows rechecked at their existing
public boundary plus 17 non-shell/node/restart rows with a current public
owner.  Each case preserves the user capability and invariant and records the
first public owner.  No product code, compatibility API, private export, old
store, deletion, or skip was added.

## Focused result

```text
npx vitest run tests/blocked-round16-public-owner.test.jsx \
  tests/blocked-round15-activity-owner.test.js --reporter=dot

Test Files  2 passed (2)
Tests       18 passed | 3 expected fail (21)
```

The 18 green executions represent 17 baseline IDs because AD-327 is the
baseline `it.each` declaration and runs its two text-progress variants.  The
17 IDs are promoted to `PASS` in the ledger.  The three Activity IDs remain
`BLOCKED`; their preserved `it.fails` reproductions are evidence, not a
completion signal or an obsolete-case decision.

## Per-case evidence

| ID | User capability | Invariant | Current public owner and setup/action | Current result / disposition |
|---|---|---|---|---|
| AD-002 | Activity center locates one business fact across terminal, WorkItem, and Operation with a SourceRef. | Same channel/request facts dedupe without private ticket payloads. | `selectFeatureSearchIndex` receives public operation input at [`blocked-round15-activity-owner.test.js:56`](../tests/blocked-round15-activity-owner.test.js:56). | **BLOCKED**: no Operation row is emitted; the current public index has no Operation Center owner. Rechecked by the round-15 `it.fails` reproduction. |
| AD-003 | Repeated Operations dedupe by channel/native ID, keep latest unsettled state, and omit completed work. | Channel identity and native operation ID are the dedupe boundary. | Public `selectFeatureSearchIndex` is called with duplicate operation facts at [`blocked-round15-activity-owner.test.js:72`](../tests/blocked-round15-activity-owner.test.js:72). | **BLOCKED**: no Operation projection exists, so latest-state dedupe is unobservable. No adjacent task/artifact owner is substituted. |
| AD-004 | Global search finds an in-progress Operation and returns its public SourceRef. | Search consumes visible public Operation facts only. | Public `searchFeatureIndex` is queried for `kinds: ['operation']` at [`blocked-round15-activity-owner.test.js:88`](../tests/blocked-round15-activity-owner.test.js:88). | **BLOCKED**: the current index has no Operation row. This is a reproducible product-gap packet, not a fixture dismissal. |
| AD-034 | Late edit release remains bound to the committed callback through a suspended candidate. | A candidate render cannot replace the committed Waiting owner. | Public `useWaitingEditingController` is driven with a real Suspense candidate and a late hold receipt at [`blocked-round16-public-owner.test.jsx:137`](../tests/blocked-round16-public-owner.test.jsx:137). | **PASS**: the original callback receives exact-hold `agent.unhold`; candidate callback receives none. |
| AD-039 | A newer committed interrupt supersedes editing without releasing its stale hold. | The stronger interrupt fact owns the freeze after supersession. | Public `useWaitingEditingController` starts an edit, commits a later interrupt, and inspects the owner at [`blocked-round16-public-owner.test.jsx:169`](../tests/blocked-round16-public-owner.test.jsx:169). | **PASS**: editing closes with the takeover notice and no stale unhold. |
| AD-074 | Every explicit capability-selector open can trigger another describe request. | Human action is not consumed by the automatic probe gate. | Public `useAgentProbes` first sends a describe request, then `selectorOpened()` and observes the next public request at [`blocked-round16-public-owner.test.jsx:190`](../tests/blocked-round16-public-owner.test.jsx:190). | **PASS**: two explicit describe sends are observed; no raw/private lifecycle call is used. |
| AD-327 | Ordinary requests show process summary and text/tool progress. | Process facts remain in the current turn presentation and do not leak internal turn IDs. | Public `useTimelineRowRenderer` renders both `hasTextProgress` variants at [`blocked-round16-public-owner.test.jsx:219`](../tests/blocked-round16-public-owner.test.jsx:219). | **PASS**: summary remains collapsed by default, tool progress is visible, and text progress appears when present. |
| AD-328 | Processing keeps one rolling activity line inside the Agent bubble. | Controls stay on the turn card rather than moving into the process presentation. | Public `useTimelineRowRenderer` renders one processing turn at [`blocked-round16-public-owner.test.jsx:233`](../tests/blocked-round16-public-owner.test.jsx:233). | **PASS**: exactly one Agent bubble owns the activity line. |
| AD-329 | A completed answer stays in the Agent bubble after the user request. | The answer is not promoted to a separate top-level message. | Public `useTimelineRowRenderer` renders a completed canonical turn at [`blocked-round16-public-owner.test.jsx:241`](../tests/blocked-round16-public-owner.test.jsx:241). | **PASS**: request precedes the answer in the same turn card. |
| AD-333 | Compact `agent.select` closure does not treat missing usage as a successful configuration. | Missing retained business detail is unavailable, not guessed. | Public `useTimelineRowRenderer` plus `terminal-result` renders `terminalClosureOnly` at [`blocked-round16-public-owner.test.jsx:252`](../tests/blocked-round16-public-owner.test.jsx:252). | **PASS**: unavailable detail is shown and the pruned model value is absent. |
| AD-335 | Same-author consecutive messages share identity while each fact remains focusable. | Identity grouping cannot merge separate message rows. | Public `useTimelineRowRenderer` renders two standalone rows at [`blocked-round16-public-owner.test.jsx:260`](../tests/blocked-round16-public-owner.test.jsx:260). | **PASS**: two focusable rows are retained and one is the continuation presentation. |
| AD-336 | An unknown sender remains identifiable without exposing the full actor ID. | Actor display fallback redacts the declaration/incarnation suffix. | Public `useTimelineRowRenderer` and actor-display fallback render an unknown sender at [`blocked-round16-public-owner.test.jsx:275`](../tests/blocked-round16-public-owner.test.jsx:275). | **PASS**: the middle actor segment is visible and the complete ID is absent. |
| AD-337 | Terminal-session lifecycle events do not enter either conversation scope. | Housekeeping is excluded from `ConversationPresentation`; real messages remain readable. | Public `ChannelReplica` plus `selectTimelineItems` commits one message and one terminal-session event at [`blocked-round16-public-owner.test.jsx:284`](../tests/blocked-round16-public-owner.test.jsx:284). | **PASS**: terminal session is absent from all/mine selections while the real message remains. |
| AD-338 | Channel activity does not appear as a conversation row. | System activity is retained in narration, not mixed with user/Agent messages. | Public `ChannelReplica` plus `selectTimelineItems` commits a system member event at [`blocked-round16-public-owner.test.jsx:297`](../tests/blocked-round16-public-owner.test.jsx:297). | **PASS**: the event is in narration and absent from conversation rows. |
| AD-340 | An Agent answer's absolute path opens in the current channel's controlled preview. | File paths are converted to a controlled reference; no free navigation is invented. | Public `MarkdownFileReferenceProvider` + `useTimelineRowRenderer` invokes the current-channel callback at [`blocked-round16-public-owner.test.jsx:308`](../tests/blocked-round16-public-owner.test.jsx:308). | **PASS**: the callback receives `{ path, line }` for the canonical path. |
| AD-341 | Nested actor work is not flattened into the top-level conversation. | The parent turn owns nested actor facts and their disclosure. | Public `ThreadCalls` through `useTimelineRowRenderer` receives a parent turn with one nested child at [`blocked-round16-public-owner.test.jsx:320`](../tests/blocked-round16-public-owner.test.jsx:320). | **PASS**: one top-level card is rendered and nested work is behind its parent disclosure. |
| AD-342 | A nested compact closure closes the call without rendering pruned result text. | Closure status cannot fabricate unavailable business output. | Public `ThreadCalls` + `terminal-result` renders a closure-only child and expands its public row at [`blocked-round16-public-owner.test.jsx:330`](../tests/blocked-round16-public-owner.test.jsx:330). | **PASS**: unavailable detail is shown and the retained result body is absent. |
| AD-343 | `parent_id` gives nested calls independent collapsed controls and depth. | Tree parentage remains causal and each child owns its own disclosure state. | Public `ThreadCalls` renders child and grandchild with parent IDs at [`blocked-round16-public-owner.test.jsx:342`](../tests/blocked-round16-public-owner.test.jsx:342). | **PASS**: both controls start collapsed, depths are `1/2`, and expanding one leaves the other collapsed. |
| AD-350 | Recipient chips can be removed individually and by Backspace from the editor start. | Each recipient remains an independent public draft fact. | Public `Composer` + `buildComposerModel` clicks one chip, rerenders the remaining chip, then sends editor Backspace at [`blocked-round16-public-owner.test.jsx:364`](../tests/blocked-round16-public-owner.test.jsx:364). | **PASS**: button removal and last-chip Backspace each route to the exact recipient ID. |
| AD-351 | A recipient removed from the roster remains visible and cannot silently fall back to the default Agent. | Missing recipient identity is a hard delivery guard. | Public `buildComposerModel` + `createMessageRequest` projects a missing recipient beside a valid selected Agent at [`blocked-round16-public-owner.test.jsx:383`](../tests/blocked-round16-public-owner.test.jsx:383). | **PASS**: delivery is `lost` and message construction rejects it; selected Agent is not substituted. |

## Ledger / boundary handoff

The ledger now records **283 PASS / 0 REGRESSION / 82 BLOCKED**.  The 82
remaining rows are not judged obsolete: AD-002–004 remain a capability gap,
and all other unresolved rows retain their prior owner/fixture classification.
Only `tests/blocked-round16-public-owner.test.jsx`, the round-16 report, and
the A–D audit ledger/verification reports are part of this packet.  No Feed,
terminal, node/restart, Workspace, vendor, package, lockfile, or production
owner file changed.
