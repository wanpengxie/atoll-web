# E–H R64 — TC-0298 atomic reservation

## Claim and de-duplication

This reservation claims exactly one previously unclaimed baseline declaration:

- **Case:** TC-0298
- **Legacy declaration:** `fae8b70:tests/browser/phase-b.spec.js:88`
- **Legacy title:** `B-BR-02b 慢 OBS 不阻塞缓存首屏，档案补全不重建消息连接`
- **Central ledger row:** `audit-output/TEST-CASE-MIGRATION-LEDGER.md:649`
- **Claim base:** `65452ed6fdea7af948c9fa40698980f844ea8736`
- **Planned successor:** `tests/browser/f7-phase-b-0298.spec.js`
- **Current owner:** `WORKSPACE` (`WorkspaceApp` / `useWireSession` and the
  public channel/timeline surface)

The CAS precheck covered the current main, all registered git refs and
worktrees, and the channel-wide audit/test directories. Exact `TC0298` and
exact-title searches found only the central ledger row and copied legacy
`phase-b.spec.js` declarations; no reservation, successor, audit packet, or
claim branch existed. The adjacent active claims are distinct:

- TC-0291: root rail/login restoration;
- TC-0292: multi-channel isolation/approval;
- TC-0293: revocation/retirement (already claimed by A–F);
- TC-0294: first-login root channel;
- TC-0296: root actor visibility;
- TC-0297: stale reconnect.

Copied baseline files in temporary experiment directories are not claims and
are not used as evidence. No other agent's test, fixture, product source, or
branch is modified by this reservation.

## User capability and invariant

With an OBS profile deliberately delayed, a user must still see the cached
channel tail on reload within the legacy first-content window. Later profile
completion must enrich the presentation without replacing the existing
message WebSocket/history owner. The invariant is that identity/access
projection may arrive asynchronously, but it cannot block the public cached
conversation or create a second message connection for the same activation.

## Legacy action and observable to preserve

The successor must retain this exact public trajectory from the old case:

1. Reset `multi-channel` with seed `811`, log in as root, and observe
   `c0 history 1`.
2. Install the existing public mock OBS delay (`delay_ms: 2500`, `count: 20`)
   and record public `/ws` WebSocket connections.
3. Reload. Within 1.5 seconds, the public connection is `OPEN` and cached
   `c0 history 1` is visible, before delayed profile completion.
4. After the 2.5-second delayed OBS completion, the same cached row remains
   visible and exactly one `/ws` connection exists.

No private store, React state, diagnostic event, source fingerprint, or
timeout-only success may replace these user-visible gates.

## Current public owner and successor

The current public owner is the Workspace access/feed composition:

- `src/app/hooks/useWireSession.js:285-303` classifies channel access and
  filters internal channels; `:344-424` consumes profile/membership facts,
  while `:465-472` exposes the public channel rows.
- `src/app/hooks/useWireSession.js:756-783` keeps the active channel selection
  on the current public navigation owner.
- `src/app/WorkspaceApp.jsx:482-560` combines the access projection with the
  feed and Composer ports; the public write/transport gate is
  `:1067` (`member_active` and open wire).
- `src/app/WorkspaceLayout.jsx:252-300` renders the visible channel rail and
  `.connection-state`; `ConversationSurface` is mounted by
  `WorkspaceApp.jsx:1324-1326` for the visible timeline.

Successor: `tests/browser/f7-phase-b-0298.spec.js`. It keeps the old reset,
OBS delay, reload, 1.5-second cached-row/OPEN window, 2.7-second completion,
single `/ws` connection, and persistent-row assertions. Only the supported
login value and generic `OPEN` text selector are translated to current public
selectors (`root` and `.connection-state.state-open`). It does not inspect
IndexedDB, React state, diagnostics, or a private owner handle.

## Verification on current main

Focused Chromium:

```text
ATOLL_TEST_MOCK_PORT=20198 ATOLL_TEST_WEB_PORT=15498 \
  npm run test:browser -- tests/browser/f7-phase-b-0298.spec.js \
  --workers=1 --reporter=line \
  --output=test-results-tc0298-focused-65452ed
# 1 passed (9.7s)
```

Fresh repeat-3 Chromium:

```text
ATOLL_TEST_MOCK_PORT=20199 ATOLL_TEST_WEB_PORT=15499 \
  npm run test:browser -- tests/browser/f7-phase-b-0298.spec.js \
  --workers=1 --repeat-each=3 --reporter=line \
  --output=test-results-tc0298-repeat3-65452ed
# 3 passed (24.5s)
```

Build:

```text
npm run build
# ✓ built in 4.75s; 4306 modules transformed
```

The public evidence is stable across all four Chromium executions: cached
`c0 history 1` is visible in the bounded first-content window, and delayed
OBS completion does not create a second `/ws` connection or remove the row.
No product, fixture, vendor, package, lockfile, skip, compatibility, or
private-export change was made.

## Final disposition

**ACCEPT — strict public successor.** The successor preserves the baseline
user capability and the single-session/async-identity invariant through the
current Workspace owner. TC-0298 is ready for ledger closure using the
successor commit delivered with this packet.
