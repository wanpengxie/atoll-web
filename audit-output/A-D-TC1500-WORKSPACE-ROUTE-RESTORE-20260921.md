# A–D TC-1500 — workspace route restore contract

Date: 2026-09-21
Base: `b43e356da432c4e0bfc4106bb0331374e5248df4`
Branch/worktree: `unit-a-d/tc1500-route-restore` / `/tmp/ad-tc1500-b43e356`

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/workspace-route.test.js:6`, `it('编码并恢复频道、主视图和稳定 focus')` |
| User capability | A user can reopen a deep link and return to the encoded channel, the artifact/file main surface, and the same stable artifact focus identity. |
| Invariant | Channel and focus identities are URL-encoded and projected by one navigation owner. A route request is accepted only when the channel is present in the current access projection; no deleted helper, guessed view, or second route store is used. |
| Current public owner | `useChannelNavigation` exported from `src/app/hooks/useWireSession.js`; `WorkspaceApp`/`WorkspaceFeatures` consume its `activeView` and `focus` projection. The current public view is `files`; `WorkspaceApp.sourceView()` maps the old `artifacts` source name to it. |
| Baseline setup/action/result | The old test called `buildWorkspaceHash({ channelId: 'team/研发', view: 'artifacts', focus: { type: 'artifact', key: 'artifact:team/研发:res 1' } })`, parsed it, and expected the same decoded channel/view/focus. |
| Current result | **PASS — fixture/owner migration.** `tests/workspace-route-restore.test.jsx` sets the equivalent encoded public URL, supplies an authoritative member access row, mounts the exported hook, and observes `team/研发`, `files`, and the same artifact focus plus typed history projection. |
| Allowed boundary | Test and this audit report only. No `src`, vendor, package/lockfile, old `workspace-route` API, compatibility layer, second store, or product owner was changed. |

## Evidence

Focused command:

```text
npx vitest run tests/workspace-route-restore.test.jsx \
  tests/channel-navigation-route.test.jsx \
  --reporter=dot
# 2 files passed; 7 tests passed
```

The migrated case exercises only the exported `useChannelNavigation` entry and
the browser's public `location/history` surface. A failure would be a bounded
regression packet at that owner boundary; the test worker would not change
product code or weaken the encoded identity/focus assertions.
