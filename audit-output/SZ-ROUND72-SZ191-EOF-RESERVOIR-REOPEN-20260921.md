# SZ-191 same-generation EOF / reservoir reopen — 2026-09-21

## User capability and invariant

When the current history supply reports remote EOF, that result closes only
the current supply certificate. It must not permanently discard the visible
history obligation: if the same generation later publishes reservoir progress,
the user-facing underfill demand can reopen exactly once. A demand revision by
itself is not new supply and must not replay the settled operation.

The tested invariant is: one settled EOF request for the current source,
exactly one new request after `completedPages`/`buffered` progress, and no third
request for a demand-revision-only publication. The same public viewport also
retains the visible row and the same generation/source lease throughout.

## Unique public owner

The test uses `useConversationProjection` and its public viewport
`onUnderfill()` capability. `useHistoryConsumer` is the sole history-demand
owner; source/generation/supply facts are supplied through its read-only
`history.status` port. No retired `useReadingSession`, private scheduler state,
second store, compatibility path, or private export is used.

## Evidence and result

`tests/sz191-eof-reservoir-reopen.test.jsx` renders a current generation-7
visible row, settles an underfill request as remote EOF, then publishes
same-generation reservoir progress (`completedPages: 3→4`, `buffered: 0→148`).
It proves one re-opened request, then changes only the demand revision and
proves no duplicate request. Public status remains generation 7, source lease
`1:2:9`, with the reservoir available and `hasOlder: true`.

Current-main base:
`aa99e901de1ccbbb76420edb60afd265bec6e6db`.

Focused command:

```text
npm test -- --run tests/sz191-eof-reservoir-reopen.test.jsx
```

Result: 1 file passed, 1 test passed. Product files were not changed; no
skip/deletion, compatibility layer, vendor/package/lockfile, or private oracle
was introduced.

Decision: **ACCEPT / close SZ-191 evidence**.
