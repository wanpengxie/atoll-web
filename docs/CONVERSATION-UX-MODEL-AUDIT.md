# Conversation UX model audit

Date: 2026-09-17. Scope: read-only review of the current `refactor/conversation-frontend-r3`
working tree against `USER-INTERACTION-SPEC.md`, `CONVERSATION-FRONTEND-REBUILD.md`,
`CONVERSATION-IMPLEMENTATION-SPEC.md`, and the currently wired UI/model code. The working tree
is shared and dirty; line references describe the inspected snapshot and are not claims about an
older release. This audit did not change production code or tests and did not run the full suite.

## Current tracking index (2026-09-17 reconciliation)

This section is the current index. The original UX-01–05 findings below are retained as historical
evidence rather than renumbered or deleted. Their old "current chain" descriptions record the
failure that led to the repair; they are not claims that all five failures still exist in the
present working tree. Likewise, the 42 A–E trajectories and N01–N12 in
`CONVERSATION-ARCHITECTURE-SCENARIO-AUDIT.md` are design trajectories, while F01–F29 in
`USER-REPORTED-ISSUES-RECONCILIATION.md` are the user-feedback evidence index. Neither table is a
count of passing runtime tests.

The latest named UX integration slice is 40/40 focused jsdom, 6/6 production Chromium and a passing
build. Those results support A01/A02/A06/A08/A09 only as stated below; they do not close A03/A04/A05/
A07, the final Virtuoso geometry gates, a real-device gate or the full frozen suite.

Evidence levels used here:

- **closed on the named trajectory**: current source plus a focused behaviour result exists;
- **partial / failing**: some sub-trajectory passes, but a named counterexample or hard oracle is
  still open;
- **implementation present, acceptance incomplete**: the owner is wired, but required real
  browser/device/lifecycle evidence is narrower than the product contract;
- **delegated data audit**: kept in this index, but the parallel UX-data owner must supply the
  current conclusion rather than this foreground audit duplicating it;
- **source pending**: the conversation supplied the requirement, but no stable older F-number was
  found in the bounded F01–F29 table. It is not silently assigned a new historical number.

| Feedback group that must remain visible | Existing IDs / original evidence | Current owner | Current state and reproducible evidence | Next closing gate |
|---|---|---|---|---|
| 1. Enter with no messages or push; still load and follow new content | A01, A06, E08, N01/F29; F11, F27 | SyncSession, HistoryScheduler, availability projection | **Focused lifecycle and named cold three-state paths implemented; broad entry acceptance still incomplete.** App creates the initial interest; pending resumes across attach, a real new generation adds one only after prior fulfilment, and same-generation Meta adds none. Authoritative empty requires attached/current-generation Meta `head=0`, message current and local replica ready. Production-browser cold cache/no-cache/known-empty is 3/3 (about 385.6/109/126.4ms); protocol/filtered-only data no longer becomes false empty. | Preserve submit-free `channelMeta/history_before` reads. Add full permission/error/hidden paint-ready, non-exact bookmark fallback, real-service and rapid reconnect/channel-switch evidence. The foreground loading→readable transition is also open: a visual fade may not change logical identity, operability, screen-reader uniqueness or main-scroll coordinates, and must settle under duplicate facts, fast completion, channel switch and reduced motion. A visibility event is one lifecycle interest, not a render/head-change trigger; focused cold 3/3 is not full entry acceptance. |
| 2. Fast/slow history reading while live arrives; no pull-away, bounce or white frame; background preparation must not replace the foreground | B01, B02, B05, C04, D05, D06, E05; F05, F07–F09, F13–F17 | ReadingSession, HistoryScheduler reservoir/release, Presentation, list adapter | **Partial / failing; production has safely returned to Virtuoso.** Current C1/takeover4/4 and the tail-below +28 trajectory1/1 are green, but prepend compositor still paints one white frame in each of seeds4101–03. The stationary 3/3 chain identifies the direct boundary: measured-height coordinate correction runs before the new visible range/DOM is committed as one presentation. Final fuzz v3 also fails all three following-append fixtures with gap519 and both fold integrations with a large top jump; the fold total-height compensation path is known, but its per-failure correspondence is not yet signed. | Close stationary and moving prepend, semantic history units, below-anchor resize, initial restore and fold on one final committed Virtuoso source/hash. Neither an old pass, an old failure nor the rejected Legend result may be inherited without rerunning its real precondition. Background page readiness never authorizes foreground replacement. |
| 3. A→B→A, return to the middle of a long turn, scope/filter changes, late `selfId`, stale activation | A02–A05, C06; F18; historical UX-05 | ViewSession, Timeline scope/filter, ReadingSession activation, AppShell navigation | **Partial; identity/filter supply repaired, restore geometry open.** Member filters stay exact actor/stale-removable; only “@ me” follows the human principal across incarnations. Zero-projection supply follows the current filter to first match or authoritative EOF, aborts an old view obligation on filter change, and keeps the channel DOM key stable. Latest loading/filter Chromium3/3, unit64/64 and build are green; named UX Chromium remains 6/6. | Add the full App long-turn A→B→A route/account/permission journey and real mobile-drawer evidence. Current bookmark gate is red because the target is unmaterialized/Infinity. Preserve member exactness and never call a filtered physical batch empty before authoritative EOF. |
| 4. False new-message notification; mark read only from actually visible content | C06 plus later conversation regression (older F-number **source pending**) | Replica arrival identity, ReadingSession unseen set, channel read cursor | **Earlier UX-A09 3/3 is preserved evidence, but current integration is reopened.** Surface/activation/materialized-high-water filtering remains implemented; however the current 44-case slice catches explicit-latest clearing unseen before a real visible-tail acknowledgement. The old 3/3 cannot cover this new path. | Keep unseen until current activation and DOM report a real visible-tail ack; rerun hidden Files/Terminal, document visibility and explicit-latest together on the same source. |
| 5. User send returns to bottom; a late durable accept must not override a later upward gesture or A→B→A | C05, E01; F10 plus later conversation regression (**source pending**) | Composer acceptance token, Outbox, ReadingSession bottom intent | **Data and narrow send trajectory pass; complete browsing send is red.** Pure transaction, CDP repeat2 2/2 and data25/25 retain exactly one producer and no post-wheel write. The current full browsing case has intent1/write0, so narrow evidence does not close end-to-end return-to-bottom. | Jointly resolve target/height admission with the list owner; keep receipt/feed/retry unable to create intent, then rerun following, browsing-before-send and takeover on one source. |
| 6. Expand/collapse/latest/recycle, streaming text stability, native selection/copy and nested scrolling | B06, B08, D01, D02, E04; F06, F15; historical UX-02 | ContentPlan/Choices, Presentation latest authority and adapter retention | **Latest role chain is implemented and focused green; fold/content acceptance remains red.** Presentation candidate→ReadingSession exact authority→roleRevision has model37/37 and complete-App1/1. Current-entry/no-override expansion semantics are established, but public height acknowledgement is still integrating. A new stream→terminal body-key replacement breaks Selection/instance continuity. | Close role height acknowledgement, cache-first following/wheel and stream→terminal content identity; then rerun production fold. Cross-row recycle, active-tail mutation, nested scrolling and long-content resource gates remain open. |
| 7. Waiting layer keeps the established appearance; 32px reading gap; only user input/attachments/expansion resize the input stack; mobile keyboard/focus | D04, E02, E06, N12; F19–F25 | ConversationSurface/AppShell/WaitingLayer | **Floating layout is implemented; current integration remains unsigned.** Historical FINAL6 proved zero outer-rect drift and narrow CDP preserved gap2135, but current browsing send is intent1/write0 and the old waiting oracle/fuzz remain red. No current same-source complete following+browsing geometry signature exists. | Re-sign queued→running following/browsing geometry after list integration. That transition may fade the layer/body, but must retain one logical identity and exactly one operable, focusable and screen-reader instance; duplicate facts, fast completion, channel switch, off-screen and reduced-motion paths must settle without a body-copy portal, main-scroll animation or user-scroll freeze. Then add Android IME/keyboard, rotation, safe-area, hit testing and drawer-return evidence. |
| 8. Offline draft editing, persistence, durable acceptance, definitive failure and retry | D08, E01, N07, N08; F10; historical UX-03 | Composer, draft store, Outbox/submissions | **Delegated data audit; foreground permission copy is consistent.** UX-03's transport/edit-authority conflation was repaired in the AppShell path and has focused offline browser evidence. UX-A08 is also repaired: `access_denied` says cached content is hidden, matching the content gate and disabled durable/transmit authority (`offline-app-shell.test.jsx`). Definitive rejection, permission change and queued-intent recovery remain data-owner gates. Slow receipt blocking a consecutive send, loss of an older-batch error and a durable failure leaving a bottom intent are current W6 data gaps, not closed by the narrow send pass. | The data owner supplies current queue/retry/permission evidence and recovery affordance. Keep stable IDs and never call a local queue receipt a ledger confirmation; ordinary offline/member-stale must remain distinct from revoked access. |
| 9. Finished old tasks do not revive; permissions and actor incarnation apply; unknown does not permanently hide real current tasks | C03, E09, N05; F26 | canonical Replica fold, stateless WaitingPresentation, authoritative roster scope | **Named zombie chain closed; broader fidelity/operations remain open.** TaskEvidence/ControlDiscovery second authority is deleted. Current focused78/78, build/diff-check and production browser1/1 cover terminal-first→continuous history→mobile trim→older queued without revival. Consumer lifecycle coverage is separately scoped to StrictMode, A→B→A, unmount and closure40/40 with build/diff-check. Earlier7/89 and three browser passes remain rejected-path history. | Preserve this single-owner chain. Compact closure currently keeps lifecycle only, not terminal body/error summary; do not claim full content fidelity or all task/operation paths complete. |
| 10. Automatic `log.query` self-feedback storm; necessary describe/options/context automation may exist but cannot be high-frequency or self-triggering | incident, no older F-number (**source pending**) | App/useChannelFeed removal, canonical Replica/Waiting projection | **Incident closed at the offending path, broader rate contract retained.** `queryLog`/waiters, auto hook and TaskEvidence/discovery owners are deleted; Waiting is stateless and has no request/cursor/timer/retry. This does not authorize deleting legitimate foreground capability probes. | Regression counts protocol submits: history/live/head changes caused by Waiting remain zero-submit; each legitimate non-Waiting probe stays identity/generation scoped and bounded. |
| 11. One user intent and one geometry writer; no application compensation bypass or backend/library-source overreach | B02, B03, B05, N10; engineering constraints following F05/F17 | ReadingSession + one Virtuoso adapter issuer; scope governance | **Single adapter/writer retained; lifecycle publication is not closed.** The rejected Legend migration is historical. Current production uses Virtuoso with `followOutput={false}` and one explicit `root.scrollTo` writer. A current following intent may let that same issuer respond to a newly committed data/layout/viewport revision; “one owner” must not be misread as “one write for the lifetime of an intent”. User upward input or activation change revokes it immediately. ReadingSession/Timeline/initialLocation still publish owner refs during render, and initial readiness lacks activation+snapshot public-viewability→visible next-rAF proof. | Move owner publication to committed lifecycle, close the initial-ready token, then rerun continuity/paint/selection/send gates on the same frozen Virtuoso hash. Assert no duplicate write for one evidence revision and no write after takeover, not a blanket one-write cap. No earlier adapter result may be inherited. |
| 12. Evidence integrity: truncated mock/index-0, terminal-only fixtures, fake scrollbar drag, focused tests presented as full suite, or lost artifacts | X03 and explicit execution-process feedback; no single UX F-number | Test/evidence owner and root review | **Last frozen evidence is scoped; current tree needs rerun.** The most recent complete Vitest boundary was 289/289 suites and 843/843 tests, exit0, integrity4/4. Six-hash fuzz v3 was 1/7: three append gaps, two fold jumps and one browsing-send no-write failure. Both predate current W4/W5 production construction. | Re-run full unit, production browser, fuzz and build on one post-construction freeze. Keep prior unit and canonical send green scoped to their source hashes; the six fuzz failures remain valid counterexamples until displaced by a stronger same-oracle run. |

### Bounded omissions after reconciliation

The F01–F29 table covers the older fixed channel-history window, not every later message in this
long conversation. In particular the false-notification regression, delayed-accept send race,
`log.query` feedback storm, and several evidence-governance corrections do not have a verified old
F-number in that table. They are retained above as **source pending** rather than omitted or assigned
fabricated provenance. This pass did not query the live channel log, so it cannot claim that every
historical user message has now been recovered.

## Current foreground findings (UX-A)

### UX-A01 — Repaired: a saved actor filter remains visible and removable after incarnation change

**User purpose and action.** The reader selects one current Agent, leaves the channel, and later
returns after that Agent has restarted or the authoritative roster has replaced its incarnation.

**Foreground contract.** An explicit filter may change which content is visible, but the active
filter must remain named and removable. Background roster change may mark a choice stale; it may
not silently leave a hidden predicate that makes existing content look absent. Whether product
semantics should follow the declaration into a new incarnation or remain on the exact historical
actor is a separate decision.

**Original repaired chain.** `Timeline.jsx` restored full actor IDs from ViewSession and kept them in
the presentation key, but previously rendered controls only from the current roster. There was no
stale-filter chip, so an old ID continued filtering while no button could remove it, and the
zero-result copy misleadingly looked unfiltered. The current implementation preserves that exact ID
as a named removable stale predicate.

**Category / evidence.** Repaired foreground model/wiring defect. The product deliberately preserves
the exact historical incarnation rather than silently remapping it.

**Smallest correction and gate.** Keep every applied filter visible and removable. Once roster
authority is current, either (a) preserve the stale exact ID as an explicitly stale removable chip,
or (b) perform a separately specified declaration-based rebind while preserving the current reading
activation. Do not silently clear it merely because a cached roster is temporarily incomplete.
Regression: restore `{old-incarnation}`; publish a current roster containing only
`new-incarnation`; verify content is never presented as unfiltered/empty, the stale choice is
visible and removable, and an old roster response cannot overwrite a newer choice.

**Implemented checkpoint (2026-09-17).** Timeline now preserves the exact stale actor ID as an
explicitly stale, labelled, removable control; it neither remaps the incarnation nor silently clears
the saved scope. The zero-row copy names the stale filter instead of claiming an unfiltered empty
conversation. The focused restore/remove journey is green in
`tests/timeline-filter-presentation.test.jsx`, and the real Chromium persisted-restore/remove journey
is green in `tests/browser/ux-reading-evidence.spec.js`. A full frozen run remains separate evidence.

### UX-A02 — Repaired in focused paths: committed channel selection hands off focus without scrolling

**User purpose and action.** A keyboard or mobile user selects channel B from the directory and
continues reading without searching the page for where focus went.

**Foreground contract.** The title, ledger, input and details change together, and after the
committed channel handoff focus lands on the new channel heading or the message region without
scrolling that region (`USER-INTERACTION-SPEC.md:74,247-252`). Closing the directory is not itself
the destination focus.

**Original repaired chain.** AppShell already tracked a pending identity handoff and prevented
stale-channel actions, but originally had no focus effect on completion. Channel selection only
closed the mobile directory and the new heading was not programmatically focusable. The repair adds
one focusable heading destination and binds it to the latest committed user selection generation.

**Category / evidence.** Focused accessibility wiring omission repaired. Real mobile drawer and
reading-position acceptance remain broader gates rather than evidence that the wiring is absent.

**Smallest correction and gate.** Give the heading wrapper or message region a stable ref and
`tabIndex=-1`; after `pendingChannelSelection` resolves to the committed channel, call
`focus({preventScroll:true})` once for that selection generation. Do not focus during an abandoned
or superseded selection and do not call `scrollIntoView`. Verify click, keyboard shortcut, mobile
drawer, rapid A→B→A, unavailable target and back navigation; saved reading coordinates must not
change as a focus side effect.

**Implemented checkpoint (2026-09-17).** AppShell records the focus origin with the latest user
selection, focuses the committed heading once with `{preventScroll:true}`, and declines the handoff
when a third channel supersedes the request or the user has moved focus meanwhile. Initial/background
rerenders do not enter this path. Focused tests cover commit, rapid A→B→A and third-channel
supersession; real mobile drawer and replacement-adapter reading-position evidence remain final-run
gates.

### UX-A03 — Fold acceptance still measures the button, not semantic continuation

**User purpose and action.** The reader previews a long turn, expands it to continue reading, then
collapses it. This is a user-authorized layout change, so preserving every screen coordinate is not
the requirement.

**Foreground contract.** The fold choice and content identity survive recycling/latest changes;
after the necessary layout change, the preview/reading target remains understandable, the body and
toggle remain reachable, selection/focus is not spuriously cleared, and the next wheel gesture
moves the real list.

**Current chain and evidence.** Choices are durably keyed outside the row lifecycle
(`Timeline.jsx:711-717,777-805,944-951`), which is a real implemented owner. The browser test in
`f3-message-fold.spec.js:21-111`, however, defines success as the clicked button staying within one
pixel. The latest production result still fails that mechanical oracle after the row itself is
stable because total list/clamp geometry moves the row (`CONVERSATION-EXECUTION-REVIEW-LEDGER.md:766-768`).
That failure cannot be relabelled either “all fold UX broken” or “authorized layout, therefore pass.”

**Category / evidence.** Known component-geometry failure plus acceptance-model gap.

**Smallest correction and gate.** Keep the current failure; add a semantic oracle based on the
preview text point/button/body relationship, focus, selection and next-scroll reachability. Specify
which point is retained for expand and collapse, then require the chosen adapter to meet it without
an application `scrollBy`, frozen body or guessed height.

### UX-A04 — Streaming selection is proven only while selected DOM survives, not across the full recycle contract

**User purpose and action.** The reader selects and copies across a long/streaming answer while live
text continues and scrolling can move an endpoint out of the ordinary virtual window.

**Foreground contract.** Unchanged selected text nodes and the actual copy result remain stable;
stream growth cannot re-enter following; an implementation that retains active endpoints must have
a separate bounded resource budget.

**Current chain and evidence.** ContentPlan unit evidence is 6 files/42 tests. A dedicated real
Chromium fixture is 2/2: during stream tail append and prepend the unchanged block's Selection
endpoint/text/block nodes remain the same and connected, Control+C followed by
`navigator.clipboard.readText()` returns exactly `sealed`, and after unmount/away edit/width reflow
the context resolver returns to the target passage. This signs the named non-recycled content and
semantic-resolver paths, not arbitrary virtual-row retention. An earlier Virtuoso freeze's real
selection-autoscroll trajectory retained non-empty selection and browsing mode
(`reading-viewport.spec.js:318-369`), but that result is not inherited by the final rollback source;
no current proof retains endpoints across arbitrary recycling with a bounded resource budget.

**Category / evidence.** Acceptance gap, not a newly observed production failure.

**Adapter capability record and current contract.** Virtuoso 4.18.13 exposes stable item keys,
`itemsRendered`/`rangeChanged`, pixel/count overscan, and the ordinary rendered item wrapper. It does
not expose a public per-item pin/always-render key. Native `Selection` cannot retain an endpoint whose
DOM node has been removed. Therefore stable keys and the current six-item top buffer cannot honestly
prove arbitrary-span B08, and this audit does not invent a hidden pin service.

The minimum acceptance trajectory on the current Virtuoso component is: select and copy within one long
presentation unit, then across three adjacent units while dragging in both directions; keep both
endpoint nodes connected for the bounded active-selection window, preserve the exact clipboard text,
remain in browsing, and return to the normal DOM bound after selection ends. Exercise Virtuoso's
committed range/materialization callbacks as independent recycle evidence rather than assuming a
buffer retained the endpoints. If either endpoint crosses that bounded window, the adapter has a recorded
capability gap: the product may not silently clear or corrupt the selection, while permanent/unbounded
overscan is not an admissible fix. Closing the arbitrary-span requirement needs an explicit adapter or
component capability decision, not a larger constant presented as proof.

### UX-A05 — Mobile keyboard handling has a clear owner but no visual-viewport/device proof

**User purpose and action.** On a phone, the reader focuses the editor, uses IME, grows a reply,
rotates, closes the keyboard and returns through the channel directory.

**Foreground contract.** The input and required controls remain in the effective visual viewport;
the waiting layer does not resize the input; hidden zero-size phases do not reset reading state;
focus returns without scrolling the saved reading point.

**Current chain and evidence.** `ConversationSurface.jsx:28-59` observes the committed layout box and
input stack; it has no `visualViewport` integration. The current bounded test inventory exercises
desktop/headless viewport sizes but the execution ledger still lists real Android touch/inertia as
missing (`CONVERSATION-EXECUTION-REVIEW-LEDGER.md:651,675`). The same gap applies to the software
keyboard and safe-area trajectory.

**Category / evidence.** Explicit verification/acceptance gap. Absence of a `visualViewport`
listener alone is not proof of a broken browser layout because modern dynamic viewport CSS may
resize the owning Surface correctly.

**Smallest correction and gate.** First collect real Android (and, if supported, iOS) focus/IME
evidence: effective visual viewport, composer/buttons hit-test, reading-slot height, saved semantic
anchor and focus target through open/type/resize/rotate/close/directory-return. Only add a viewport
bridge if that evidence shows the owning Surface is not resized; do not introduce a second list
geometry writer.

### UX-A06 — Repaired: settled acknowledgement and conversation filtering are separate actions

**User purpose and action.** A settled indicator appears on an Agent. The reader activates the
control whose accessible title says the Agent has completed and asks them to confirm it.

**Foreground contract.** Acknowledging an activity notification changes notification state only.
Changing the actor filter is a separate, explicit view action and may legitimately create a new
filtered reading identity. Neither internal activity state nor acknowledgement is navigation intent.

**Original repaired chain.** The old actor button became the acknowledgement target when activity
settled, then the same click also toggled the actor ID in `actorFilter`. That changed `messageListKey`
and the visible projection, so clearing an indicator could replace the conversation view and its
ReadingSession activation. The current actor control is filter-only and the adjacent labelled
acknowledgement control is acknowledgement-only.

**Category / evidence.** Repaired intent-model and UI-wiring defect. Upstream activity correctness
remains a separate data fact.

**Smallest correction and gate.** Give notification acknowledgement and filtering separate labelled
actions. Acknowledge-only must preserve the filter set, list identity, bookmark and focus; filter-only
must not silently acknowledge a settled event. Test settled-active/off, settled-active/on, keyboard
activation and a late activity update during the click.

**Implemented checkpoint (2026-09-17).** Each current actor now has a filter-only control and, when
settled, a separate labelled acknowledgement control. Keyboard acknowledgement preserves the filter
set and list DOM identity; filtering does not acknowledge. The focused pointer/keyboard regression is
green. The live-feed handoff now preserves its attached generation, and the real Chromium journey
reaches active→settled→ack through the independent control while preserving the filter state and list
identity. Its before/after JSON evidence is attached before the hard identity assertions. The
generation-provenance tracker regression is 20/20, this production Chromium A06 journey is 1/1, and
the related F7 activity/reconnect/mobile set is 6 items green; these named paths do not replace a full
adapter/browser acceptance run.

### UX-A07 — Long-turn return restores a row offset, but does not consume the saved semantic text point

**User purpose and action.** The reader leaves channel A from the middle of a long turn, the layout
or that turn's formatting changes while away, and the reader returns to continue from the same
surviving passage.

**Foreground contract.** With unchanged layout, restoring the same row-local offset is sufficient.
After a width/font/content reflow, restoration should resolve the saved stable block/text evidence
to the same surviving semantic point or a documented nearest fallback. A late restore cannot
override new user input.

**Current chain and evidence.** `visibleBookmark` records row identity plus `blockID`, `textOffset`,
text context and `textViewportOffset` (`MessageList.jsx:121-162`). Production `initialLocation`
selects the saved/successor/predecessor row and applies only `rowViewportOffset`
(`MessageList.jsx:190-217`). No production restore consumer reads the saved block/text fields. The
long-block browser fixture proves same-layout A→B→A (`reading-lifecycle.spec.js:183-193`); it does
not reflow the block while away. Therefore that green result proves row-interior restoration under
stable layout, not semantic text-point restoration after reflow.

**Category / evidence.** Confirmed implementation gap for the reflow case; no claim that ordinary
same-layout A→B→A currently fails.

**Public capability and smallest real contract.** Virtuoso's public initial input accepts an item
index/alignment/pixel offset; `restoreStateFrom` restores a snapshot only against the same data and
measurements; `scrollToIndex`/`scrollIntoView` are item-level commands. None accepts a block ID or text
offset. Thus the existing one-shot `initialTopMostItemIndex` can close same-layout row-interior return,
but cannot by itself close semantic restoration after width/font reflow. The already captured block
and text context is useful evidence, not proof that the adapter can consume it.

The minimum current contract is: same-layout return restores the exact row-local offset; after reflow,
the same surviving row/block must be in the initial readable window (never latest merely because its
old pixel offset is invalid), and deleted targets use the documented successor/predecessor/nearest-seq
fallback. Exact semantic text-point placement remains an explicit capability gap unless the chosen
adapter can perform one activation-scoped, public, user-cancellable refinement through the existing
single issuer after that row is committed. Such a refinement would need a separate design decision
because the current specification forbids mounting at a wrong position and correcting it later; this
audit neither creates a second positioning service nor declares a late scroll legal by fiat. Gate the
same-layout, width/font reflow, sealed-prefix growth, deleted block/row and input-during-restore cases
separately so the achievable row contract cannot masquerade as the unimplemented text contract.

### UX-A08 — Repaired: revoked access consistently says cached history is hidden

**User purpose and action.** The reader is in a channel when access is revoked and needs one
unambiguous explanation of what remains visible and how to recover.

**Foreground contract.** Permission revocation outranks position preservation and removes cached
channel content from display. The banner and main surface must describe the same state; ordinary
transport loss is a different mode that may retain cached reading.

**Original repaired chain.** `ACCESS_MESSAGE.access_denied` said “历史缓存仅供本地查看” while
`canViewChannelContent` excluded `access_denied` and AppShell replaced Timeline with the inaccessible
surface. The hiding behaviour matched the permission-first contract; only the banner contradicted it.
The current banner says cached content is hidden until access is restored.

**Category / evidence.** Repaired single-point presentation bug. The permission gate was not weakened.

**Smallest correction and gate.** Change the access-denied banner to say that cached channel content
is hidden and state the available recovery path, if any. Render every access mode once and assert
that banner, content visibility, editor state and recovery action are mutually consistent; ordinary
offline/member-stale remains separately readable.

**Implemented checkpoint (2026-09-17).** The access-denied banner now says cached content is hidden
until permission is restored. The content gate and disabled durable/transmit authority are unchanged;
the focused AppShell access render is green. This does not weaken ordinary offline/member-stale
cached reading.

### UX-A09 — Repaired on named paths: read acknowledgement is bound to visible materialized evidence

**User purpose and action.** The reader is at the tail, opens files or leaves the browser in the
background, live content arrives, and they later return. Only content actually presented in the
message Surface may clear its viewport notice or advance the channel read cursor.

**Original repaired chain.** The former hook converted anything except explicit
`surfaceVisible:false` to true and derived its acknowledgement high-water from the newest entire
snapshot rather than from the DOM that produced `atTail`. A new Presentation revision could therefore
combine old tail geometry with a newer, not-yet-materialized row. The current hook fails closed and
the production adapter reports a high-water from committed row DOM.

The old saved evidence also had no Surface invalidation. On compact/mobile layouts, files or terminal
hide the parent message pane while leaving Timeline mounted, so a document-visible event could reuse
old tail evidence. The repaired unseen ledger now retains identity→sequence boundaries; AppShell
publishes coverage explicitly and the hook clears only identities covered by the same visible,
installed high-water.

**Category / evidence.** Owner/evidence-model defect repaired on its deterministic hook and production
browser trajectories. Final Virtuoso lifecycle plus additional Terminal/document/mobile variants remain
acceptance work, not a claim that the original fail-open implementation is current.

**Smallest correction and gate.** An acknowledgement must carry explicit `surfaceVisible===true`, the
activation plus Surface visibility generation, and an installed/materialized high-water captured by
the same committed observation. Entering hidden/covered/zero-size state invalidates that evidence;
returning visible requests a fresh observation and does not itself mark read. Clearing the local
stable-identity unseen set must be bounded by the same evidence (or recomputed against identities at
or below its installed sequence), not precede a narrower cursor update. Deterministic regressions:
new snapshot/old DOM tail, files-covered mounted Timeline, document hide→live→show before a new list
observation, missing visibility field, and a later fresh visible-tail observation. Assert both local
`unseenKeys` and the durable cursor, not only the `markRead` mock call.

**Implemented checkpoint (2026-09-17; adapter migration must preserve it).** The hook now treats a
missing visibility fact as false. Each observation carries `installedHighSeq` computed from the row
IDs actually materialized in that committed DOM, rather than the newest whole snapshot. Following
arrivals enter the stable-identity unseen ledger with their latest sequence; a visible-tail
observation removes only identities at or below its installed high-water, so a later terminal update
of the same identity is not cleared by an older frame. ViewSession persists that key→sequence bound
across A→B→A instead of retaining identities without an acknowledgement boundary. Compact/mobile files or terminal coverage is
published explicitly from AppShell and invalidates the saved tail evidence; returning visible alone
does not acknowledge it. Focused ReadingSession tests cover missing visibility, new snapshot/old DOM,
hidden arrival/show-before-observation and same-identity newer-seq. The current Virtuoso adapter emits
the same explicit fields, and three real Chromium journeys cover Files-hidden arrivals, stale
activation isolation, and history/replay/reconnect/filter/channel-switch false-unseen resistance.
Terminal coverage, document background/foreground and a full frozen run remain separate acceptance
gates.

## Historical first-pass result (retained)

Adapter caveat for these original IDs: UX-01 and UX-02 were closed on their named unit plus real
Chromium trajectories on an earlier Virtuoso freeze (`CONVERSATION-EXECUTION-REVIEW-LEDGER.md:711`).
Those results preserve the repaired intent model but do not automatically close the final Virtuoso
rollback source; the same observable journeys must be rerun. UX-04 and UX-05 are closed on
their named focused render trajectories (`ibid.:713`); UX-03's ordinary transport-offline editor and
durable-queue path has focused unit/browser evidence, while definitive rejection and permission
transition remain in the parallel data audit. The prose below stays unchanged so the original cause,
owner and regression oracle are not lost.

The first bounded pass found two fully closed reading-intent failures and three high-risk product
state mismatches. The two reading failures share a specific boundary error: an input event is
promoted to product reading intent before the main scroller proves it consumed the input. UX-03's
offline-edit violation and UX-04's contradictory empty assertion are direct static consequences.
UX-05's semantic mismatch/remount is direct, while the eventual visible jump is conditional on the
saved reading state and timing and still needs its proposed browser trajectory.

These are not reasons to restore the deleted multi-writer scroll controller, invent arbitrary
message navigation, or weaken the durable submission model. Each repair belongs at the owner
boundary named below.

## UX-01 — An unconsumed downward gesture at the real tail disables live following

**Normal trace.** The reader is following and already at the physical tail. A trackpad/wheel emits
a downward delta (including ordinary overscroll at the bottom), but `scrollTop` cannot increase.
A live message arrives afterwards.

**Expected.** A gesture that produces no main-list movement does not express “browse away from the
tail”. The reader stays following and the next live message remains visible. This follows the
rebuild contract that only effective movement reaching the tail grants following and that a real
upward input must synchronously revoke an old follow grant
(`CONVERSATION-FRONTEND-REBUILD.md:74-80,117-120`).

**Historical failure chain (former Virtuoso adapter).**

1. `src/ui/timeline/MessageList.jsx:582-584` sends every non-zero wheel delta to `takeControl`,
   before observing any movement.
2. `MessageList.jsx:512-550` calls `owner.onUserControl` immediately. When previously following it
   even does so in `flushSync`, then records the new input epoch.
3. `src/model/reading-session.js:77-90` unconditionally switches to `browsing`, clears the bottom
   intent, and retains only `tailEvidence` for a `newer` gesture.
4. Recovery requires an observation with `atTail`, `source === 'user'`, the same input epoch, and
   the exact geometry revision (`reading-session.js:93-116`). A bottom overscroll has no changed
   `scrollTop`, therefore no qualifying `scroll` callback. `scrollend` records `settled`; range,
   resize, and layout callbacks record `layout`. None can restore following.

There was no alternate observation path in that adapter snapshot that disproved this chain. The
existing downward-wheel browser coverage reaches the tail through real motion; it does not cover
an already-at-tail zero-displacement gesture.

**Category.** Model error: raw input is treated as completed user navigation.

**Smallest owner correction.** Separate *pending input ownership* from a committed reading-mode
transition. An `older` input while following must still synchronously revoke pending application
follow so an append cannot pull against the user. A `newer` input should only commit browsing/tail
re-entry from an observed main-scroller movement; if the gesture ends with zero displacement and
the prior state was following, preserve following. Do not turn this into a generic “cancel all
component work” operation.

**Acceptance oracle.** At-tail downward wheel with zero `scrollTop` delta keeps the same following
authority and the next live append stays visible; downward movement from above the tail reaches
following; upward input revokes following in the same input turn; a nested scroller changes neither
epoch nor mode. Interleave a geometry revision to prove stale tail evidence cannot grant following.

## UX-02 — Mouse text selection is classified as list navigation and can re-enter following

**Normal trace.** While browsing old messages, the reader drags across text and beyond the lower
viewport edge to select/copy several rows. The browser autoscrolls the main list during selection;
the drag eventually reaches the physical tail. A live message then arrives.

**Expected.** Selection/copy keeps the user in browsing mode; selection-time autoscroll must not
grant live following, and ending the selection must not jump to the tail
(`CONVERSATION-FRONTEND-REBUILD.md:120`, `CONVERSATION-IMPLEMENTATION-SPEC.md:253`).

**Historical failure chain (former Virtuoso adapter).** `MessageList.jsx:653-663` recorded every
left-mouse content pointer-down. The
first movement over three pixels calls `takeControl` based only on pointer Y. There is no
`selectstart`/`selectionchange` ownership in `MessageList` or `ReadingSession`. A downward text drag
therefore creates `newer` tail evidence; native selection autoscroll is then accepted by the normal
scroll handler as matching user movement and can satisfy `observeReading` at the tail. That clears
the bookmark/unseen state and permits the next live append to follow.

The current C2 test (`tests/browser/reading-viewport.spec.js:349-359`) creates a DOM Selection
programmatically after scrolling and verifies append stability. It does not exercise pointer drag,
selection autoscroll, or reaching the tail during selection, so its green result does not cover
this trajectory.

**Category.** Input-ownership model error and acceptance gap.

**Smallest owner correction.** Give text selection an explicit, short-lived input owner. A drag
starting in selectable message content may ensure browsing, but must never produce tail-follow
evidence. Do not infer reading direction from pointer Y alone. Preserve a separate path for an
actual scrollbar-thumb drag/pan so normal navigation can still enter following when real movement
reaches the tail.

**Acceptance oracle.** Create a real DOM Selection by pointer-dragging across at least three rows,
autoscroll to the tail, then append. Mode remains browsing, selected text and copy result remain
stable, and no application bottom write occurs. Separately prove scrollbar drag to the tail still
enters following.

## UX-03 — Transport loss disables editing even though the product and Outbox support offline drafts

**Normal trace.** A member is composing when the wire reconnects, or opens a cached channel while
offline. They continue editing; optionally they submit text for local durable queuing and wait for
reconnect.

**Expected.** Cached browsing and draft editing remain available offline
(`USER-INTERACTION-SPEC.md:213-215`). The rebuild makes transport state orthogonal to reading and
draft state (`CONVERSATION-FRONTEND-REBUILD.md:91,108`) and explicitly defines “offline can save a
local intent” followed by `draft → durable-queued → transmitting`
(`CONVERSATION-FRONTEND-REBUILD.md:299-301`). The stronger “click Send while offline” behaviour is
therefore supported by the approved durable-submission design and current implementation, not
inferred merely from the existence of an Outbox. If product owners intend offline editing without
offline acceptance, that narrower boundary must be made explicit and must still remove the current
editor lock.

**Current chain.** `src/app/AppShell.jsx:120` defines `writeDisabled` as “wire is not open **or** no
write access” and passes it directly to Composer at `AppShell.jsx:351`. Composer consequently calls
`editor.setEditable(false)` (`src/ui/Composer.jsx:627-632`), rejects submit at line 715, disables
file/drop/paste entry at lines 876-910, and disables the send button at line 1025. The visible
message says the draft is retained, but the user cannot keep editing it.

The lower layer already distinguishes durable acceptance from transmission:
`src/app/hooks/useSubmissions.js:328-377` writes queued submissions whether or not the wire is open;
only line 374 gates immediate transmit, and lines 379-382 transmit queued records on reconnect.
Thus a green durable-Outbox suite does not prove the normal UI exposes the promised offline path.

**Evidence level/category.** Confirmed UI wiring deviation for offline editing: transport is
conflated with edit authority. Durable offline acceptance is also the current approved model, but
its exact user affordance should remain a named product boundary rather than an accidental Outbox
side effect.

**Smallest owner correction.** Split `canEditDraft`, `canDurablyAccept`, and `canTransmit`.
Principal/channel ownership and known access determine draft editing and durable acceptance; wire
state only controls immediate transmission and the queued status. Keep live-upload attachments
separately disabled when their data path truly requires connectivity. Permission revocation,
observer access, retirement, and unknown identity must remain blocked rather than being mistaken
for ordinary offline state.

**Acceptance oracle.** Disconnect a writable member: existing text remains editable and persists;
submitting text creates a stable queued Outbox record and no protocol frame; reconnect transmits
that exact ID once and reconciles it. Revoke permission in the same scenarios and prove submit is
blocked. Verify attachment affordances accurately distinguish a durable local attachment from a
live-only upload.

## UX-04 — `rows.size === 0` is rendered as an authoritative empty ledger

**Normal trace.** First entry has no local cache while attach/tail history is still pending, has
failed, or the client is offline. The Replica currently has zero rows.

**Expected.** Show an unknown/syncing/error state. Only authoritative currentness/coverage may
declare the channel empty. The specifications explicitly separate
`unknown/partial/readable/empty-known` and state that “not yet loaded” is not empty
(`CONVERSATION-FRONTEND-REBUILD.md:92-95`; `USER-INTERACTION-SPEC.md:133`).

**Current chain.** `src/ui/Timeline.jsx:1130` renders “这本账还没有可见条目 / 从下方编辑器开始”
solely when `state.rows.size` is zero. Loading and failure notices at lines 1138-1139 are independent,
so the UI can assert empty while simultaneously saying it is reading history or reporting an error.
During initial reading calibration, `MessageList.jsx:812-816` independently renders “正在恢复上次
阅读位置…” or an empty region; it does not suppress the sibling empty-ledger assertion. Thus the
current render tree can visibly pair “empty” with initialization/loading/error rather than merely
holding an incorrect internal flag.
By contrast `src/ui/timeline/useReadingSession.js:128-169` already receives attach, generation,
message-current, head, sync, and presentation-currentness evidence. The missing piece is a product
availability state, not more row inspection.

**Evidence level/category.** Confirmed contradictory render condition; product-state inference from
component/store shape. The precise first-load duration is environment-dependent, but the condition
does not require a race to exist.

**Smallest owner correction.** Derive and render an explicit availability state such as
`unknown | syncing | readable | empty-known | error | offline-with-cache` from the history/Replica
owner. Render the invitation-to-send empty state only for `empty-known`; keep readable cached rows
during retry/error.

**Acceptance oracle.** Cover slow first entry with no cache and no push, offline/no-cache,
attach failure with retry, readable cache while freshness is offline, and a genuinely empty attached
channel. The word “empty” may appear only in the last trajectory.

## UX-05 — Late self-identity silently changes a default filtered view and its reading activation

**Normal trace.** Refresh into a channel with cached content while the roster/self mapping is
delayed. The reader begins reading old content before `selfId` arrives.

**Expected.** Identity pending is visible and must not masquerade as the “Mine” result. A background
identity fact must not count as an explicit user view/navigation decision. If the visible result set
must change, preserve a semantic anchor or wait for the identity boundary; explicit scope changes
may create a new view activation. The product spec also forbids opening send merely because the
roster has not arrived (`USER-INTERACTION-SPEC.md:133`).

**Current chain.** The saved/default preference is `mine` (`src/model/view-session.js:4-10`), but
`src/model/timeline-scope.js:228-231` returns every entry when `selfId` is absent. The scope control
is hidden until self identity exists (`src/ui/Timeline.jsx:1094`), so the screen behaves as “All”
without naming that fact. When `selfId` arrives, it changes `messageListKey`
(`Timeline.jsx:715-734`), the ReadingSession `viewKey` (`Timeline.jsx:761-766`), and the keyed
MessageList (`Timeline.jsx:1140-1143`). `useReadingSession` creates a different controller for that
key (`src/ui/timeline/useReadingSession.js:119-125`), whose absent saved state defaults to following.
The result can silently filter cached rows, discard the reading activation/bookmark, and initialize
at latest.

**Evidence level/category.** Confirmed semantic mismatch and activation replacement: bootstrap
identity is treated as view semantics. The specific visible “jump to latest” is a high-risk,
reachable consequence, not yet a browser-observed failure; it depends on whether the newly keyed
view has a saved reading record and on commit timing.

**Smallest owner correction.** Model `identityPending` explicitly. Do not publish a “Mine” result
before self identity is known. Either hold that view in a pending state, or deliberately show a
labelled All view until identity resolves and then perform an anchor-preserving semantic rebase.
Only an explicit user scope/filter action should be treated as a fresh navigation intent. Keep send
authority separately gated by known identity/access.

**Acceptance oracle.** Delay self identity while loading a cached mixed-actor channel; scroll into
old content, then resolve identity. The UI never labels All data as Mine, does not silently remount
to latest, preserves the semantic reading point, and retains the draft. Explicitly selecting Mine
still creates the intended filtered view.

## Historical requested-dimension coverage

| Dimension | Current audit result |
|---|---|
| First entry / cache / disconnect | UX-03 and UX-04 confirmed. Cache ownership and existing rows are preserved by the inspected paths; no claim here that every cache failure is correct. |
| Following / unread | UX-01 confirmed. Stable arrival identities and the Composer send token are present in current code; this pass found no evidence that the previously fixed false-arrival/send-to-bottom regressions remain. |
| Send / attachment / draft / async accept | Durable draft acceptance, stable IDs, and reconnect transmission exist; UX-03 makes that capability inaccessible while offline. Attachment records are persisted with the draft in current Composer wiring; offline binary-upload policy still needs an explicit product decision/test. |
| A→B→A / routes / filters / permissions | Activation and async send-token invalidation are present. UX-05 is a distinct late-identity transition. No current evidence found that an old A send completion writes into new A. |
| Fold / selection / copy / nested scrolling | Fold choices are keyed outside mount lifecycle and nested-wheel ownership has direct browser coverage. UX-02 remains because current selection coverage is programmatic, not a real pointer/autoscroll trajectory. |
| Mobile keyboard / focus / layout | `ConversationSurface` measures the committed Surface/input stack and CSS keeps one mounted mobile Surface. However the current source has no explicit `visualViewport` integration while the implementation spec assigns keyboard visual viewport/safe-area changes to Surface. This is a **verification gap**, not a confirmed bug without real Android/iOS keyboard evidence. |
| History supply / failure / retry | Scheduler has bounded automatic retry and the Timeline exposes loading/error. There is no explicit retry control in the inspected Timeline, but U16 can be satisfied by owner retry; whether terminal errors require a user action is **unconfirmed product/acceptance scope**, so this pass does not report it as a bug. |

## Historical regression priorities

1. Lock UX-01 before adding more follow heuristics; its failing oracle is deterministic and does not
   depend on Virtuoso internals.
2. Add the real pointer-selection oracle in UX-02. The current programmatic Selection test should
   remain, but cannot substitute for it.
3. Test UX-03 through AppShell, not only Outbox hooks; otherwise a durable model can stay green
   while the product path is disabled.
4. Make availability and identity-pending states observable in fixtures so UX-04/05 do not regress
   to row-count or field-presence guesses.

These corrections do not require backend protocol changes, a virtual-list fork, production
deployment changes, or reinstating application pixel compensation.
