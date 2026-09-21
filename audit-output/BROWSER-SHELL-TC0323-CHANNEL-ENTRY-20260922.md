# Shell — TC-0323 / D-BR-00 channel-entry separation

## Contract

The fae8b70 baseline is `tests/browser/phase-d.spec.js:56` (TC-0323,
D-BR-00). A user must have two distinct public entry points: the rail's
`新建频道` action opens the independent channel-creation dialog, while
`频道操作 → 频道详情` opens channel governance. The creation surface must not
expose governance tabs or management-only controls; the management surface must
not expose the creation dialog's name field and must retain its governance tabs
and close action.

The current public owner is `WorkspaceApp` navigation composed into
`WorkspaceLayout`, with `WorkspaceFeatures` routing `ChannelCreateModal` and
`ChannelAdministrationPanel`. No second route, private API, compatibility
store, mock change, or protocol change is involved.

## Uniqueness

Before implementation, the migration ledger, current refs, registered
worktrees, audit packets, and tracked browser specs were searched for
TC-0323/D-BR-00. No dedicated successor or competing claim was found.
`tc0263-channel-actions.spec.js` covers the menu's resource/create/restart
actions and `f5-governance-baseline-0191-0195.spec.js` covers the F5 creation
journey, but neither preserves the baseline's cross-entry separation and
mutual-surface assertions.

## Successor and evidence

Successor: `tests/browser/tc0323-channel-entry-separation.spec.js`.

The successor resets the public `channel-governance` fixture, logs in through
the visible Auth form, opens `新建频道`, asserts a dialog without a tablist and
with the creation name field, closes it, then opens `频道详情` from the public
channel menu. It asserts the `频道治理` panel, selects the current public
equivalent of the old “信息” tab (`概览`), and verifies the governance tablist,
selection state, absence of the creation name field, and the public close
button.

No private diagnostics, React state, IndexedDB, wire frame, or inferred rail
state is used by the successor.

Base: `8c2939e350bc554d02f606cb4df9347ec3b89d76`.
Worktree: `.worktrees/shell-tc0323-8c2939e`.
Branch: `codex/shell-tc0323-8c2939e`.

Focused Chromium verification:

```text
ATOLL_TEST_WEB_PORT=15393 ATOLL_TEST_MOCK_PORT=19393 \
  npx playwright test tests/browser/tc0323-channel-entry-separation.spec.js \
  --repeat-each=3 --workers=1 --reporter=line
# 3 passed
```

Production source, mock, vendor, package, lockfile, and snapshots are
untouched. This packet is test/audit-only.
