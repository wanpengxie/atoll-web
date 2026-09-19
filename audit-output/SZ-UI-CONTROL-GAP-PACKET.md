# S–Z `ui.*` control and operation-receipt gap packet

Baseline files:

- `fae8b70/tests/ui-activity-overlay.test.jsx` — 6 cases.
- `fae8b70/tests/ui-words-hook.test.jsx` — 6 cases.

Both old imports fail because `src/ui/UiActivityOverlay.jsx`,
`src/app/hooks/useUiWords.js`, `src/model/ui-words.js`, and the old `fold.js`
request projection were removed.  I did not recreate any of them.  A source
search confirms that `TYPES.uiState/uiNavigate/uiOpen` remain vocabulary only;
there is no current public consumer that executes a `ui.*` request and sends a
resolve frame.  `WorkspaceLayout`/`ConversationSurface` now own Agent activity,
while Governance `OperationState` only reports its own panel command—neither
is an equivalent browser-wide `ui.*` operation stream.

## Case ledger

| Baseline case | User capability | Architectural invariant / current owner | Current result and disposition |
|---|---|---|---|
| overlay: empty entries render nothing | Do not show a stale or intrusive operation panel | A receipt surface must be driven by canonical UI-operation facts, not guessed local state | **待产品/架构决策【缺陷】** — no current receipt owner or input stream |
| overlay: describe navigation and file-open operations | User can tell what the browser actually did | `ui.navigate`/`ui.open` must map to product-language facts with their target details | **待产品/架构决策【缺陷】** — protocol words are never executed |
| overlay: failed operation exposes its reason | A failed request is visible and actionable, not silently dropped | Failure reason must survive the UI command owner to the receipt renderer | **待产品/架构决策【缺陷】** |
| overlay: last receipt expires after one minute | Transient receipts do not become permanent clutter | Expiry belongs to the receipt owner and must not mutate the ledger | **待产品/架构决策【缺陷】** |
| overlay: a new receipt restarts expiry | Recent work remains visible long enough to read | Receipt lifetime is keyed by the latest canonical operation, not mount count | **待产品/架构决策【缺陷】** |
| overlay: dismiss hides current batch but later receipt reappears | Dismiss means “seen”, not a permanent opt-out | Acknowledgement is per receipt batch and must not suppress future facts | **待产品/架构决策【缺陷】** |
| ui words: `ui.state` resolves with a current route snapshot | Agent can ask what this tab currently shows and receive a truthful snapshot | A single committed Workspace route/session is the read authority; response must correlate to request id | **待产品/架构决策【缺陷】** — no `useUiWords` successor |
| ui words: `ui.navigate` invokes channel/view navigation and resolves | Agent-directed navigation is observable and correlated | Navigation must go through the committed route owner, not a second local router | **待产品/架构决策【缺陷】** |
| ui words: repeated render does not execute one request twice | React rerenders cannot duplicate side effects | A request id needs a canonical execution/settlement fence | **待产品/架构决策【缺陷】** |
| ui words: rerender during an async action still resolves | An accepted UI action cannot disappear when the component rerenders | In-flight UI command ownership must outlive render candidates and settle exactly once | **待产品/架构决策【缺陷】** |
| ui words: navigation plus view applies both fields | Agent can atomically select a channel and feature view | One route commit owns the complete navigation tuple | **待产品/架构决策【缺陷】** |
| ui words: request for another session is ignored without a resolve | A command addressed to another tab cannot mutate or falsely acknowledge this tab | Session identity is part of the UI command authority | **待产品/架构决策【缺陷】** |

These are **12 explicit product-gap rows**, not skipped tests.  Rebuilding the
old hook/component, adding a compatibility fold, or changing the product to
make a recreated test pass would violate the migration contract.  Root needs to
choose whether `ui.*` remains supported, and if so assign a current route/command
owner before a successor test can be written.
