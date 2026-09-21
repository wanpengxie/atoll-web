# Browser N–S — TC0291 public migration

## Claim and uniqueness

This claim is based on the exact current product commit
`c4906ca432ea9a25294a7e13f6a252b680273e6f` in detached worktree
`atoll-web-tc0291-current-c4906ca`.

The baseline is `fae8b70:tests/browser/phase-a.spec.js:18` (TC0291),
`A-BR-01/02/03 登录恢复、c0 根频道保留和内部 lobby 隐藏`.  The old
`phase-a.spec.js` target was removed by `2adeedc` as a superseded browser
architecture spec; no current executable successor was present when this
claim was made.

Two nearby current contracts were checked and are not semantic duplicates:

| Existing path | Overlap | Why it does not replace TC0291 |
|---|---|---|
| `tests/browser/tc1499-workspace-bootstrap.spec.js` | root account, c0 heading, c0.project and reload | It proves the authenticated bootstrap/logout cache boundary, but not the public rail grouping, c0.public discoverability, or lobby exclusion. |
| `tests/browser/tc0310-channel-list.spec.js` | c0.public appears in a structured channel-list result | It exercises a user-submitted `/channels` command and result renderer, not initial rail projection plus reload. |

The phase-A contract is therefore one unique public rail/reload baseline. No
private store, diagnostic event, fixture API, or list geometry is used as a
verdict. The existing 35px `HistoryStartBoundary` reserve is irrelevant to
this contract; if a future adjacent reading check measures content geometry it
must subtract that explicit reserve before classifying a gap.

## Public contract and owner

After root login, the user must see the channel navigation with `我的频道`
and `空间` groups, the owner root channel `c0`, and discoverable `c0.project`
and `c0.public`. The authenticated surface must not expose `lobby`, and a
reload must restore the same OPEN session and selected root `c0` without
inventing a different channel owner.

The public owner is `WorkspaceApp → useWireSession/useChannelNavigation →
WorkspaceLayout` and its Channel Rail. Assertions use only accessible
navigation, visible rail text, the connection state, and the public `main h1`.

## Successor

Successor: `tests/browser/f7-phase-a-0291.spec.js`.

The migration keeps the original login, rail, lobby, root-heading, and reload
behavior while updating only the account/connection selectors to the current
public AppShell. It does not add a compatibility route, use a deleted fixture,
or weaken a visibility assertion.

## Exact Chromium evidence

Focused run on the exact product base:

```text
ATOLL_TEST_MOCK_PORT=20191 ATOLL_TEST_WEB_PORT=15491 \
  npm run test:browser -- tests/browser/f7-phase-a-0291.spec.js \
  --reporter=line --output=/tmp/tc0291-c4906ca-focused
# 1 passed (8.3s)
```

Fresh repeat run:

```text
ATOLL_TEST_MOCK_PORT=20192 ATOLL_TEST_WEB_PORT=15492 \
  npm run test:browser -- tests/browser/f7-phase-a-0291.spec.js \
  --repeat-each=3 --reporter=line --output=/tmp/tc0291-c4906ca-repeat3
# 3 passed (18.8s)
```

The production build on the same source base passed (`4306 modules
transformed`, Vite build complete). The work is test/audit-only: no product,
vendor, package, fixture, skip, or assertion relaxation was changed.

## Disposition

**ACCEPT migration.** TC0291 now has a current public successor and exact
Chromium evidence. The old absent-target ledger row can be closed by the
central migration ledger using the successor commit supplied with this report.
