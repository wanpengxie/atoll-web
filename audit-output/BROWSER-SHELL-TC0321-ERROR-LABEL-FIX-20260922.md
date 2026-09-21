# Shell — TC-0321 approval resolve error labels

Date: 2026-09-22
Exact product base: `e329ca5`
Red oracle: `a45942391581f2980c172df890349eb61d148957`

## Owner and authority

The public approval card receives a typed rejection from the existing
ConversationSurface resolve owner. The first presentation boundary is
`WireErrorLine` in `src/ui/timeline/TimelineRowRenderer.jsx`; it already
receives `{ code, detail }` and must not invent a second error state.

Before this fix it displayed every known code as raw `操作失败 <code>`, so
the fae contract's `not_in_audience` label (`收件人不在频道`) was absent.
The fix restores one `ERROR_LABELS` table in that existing renderer owner for
the documented terminal/resolve vocabulary. `WireErrorLine` uses the typed
label while preserving the protocol code and expandable detail. Unknown
codes still use the bounded generic `操作失败` label. No mock, backend,
protocol, state, store, or compatibility path changed.

## Verification

The exact a459423 browser oracle was executed against this product worktree
through a temporary hardlink (the hardlink was removed before commit):

```text
ATOLL_TEST_WEB_PORT=17144 ATOLL_TEST_MOCK_PORT=26144 \
npx playwright test tests/browser/tc0321-oracle.spec.js \
  --repeat-each=5 --workers=1 --reporter=line
```

Result: **5/5 passed**. The oracle covered the expired approval, all four
resolve rejections (`not_in_audience`, `request_not_found`, `already_closed`,
`forbidden`) with both localized label and raw code, and external resolution.

Focused unit result:

```text
npm test -- --run tests/approval-card-promise-boundary.test.jsx \
  tests/conversation-presentation-react.test.jsx
```

Result: **2 files / 2 tests passed**.

`npm run build`: **PASS** on the same worktree.
