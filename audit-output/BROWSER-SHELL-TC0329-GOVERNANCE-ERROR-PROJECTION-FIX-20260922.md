# TC-0329 governance terminal error projection

## Scope

TC-0329 preserves the protected Actor/Owner controls and the public
`ChannelCreateModal` draft/retry journey.  The stable red was only the
Workspace projection of a failed governance terminal: the server supplied
`error_code=unauthorized_sender` and its detail, but the modal received only
`sender is not an active channel member`.

## First owner and fix

The owner is `WorkspaceApp`'s existing `governanceTerminalError` projection,
which already feeds `governance.channel.creation.error`; `ChannelCreateModal`
continues to render that existing read-only fact and owns the modal draft/retry.

The projection now:

- preserves recognized typed governance/wire codes as
  `账本失败：<code>（<server detail>）`;
- uses bounded `账本失败：治理命令未完成` for unknown/missing codes while
  retaining a present server detail;
- keeps the original `Error.code` for internal terminal identity;
- adds no state/store/owner and changes no backend, mock, protocol, or
  submission path.

## Exact evidence

- Red oracle: `69c863954156a0b870ec378007ea178d8b26086c`
  (`tc0329-phase-d-protected-governance.spec.js`), repeat5 **0/5** at the
  typed alert boundary; protected-note, disabled Owner, modal retention, and
  draft preservation had already passed.
- Base: `35daba8c8ec1deb6164355c55a4403bb3de1dc55`.
- Worktree: `/tmp/atoll-web-shell-tc0329-35daba8`.
- Public Chromium successor:
  `ATOLL_TEST_WEB_PORT=17243 ATOLL_TEST_MOCK_PORT=26243 npx --no-install playwright test tests/browser/tc0329-phase-d-protected-governance.spec.js --repeat-each=5 --workers=1`
  → **5/5 passed**.
- Focused Vitest (`channel-create-modal`, `governance-feature-owner`,
  `governance-member-command-port`) → **3 files / 12 tests passed**.
- Build: **PASS** (`npm run build`; 4306 modules, existing large-chunk warning only).
