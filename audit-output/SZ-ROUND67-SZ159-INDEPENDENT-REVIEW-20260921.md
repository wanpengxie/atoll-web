# SZ-159 independent review: suspended candidate status evidence

Date: 2026-09-21. Reviewed commit:
`7070f2591ce1897b891bd04c1c805b06129ec705`.

## Initial review decision

**REJECT (evidence-only, before revision).** The original test assigned
`candidatePort = committedPort` immediately after the suspended B render and
later asserted that alias was still owner A. That did not observe public
`status` or EOF state while B was suspended, so it could not independently
prove that B's `hasOlder: false` had not polluted A.

## Minimal test-only revision

The revised test keeps the same public owner and no product changes. During
the actual suspended B transition it now observes the still-committed public
viewport directly and requires:

- `viewport.status.generation === 1` and `hasOlder === true` (owner A facts);
- `viewport.historyBoundary === null` (candidate B's semantic EOF is not
  published);
- `viewport.availability === 'readable'`.

The fixture supplies a settled public sync observation so `hasOlder: false`
would produce a real public `historyBoundary` if candidate B committed. The
test no longer uses the `candidatePort` alias. It then commits the replacement
frame, resolves the old request as `exhausted`, and verifies the current
request port is not suppressed and the suspended candidate request is never
called.

The unique owner remains:

`useConversationProjection` → `useHistoryConsumer` → public viewport
`status/historyBoundary/onNearTop`.

## Revised verification

```text
npx vitest run tests/sz159-history-owner-suspense.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       1 passed
```

This review changes only the SZ-159 test and this audit report. No product
source, backend/protocol, vendor/package/lockfile, skip, compatibility path,
private export, or second cursor/store was changed.
