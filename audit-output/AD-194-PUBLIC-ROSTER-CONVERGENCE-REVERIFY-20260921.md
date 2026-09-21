# AD-194 public member ledger/roster convergence re-verification

Date: 2026-09-21
Base: `bf89849a7d4c61db80c509930bce53a82c450a83`
Worktree: `atoll-web-ad194-reverify-bf89849` (independent)

## Contract and owner

After a member-introduction command is submitted, the command receipt is only
a ledger-side request locator. The UI must not claim `成员已就绪` until the
canonical roster projection for the same channel reports current authority and
contains the requested actor. A stale, incomplete, or rejected roster remains
not-ready.

The owner chain is:

```text
backend roster/ledger facts
  -> useChannelRoster authority (principal/channel/generation)
  -> WorkspaceApp governance.channel.rosterAuthority + roster projection
  -> GovernanceFeature.ChannelMembers
```

`ChannelMembers` keeps the submitted actor as a local request locator only. It
requires `operation.state === submitted`, `rosterAuthority.current === true`,
matching `channelId`, and presence in the canonical roster before rendering
`成员已就绪`. It does not treat the command promise, history-control
freshness, or a local roster guess as business authority.

## Evidence

Focused public-owner unit:

```text
npx vitest run tests/blocked-round26-public-owner.test.jsx \
  --reporter=verbose -t '\\[AD-194\\]'
Test Files  1 passed (1)
Tests       1 passed | 19 skipped (20)
```

The case first submits `introduce_actor` with `rosterAuthority.current=false`
and asserts the generic submitted message without `成员已就绪`. It then
provides the same-channel canonical actor row and `current=true` authority and
asserts the ready fact.

Real production Chromium:

```text
ATOLL_TEST_WEB_PORT=25204 ATOLL_TEST_MOCK_PORT=25208 \
npx playwright test tests/browser/ad194-governance-roster-convergence.spec.js \
  --reporter=line
1 passed (9.9s)
```

The browser case logs into the production Workspace, opens
`频道操作 → 频道详情 → 成员`, selects the real public Agent candidate,
submits the governance command, observes the submitted message, and waits for
`成员已就绪` only after the mock backend publishes the updated roster.

Adjacent production member-flow regression:

```text
ATOLL_TEST_WEB_PORT=25194 ATOLL_TEST_MOCK_PORT=25198 \
npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js \
  --grep 'TC-0191' --reporter=line
1 passed (8.9s)
```

Build:

```text
npm run build
✓ built in 3.45s (4306 modules transformed)
```

## Disposition

**ACCEPT — current owner proven.** The mechanism was already present in
`8cb0fcf`; this independent commit adds the missing public Chromium contract
and records current-head evidence. It does not add a store, compatibility
route, frontend business authority, backend/protocol change, or speculative
multi-owner synchronization.
