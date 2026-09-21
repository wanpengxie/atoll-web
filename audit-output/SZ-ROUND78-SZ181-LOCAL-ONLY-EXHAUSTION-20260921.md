# SZ-181 — local-only exhaustion and real supply progress

Date: 2026-09-21  
Base: `5f01af33508c08cc256b43277cf1844c8cee0945`  
Owner: `useConversationProjection` → `useHistoryConsumer` viewport; Feed
publishes source/generation/supply facts.  
Test: `tests/sz181-local-only-exhaustion-public-owner.test.jsx`

## Contract

For an empty local projection, a local-only `exhausted` result closes the
current supply obligation only. A history-demand revision or pending/idle
publication by itself is not new supply and must not replay the same
operation. A committed cache/frontier advance, source-lease replacement, or
Wire attach is real authority/supply progress and may reopen one current
underfill demand at a time.

## Evidence

The public `useConversationProjection` owner begins detached generation 0 with
`oldestSeq: 61`, `completedPages: 1`, and a zero-row Presentation. It emits
one anticipatory `projection-underfill` request. After a pending/idle demand
revision and a late `{kind: 'exhausted', localOnly: true}` completion, no
second request is emitted. Advancing the committed local frontier to
`completedPages: 2`/`oldestSeq: 41` reopens exactly one request. Changing the
source lease then causes one more current-source request, and attaching Wire
generation 1 causes the next one. The final public status is attached,
generation 1, source lease `1:3:10`.

Assertions use only `viewport.status` and the injected public request port;
private terminal refs, ledgers, and retired APIs are not inspected.

## Result

Focused Vitest: PASS (1 test), repeated 5/5. Adjacent SZ180/SZ191/history-
demand tests: PASS (4 files, 8 tests). `npm run build`: PASS (existing
chunk-size warning only). Product source unchanged.
