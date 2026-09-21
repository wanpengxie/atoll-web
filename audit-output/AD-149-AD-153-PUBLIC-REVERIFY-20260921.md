# AD-149 + AD-153 public Governance re-verification

Date: 2026-09-21
Base: `75a9f4a6ecb7c4d309b91a459ebc0e59ce936634`
Worktree: `atoll-web-ad149-ad153-75a9f4a` (independent, detached at the base)

## Contract and owner

| Case | Public user contract | Sole current owner | First breakpoint |
|---|---|---|---|
| AD-149 | From the production Workspace rail, `新建频道` opens one independent `新建频道` dialog, focuses `新频道名称`, and submits the typed channel-create command while retaining the draft and request locator. | `WorkspaceLayout` → `WorkspaceApp` navigation port → `WorkspaceRightPanel` → `GovernanceFeature.ChannelCreateModal` | None observed. |
| AD-153 | After submit, a request receipt is not readiness. The modal exposes ledger, OBS, membership, and serving facts and enables `进入新频道` only after all four authoritative facts converge; entry goes through the existing Shell command port. | `GovernanceFeature.ChannelCreateModal` consumes `port.creation`; Shell owns `commands.enterChannel`. | None observed. |

The public route is the current production rail and `WorkspaceRightPanel`; no
direct private component oracle, compatibility route, second store, backend, or
protocol change is used. The existing unit harness observes that same public
panel boundary, while the browser case drives the production Workspace and
mock WebSocket/session.

## Verification

Focused unit:

```text
npx vitest run tests/channel-create-modal.test.jsx --reporter=verbose
Test Files  1 passed (1)
Tests       4 passed (including AD-149 and AD-153)
```

The AD-149 assertion checks the dialog, initial name focus, payload, and
non-ready state. The AD-153 assertion checks all four labels, four pending
facts, no premature entry, then all four confirmations and the typed
`enterChannel({ channelId, view: 'conversation' })` call.

Real production browser:

```text
ATOLL_TEST_WEB_PORT=25169 ATOLL_TEST_MOCK_PORT=25173 \
npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js \
  --grep 'TC-0192' --reporter=line
1 passed (7.1s)
```

Chromium opens the production Workspace, clicks the public `新建频道` rail
entry, fills the modal, submits against the live mock session, observes all
four convergence labels and confirmations, and enters the resulting child
channel. The wire reconnect/resource warnings emitted by the mock are
incidental to the scenario; the public case completed successfully.

Build:

```text
npm run build
✓ built in 3.42s (4306 modules transformed)
```

## Disposition

**ACCEPT — evidence-only re-verification.** The implementation was already
present at the frozen base. This commit records the exact public owner and
fresh unit/Chromium/build evidence; it makes no source, vendor, package,
backend, protocol, route-owner, or test-contract changes.
