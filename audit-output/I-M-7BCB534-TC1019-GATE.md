# I-M / TC-1019 strict public gate

## Scope

- Exact base: `7bcb53453eef3e198602ee792b4ef5168ffaa462`
- Branch: `unit-i-m/tc1019-gate-7bcb534`
- Product owner: `VendorListExecutor` is the sole physical scroll writer;
  `ReadingSession` owns the typed bottom intent.
- Changed boundary: `src/ui/timeline/VendorListExecutor.jsx`,
  `tests/i-m-exact-path-contracts.test.jsx`, and this audit only.

## Contract

An active Composer send join is not ready merely because a row-shaped object is
present. If any target is absent from the committed Presentation, still
Waiting, or has not reached the committed target state, the old following tail
must fail closed:

1. the physical root keeps the user's `scrollTop`;
2. `VendorListExecutor` does not issue a DOM scroll command; and
3. the public `bottomIntent` remains pending and is not consumed.

The implementation keeps the existing `activationID`/`inputEpoch` fences and
the existing Presentation, layout, range, and height delivery opportunities.
It adds no timer, poller, second writer, or detached state store. A native
Reading takeover or physical-root replacement therefore retires the old token
through the existing owner boundary before later public deliveries run.

Waiting is recognized only through public row state (`localState`, body
`state`, or body `local_submission_state` equal to `waiting`). A missing target,
an empty target binding, or a Presentation revision below the intent's
`afterPresentationRevision` floor remains unresolved. Canonical committed rows
retain the existing send-join path and the single `scroll-tail` writer.

## Strict cases

| Case | Observable contract |
|---|---|
| Waiting target | `scrollTo` calls and `consumeBottomIntent` calls remain empty; `scrollTop` and intent ID stay unchanged across range/height retry. |
| Absent target | Removing the target does not authorize fallback to the old tail; the intent remains pending. |
| Unmeasured/stale Presentation | A target-shaped row in a Presentation older than the intent floor cannot write or consume; the next public Presentation revision is the only retry. |
| Native takeover | Public wheel navigation advances Reading ownership and retires the old intent; later target/range/height delivery cannot write. |
| Root replacement | Pre-replacement range/height callbacks cannot write or consume against the successor root. |

## Verification

```text
npx vitest run tests/i-m-exact-path-contracts.test.jsx -t 'TC-1019' --retry=2 --reporter=dot
npx vitest run tests/conversation-viewport.test.js tests/reading-session-ports.test.js --reporter=dot
npm run build
```

The exact test is intentionally strict and public-owner based. Existing
canonical target/measurement baseline cases outside TC-1019 remain separately
owned regression work; this change does not weaken or merge those contracts.
