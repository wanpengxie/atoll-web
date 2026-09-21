# A–D TC-1502 — workspace route history contract

Date: 2026-09-21
Base: `9983b5352d10c5ec76934efbb3f3b70265662ea1`
Branch/worktree: `unit-a-d/tc1502-route-history` / `/tmp/ad-tc1502-route-9983b53`

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/workspace-route.test.js:28`, `it('写入 history 时区分普通导航与 Context 入口')` |
| User capability | Ordinary channel/view navigation does not create an extra Back step; opening a typed channel Context creates exactly one recoverable browser entry. |
| Invariant | The single navigation owner distinguishes ordinary route projection (`replaceState`, `atollContextEntry: false`) from non-empty typed focus (`pushState`, `atollContextEntry: true`) and preserves `{ channelId, view, focus }` as the public route state. |
| Current public owner | `useChannelNavigation` exported from `src/app/hooks/useWireSession.js`; `setActiveView` and `setFocus` are its public route actions, and the browser `location/history` is the observable route surface. |
| Baseline setup/action/result | The old test called `writeWorkspaceRoute({ channelId: 'c1', view: 'tasks' }, { replace: true })`, then called it with `{ focus: { type: 'channel', key: 'c1' } }` as a Context entry, asserting replace/push payloads and encoded URLs. |
| Current result | **PASS — public-owner migration.** `tests/workspace-route-history.test.jsx` uses the current public hook with the exact `channel` focus fixture: `setActiveView('tasks')` keeps history length and writes ordinary typed state; `setFocus({ type: 'channel', key: 'c1' })` adds one entry and writes the encoded focus/state. Existing `tests/channel-navigation-route.test.jsx` separately covers Back/Forward recovery for the same owner. |
| Allowed boundary | Test and this audit report only. No `src`, vendor, package/lockfile, old `workspace-route` API, compatibility layer, second store, or product owner was changed. |

## Evidence

Focused command:

```text
npx vitest run \
  tests/workspace-route-history.test.jsx \
  tests/channel-navigation-route.test.jsx \
  --reporter=dot
# 2 files passed; 7 tests passed
```

The new case uses only the exported navigation actions and browser history;
the existing route test supplies the Back/Forward behavioral evidence. Any
failure remains a bounded route-owner regression packet; no deleted helper or
test-only compatibility API is restored.
