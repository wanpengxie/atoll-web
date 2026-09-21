# TC-0328 member lifecycle restart — Workspace typed-port fix

## Scope

This closes the stable public red in `0c8f5fd`: the channel Governance member
row had a disabled `重启` control because `WorkspaceApp` did not expose the
already-supported `system.member.restart` command on the channel governance
port.  The existing `ChannelMembers` owner remains responsible for the public
confirmation, pending/submitted feedback, and member refresh.

## Canonical capability evidence

- Protocol vocabulary: `TYPES.member.restart` is `system.member.restart`.
- Mock server/domain (the existing canonical backend boundary):
  `mock/server.mjs` dispatches the closed `{ member }` payload to
  `domain.restartActor(channelId, member)`; the domain rejects missing and
  protected actors.
- Workspace handoff: `governance.channel.commands.restartActor` calls the
  existing `sendGovernanceCommand`, which re-checks channel membership/runtime,
  sends to the system actor through the existing submission owner, and preserves
  terminal/roster projection.  No Composer route, second store, compatibility
  mirror, backend, protocol, or fixture change is introduced.

## Public successor

`tests/browser/tc0328-phase-d-member-lifecycle.spec.js` starts at the public
`频道操作 → 频道详情 → 成员` surface and asserts add → enabled direct restart
→ confirmed submitted/converged feedback → exact instance removal → candidate
rediscovery for both declarations.  It does not use Composer `/restart`.

## Verification

- Base: `000e4ebb95a77edab3f08d627c37a832d0bac005` (includes TC-0326's null
  channel/retired-channel handoff fix).
- Worktree: `/tmp/atoll-web-shell-tc0328-000e4eb`
- Branch: `codex/shell-tc0328-000e4eb`
- Focused Vitest: 3 files, 10 tests passed:
  `governance-member-command-port`, `governance-feature-owner`,
  `workspace-governance-features`.
- Browser: **5/5 passed** with independent web/mock ports:
  `ATOLL_TEST_WEB_PORT=17233 ATOLL_TEST_MOCK_PORT=26233 npx --no-install playwright test tests/browser/tc0328-phase-d-member-lifecycle.spec.js --repeat-each=5 --workers=1`.
- Build: **PASS** (`npm run build`; 4306 modules, existing large-chunk warning only).
