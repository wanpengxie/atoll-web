# SZ-160 history generation owner contract

Date: 2026-09-21. Base: `380e263b5bf50a7e5e1559b4d3534e3e2f40ad4d`.

## Decision

**GREEN / current public-owner proof.** The user capability is that a
reconnected or replaced history generation can continue reading its own
history. A late EOF/exhausted result from the previous generation must not
silence the current generation's demand.

## User invariant and owner

The invariant is generation-scoped supply authority: an old promise may settle
its own request, but it cannot cache `exhausted` for a newer committed
generation. A subsequent current-generation history action must still reach
the current request port exactly once.

The unique public owner is:

`useConversationProjection` → `useHistoryConsumer` →
`viewport.onNearTop()` / `viewport.status.generation`.

The test does not introduce a second cursor/store and does not inspect private
refs or internal terminal caches.

## Public evidence

`tests/sz160-history-generation-owner.test.jsx` starts a deferred
generation-1 `onNearTop()` request, commits generation 2 with a distinct
history request port, then resolves the old request as `{ kind: 'exhausted' }`.
Calling the current generation's public `onNearTop()` reaches the generation-2
request exactly once; the old request is called only once. This directly proves
late old-generation EOF cannot suppress the current public obligation.

Focused verification:

```text
npx vitest run tests/sz160-history-generation-owner.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       1 passed
```

Only this test and audit report were added. No product source,
backend/protocol, vendor/package/lockfile, compatibility path, skip, or old
test was changed.
