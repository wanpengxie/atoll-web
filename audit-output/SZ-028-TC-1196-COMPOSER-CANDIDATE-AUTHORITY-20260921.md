# TC-1196 / SZ-028 — Composer suspended-candidate authority

## Claim

This is the atomic claim for numeric case **TC-1196**, alias **SZ-028**. The
case is the former `submission-outbox.test.jsx` contract:

> does not publish transport authority from a suspended candidate render

The migration ledger and the current-owner handoff reports listed SZ-028 as
open because they required a current public Composer successor. No existing
closure report claims TC-1196/SZ-028. TC-0650, TC-1200/SZ-032, TC-1207/SZ-040,
and the attachment, mention, slash, and submission cases are separate claims;
they are not reused here.

## User contract and owner

The old baseline at `fae8b70:tests/submission-outbox.test.jsx:31-72` renders a
committed `open` Composer runtime, starts a transition to a `reconnecting`
candidate, and suspends that candidate. The committed UI must remain `open`;
the candidate must not publish transport authority or write the durable queue;
the stable callback retained from the committed render must still submit once.

The current public owner is `useComposerSubmissionRuntime` in
`src/ui/composer/useComposerSubmissionRuntime.js`, with `outbox-store.js` as
the durable queue owner. The runtime installs its authority in a
`useLayoutEffect`, so a suspended candidate render cannot install or retire
authority. The current public hook test at
`tests/submission-outbox-current.test.jsx:113-160` exercises the same
Suspense/transition behavior and observes the externally relevant results:

1. committed body text remains `open` after the candidate suspends;
2. durable restore remains empty before send;
3. the committed callback submits exactly once; and
4. the pending projection reaches `accepted` for the submitted message.

This is the existing implementation from `0482c2f`; no product change is
needed for the current owner. This report closes the previously unclaimed
numeric/alias case rather than creating another owner or compatibility path.

## Evidence on current main

Base: `c95e253bdcc3aca81684333dffa600e5b8593592`.

Focused public-owner test, repeated five times:

```text
npx vitest run tests/submission-outbox-current.test.jsx -t 'suspended Composer candidate' --reporter=verbose
✓ 1 passed, 15 skipped
```

Each of five repetitions produced the same `1 passed, 15 skipped` result.

Focused Composer/Outbox suites:

```text
npx vitest run tests/submission-outbox-current.test.jsx tests/submission-outbox.test.jsx --reporter=dot
Test Files 2 passed (2)
Tests 25 passed (25)
```

Production build:

```text
npm run build
✓ built in 3.65s
```

The build emitted only the repository's existing large-chunk warning.

## Scope decision

**GREEN / PROVEN-DIRECT.** The current public Composer owner preserves the
committed authority across a suspended candidate and prevents candidate queue
mutation. No `src/` file, Workspace/Feed/Roster file, vendor/package file,
store, compatibility wrapper, or second owner was added or changed. This
commit contains only this audit/claim report.
