# SZ-183 — same-source supply advance revalidates an immutable bookmark target

Date: 2026-09-21
Base: `54111bfb7803bfba91d07c7151bfddf492a53afd`
Owner: `useConversationProjection` → `useHistoryConsumer` viewport; Feed
publishes the committed source/generation/supply facts.
Test: `tests/sz183-bookmark-supply-advance-revalidate.test.jsx`

## Contract

While a saved initial-view bookmark is being restored, progress from the
same current source may reopen the restore obligation after a late attempt
settles. That progress must not replace the immutable bookmark target or
create a duplicate request while the first operation is pending. A reopened
request must carry the same public target identity and visible-coverage
requirement, and the saved session bookmark must remain unchanged.

## Evidence

The test drives the public `useConversationProjection` owner with an empty
Presentation, attached generation `1`, source lease `1:3:10`, and a saved
bookmark `{messageID: "saved-target", seq: 3, rowViewportOffset: 8}`. The
first `initial-view` request is kept pending. The same source then advances
from `completedPages: 1`/`oldestSeq: 61` to
`completedPages: 2`/`oldestSeq: 41` with eight buffered rows; no duplicate is
issued while the first operation is pending. When the late first result is
`{kind: "exhausted"}`, exactly one current retry is emitted with the same
`targetSeq: 3` and `requiredVisibleCoverage` for `saved-target`, and the
public session bookmark remains unchanged.

Assertions use only the public viewport status/session and injected request
port. No private refs, operation ledgers, internal stores, or retired APIs
are inspected; product source is unchanged.

## Result

Focused Vitest: PASS (1 test), repeated 5/5. Adjacent SZ180/SZ191/history-
demand tests: PASS (4 files, 8 tests). `npm run build`: PASS (existing
chunk-size warning only).
