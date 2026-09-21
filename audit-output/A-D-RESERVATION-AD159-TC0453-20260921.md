# A–D reservation — AD-159 / TC-0453

## Atomic claim

- **Canonical A–D key:** `AD-159`
- **Numeric ledger alias:** `TC-0453`
- **Baseline identity:** `fae8b70:tests/channel-feed-startup.test.jsx:196`
- **Reservation state:** `RESERVED — not PASS, not credit, not a product fix`
- **Reservation base:** `7acfe8755c8f09c593b6a02ea7e247556797e29f`
- **Reservation branch/worktree:** `unit-a-d/ad159-notification-context-7acfe875` / `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-ad159-reservation-7acfe875`

This file is the reservation commit for this claim. It intentionally adds no
test and changes no product source. A later implementation/reproduction may
only be credited after the exact public contract is run and reviewed.

## User contract and owner

- **User capability:** physical reading progress must not fabricate a known
  notification count while the notification parent/context is incomplete.
- **Invariant:** physical read-cursor progress and notification-context
  completeness are independent facts. Missing parent authority remains
  `unknown`; a known zero is not an equivalent result.
- **Current unique public owner:** `ChannelFeedRuntime`'s public
  `markRead`/`unreadFor` projection, reached through the current channel-feed
  port. No second unread store or legacy hook is an equivalent owner.
- **Old setup/action/result:** the baseline supplies incomplete `c1` metadata
  with `missingParents: ['missing-request']`, prepares the local replica,
  advances physical read, then expects `unreadFor('c1')` to retain
  `{ unknown: true }`.
- **Known first breakpoint:** the preserved public-owner reproduction currently
  returns `{ related: 0, total: 0 }` (known zero) after physical read advances.
  This remains a capability gap/BLOCKED result, not a reason to alter the
  product or declare the baseline obsolete.

## Uniqueness / non-credit checks

The checks below were performed before reserving:

1. The 1,487-row ledger has one exact `TC-0453` row (ledger line 804), and
   `RESTORE-CASES-A-D-20260919.md` has the one corresponding `AD-159` row
   (line 166), both pointing to the same baseline source/line.
2. `audit-output/SZ-NUMERIC-UNIT-MIGRATION.md` has no `channel-feed-startup`
   suite or `TC-0453` alias; this source is not represented by that numeric
   ledger. No other numeric/alias ledger entry was found for this source key.
3. No current dedicated `AD-159`/`TC-0453` candidate report, branch, or
   commit was found. Existing `A-D-BLOCKED-EVIDENCE-*` and
   `A-D-AD011-AD143-BLOCKED-QUANTIFICATION-*` files are prior blocked/red
   evidence only; they do not claim PASS or credit and are not duplicated by
   this reservation.

## Scope after reservation

The eventual packet is limited to the public feed/Replica contract and its
dedicated tests/audit. It may prove the existing behavior if a current public
fixture now satisfies the contract, or preserve an exact red regression packet
with the first owner breakpoint. It must not add a compatibility path, private
export, second store, expected-fail completion, or product-source change.

## Current public-contract verification

The reserved base already contains a non-expected-fail public contract at:

- `tests/blocked-round24-public-owner.test.jsx:364` — `[AD-159] keeps notification context unknown when physical reading advances without its parent`;
- `tests/blocked-round26-public-owner.test.jsx:361` — the same canonical contract in the later evidence round.

Both tests exercise only the public `ChannelFeedRuntime` snapshot methods:
`historyFor` obtains the typed authority/generation/revision, `markRead` advances
the physical cursor, and `unreadFor` must still expose `unknown: true`. The
fixture has a nonzero `c1` head with no materialized parent, so a known zero is
not an acceptable substitute. This is the same user ability and invariant as
the reserved `TC-0453` baseline; the duplicate round file is evidence only and
does not create a second ledger claim.

Focused results on reservation base `7acfe875`:

| Evidence | Result |
| --- | --- |
| `npm test -- tests/blocked-round24-public-owner.test.jsx --reporter=verbose --testNamePattern='\\[AD-159\\]'` | **1 passed / 1 selected** |
| `npm test -- tests/blocked-round26-public-owner.test.jsx --reporter=verbose --testNamePattern='\\[AD-159\\]'` | **1 passed / 1 selected** |
| `npm test -- tests/notification-state-contract.test.js --reporter=verbose --testNamePattern='inactive nonzero grant unknown\\|notification context\\|parent\\|physical'` | **6 passed / 6 selected** (adjacent notification authority/context controls) |
| `npm run build` | **passed** |

The earlier round-24/26 red reports describe the pre-fix behavior and are
historical evidence only. On this current base the public contract is green;
the prior `known zero` breakpoint is not reproducible. Therefore no
`ChannelFeedRuntime` source change is justified and no expected-fail test is
counted as completion. Product diff: **none**.

## Delivery classification

- User capability: retained unknown notification context after physical read
  advancement when its parent/context is incomplete.
- Invariant: physical read progress does not prove notification completeness.
- Public owner: `ChannelFeedRuntime.historyFor` + `markRead` + `unreadFor`.
- Current result: **PASS** on both canonical public-owner reproductions and the
  adjacent notification-state contract slice.
- Reservation outcome: **implemented by existing current public contract;
  audit-only closeout**. No product red, compatibility layer, private export,
  second store, skip, or test weakening was introduced.
