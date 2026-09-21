# A–D TC-1501 — workspace route validation contract

Date: 2026-09-21
Base: `9983b5352d10c5ec76934efbb3f3b70265662ea1`
Branch/worktree: `unit-a-d/tc1501-route-validation` / `/tmp/ad-tc1501-route-9983b53`

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/workspace-route.test.js:20`, `it('拒绝未知视图和未知 focus，不猜测目标')` |
| User capability | A malformed or stale deep link cannot make the user land on an unsupported view/focus; the workspace returns to a usable current channel and default conversation surface. |
| Invariant | URL input is a request, not a second authority: only the current access projection supplies a selectable channel, the route parser accepts only current typed views/focus kinds, and rejected input is rewritten by the single navigation owner without carrying stale focus. |
| Current public owner | `useChannelNavigation` exported from `src/app/hooks/useWireSession.js`; its access-ref rows are the current channel authority and its `activeChannelId`/`activeView`/`focus` are the public route projection. |
| Baseline setup/action/result | The old parser received `#/channels/c1/debug?focus=resource:secret`, expected the default `dynamic` view and null focus, rejected `participant:`, and returned an empty route for `#/broken`. |
| Current result | **PASS — public-owner fixture migration.** `tests/workspace-route-validation.test.jsx` drives both invalid route forms through the exported hook, observes current default `conversation`, selects only access-authorized `c1`/fallback `c0`, clears focus, and verifies the typed public route projection. `conversation` is the current product name for the old default `dynamic` surface. |
| Allowed boundary | Test and this audit report only. No `src`, vendor, package/lockfile, old `workspace-route` API, compatibility layer, second store, or product owner was changed. |

## Evidence

Focused command:

```text
npx vitest run tests/workspace-route-validation.test.jsx \
  tests/workspace-route-restore.test.jsx \
  tests/channel-navigation-route.test.jsx \
  --reporter=dot
# 3 files passed; 8 tests passed
```

The test uses only the exported navigation hook, the current access rows, and
the browser's public `location/history` surface. Any failure at this boundary
would remain a bounded regression packet; the test worker would not restore the
deleted parser or modify product code.
