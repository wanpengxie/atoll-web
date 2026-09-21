# Browser T–Z — TC-0308 / B-BR-08 channel-bound pending

## Contract

The fae8b70 baseline contract is `tests/browser/phase-b.spec.js` B-BR-08
(line 385): a request submitted in `c0` must remain absent from the visible
`c0.project` projection while its delayed feed is pending, then appear exactly
once when the user returns to `c0`. A pending approval receipt must likewise
remain attached to its originating `c0` channel while the user visits
`c0.project`; after returning to `c0`, the same approval card must show its
receipt. This is a public channel-ownership contract, not an assertion about a
private controller or cache.

## Claim and scope

Before implementation, the current branch, tracked browser specs, audit output,
and registered worktree branches were searched for TC-0308, B-BR-08, and an
equivalent channel-bound-pending claim. TC-0303–0306 were separate A–F claims;
TC-0310 was already reserved by A–D. No TC-0308 successor or competing claim
was found. The work was performed in detached branch
`codex/browser-tz-tc0308-2f90f9e` at base `2f90f9e`.

Only this browser spec and this audit report are changed. Product source,
mock, vendor, package, lockfile, and snapshots are untouched.

## Executable successor

`tests/browser/tc0308-phase-b-channel-bound-pending.spec.js` preserves both
public journeys from the baseline:

1. Reset `feed-delayed`, submit a uniquely visible message in `c0`, navigate
   to `c0.project`, and assert the message is absent there during the delayed
   feed window. Return to `c0` and assert the message and terminal `PONG` appear
   exactly once.
2. Reset `approval`, reload after clearing product cache, approve the visible
   `c0` card, navigate to `c0.project`, and assert the card has no receipt
   there. Return to `c0` and assert the originating card visibly shows `已回执`.

The test uses only public roles, headings, text, channel items, and the public
Composer interaction. It does not inspect diagnostics, React state, IndexedDB,
or private journals.

## Verification

Command:

```text
ATOLL_TEST_WEB_PORT=15188 ATOLL_TEST_MOCK_PORT=18838 \
  npx playwright test tests/browser/tc0308-phase-b-channel-bound-pending.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
```

Result: **3/3 passed** (`27.1s`).

Adjacent ordering control `tc0304-phase-b-receipt-feed.spec.js`: **1/1
passed** (`12.0s`). Production build: **passed** (`4306 modules`, Vite
warning only for existing large chunks).

## Verdict

**PASS / product contract preserved.** The pending request and approval receipt
remain bound to `c0` across a `c0.project` navigation and converge visibly on
return without duplication. No product gap or environment blocker was
observed.
