# A–D reservation — TC-0458 / AD-164 Agent activity lifecycle

## Reservation

- **Case key:** `TC-0458` (A–D alias `AD-164`)
- **Baseline:** `fae8b70:tests/channel-feed-startup.test.jsx:455`
- **Baseline title:** `preserves accepted live generation through batching into Agent active, settled and acknowledgement`
- **Current base:** `89c04f13e683d092e84f7bd26ae9a5e4aac19336`
- **Branch:** `unit-a-d/tc0458-agent-activity-89c04f13`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0458-agent-activity-89c04f13`
- **Allowed change:** this audit report only; the current public contract is already exercised by the existing A–D test owner, so no duplicate test declaration is added.

## User contract

When the current Feed accepts live Agent progress, the user sees that Agent as
active. A matching terminal transitions the same request/Agent to settled, and
the user's acknowledgement removes that settled activity. A history-only or
old-generation row cannot create a new live active indicator.

The invariant is one Feed/Replica activity owner: `(channel, boot,
generation)` admits live progress, terminal closure is causal, and
`acknowledgeAgentActivity` is the only public removal boundary. The current
public owner is `createChannelFeedRuntime()` through its
`agentActivity` snapshot and `agentActivityPort`; no private tracker or second
activity store is imported.

## Exact uniqueness precheck

1. The central `TEST-CASE-MIGRATION-LEDGER.md` has exactly one `TC-0458` row
   at line 809 and still marks it `blocked pending product decision` in the
   static inventory.
2. Exact searches for `TC-0458`, `TC0458`, `AD-164`, the baseline title, and
   `channel-feed-startup.test.jsx:455` found no dedicated reservation,
   closeout, branch, or worktree. The historical A–D restore inventory is the
   only prior alias row; the later aggregate verification did not promote
   AD-164 in its independently recovered set.
3. TC-1493 was rejected as the immediate next claim because current main still
   has the same exact origin contract in `SZ-NUMERIC-UNIT-MIGRATION.md` as
   SZ-322. This reservation therefore uses the next unique A–D row.

This is an atomic claim: the report is committed before focused verification.

## Current-owner evidence to verify

The existing `tests/agent-activity.test.js` first lifecycle case is the
candidate public owner without duplicate semantics: it attaches generation 1,
admits a live `agent.ask` processing row, observes the public
`agentActivity.byChannel.c0.active` projection, admits the matching terminal,
checks settled state, then calls `acknowledgeAgentActivity` and checks the
projection is empty. Its adjacent cases also cover generation and boot fences
for history-only/old-generation rows. Focused execution and the final
disposition are appended after this reservation commit.

## Verification results

Focused public-owner suite:

```text
npm test -- tests/agent-activity.test.js --reporter=verbose
Test Files  1 passed (1)
Tests       6 passed (6)
```

Adjacent Feed owner suite:

```text
npm test -- tests/channel-feed-runtime.test.jsx --reporter=dot
Test Files  1 passed (1)
Tests       27 passed (27)
```

Build:

```text
npm run build
✓ built in 3.52s
```

**Disposition: PASS for the current public owner contract.** This closeout
records the existing public evidence against TC-0458/AD-164; it adds no
private export, product source, compatibility layer, second store, or
duplicate case.

## Boundary audit

Only this audit report is changed. Product source, tests, package, lockfile,
vendor, and private exports are unchanged. The worktree's `node_modules`
symlink is untracked test-environment setup and is not part of the commit.
