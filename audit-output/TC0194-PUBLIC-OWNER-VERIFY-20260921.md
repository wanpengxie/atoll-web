# TC0194 public-owner verification (2026-09-21)

## Disposition

**ACCEPT — existing chain is complete; no product change required.**

The exact current main at `1cbd754` already restores the operation-row handoff
through the existing owners. No second route, store, compatibility path, or
Activity-local navigation was added.

## Owner proof

- `WorkspaceApp` owns the `activityPort` projection and filters rows to readable
  channels before exposing them.
- `WorkspaceFeatures.ActivityFeature` owns presentation only. A row delegates
  its typed `source` to `port.commands.open`.
- `WorkspaceApp.openWorkspaceSource` is the single Shell navigation command. It
  checks source-channel access, selects the source channel, restores the source
  view/focus, looks up the canonical turn from that channel's Feed state, and
  opens the turn context only when that original turn exists.
- The right-panel composition passes the same `activityPort` and canonical turn
  lookup into `WorkspaceRightPanel`.

Relevant source boundaries:

- `src/app/WorkspaceApp.jsx:1698-1715`
- `src/app/WorkspaceApp.jsx:1716-1782`
- `src/app/WorkspaceApp.jsx:1820-1836`
- `src/ui/features/WorkspaceFeatures.jsx:163-185`

## Public black-box evidence

Command:

```text
npx playwright test tests/browser/f5-governance-baseline-0191-0195.spec.js \
  --grep 'TC-0194' --reporter=list
```

Result: **1 passed**.

The test performs the public user path: create `operation-room`, wait for the
ledger confirmation, close the create dialog, open Activity Center → 操作,
click the operation row, then assert the original `创建子频道` turn card, the
`回合详情` containing `operation-room`, and the original `c0` channel heading.

Contract source: `tests/browser/f5-governance-baseline-0191-0195.spec.js:81-99`.

## Focused unit evidence

Command:

```text
npx vitest run tests/activity-center-accessibility.test.jsx --reporter=verbose
```

Result: **1 file / 4 tests passed**. This covers the public Activity entry,
focus/close lifecycle, canonical source callback delegation, and the explicit
unsupported operation state without fabricated rows.

## Build evidence

`npm run build` completed successfully (`4306 modules transformed`).

## Scope

This verification worktree contains no product or test modifications; the
single commit carrying this packet is audit-only.
