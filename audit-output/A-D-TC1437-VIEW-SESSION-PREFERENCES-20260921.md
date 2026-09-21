# A–D TC-1437 — channel choice and filtered-view reading state

Date: 2026-09-21
Base: `045467b06b52b2b20db528c6db9c540d3e047e46`
Branch/worktree: `unit-a-d/tc1437-view-session` / `/tmp/ad-tc1437-view-045467b`

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/view-session.test.js:11`, `it('separates channel choices from filtered-view reading state')` |
| User capability | Changing a channel's conversation scope and actor filter persists the user choice independently from the reading position, with duplicate filters normalized and a new view activation starting in following mode. |
| Invariant | Preferences are keyed by channel while reading state is keyed by concrete filtered-view activation; one current view-session owner applies the normalized scope/filter and never lets a stale reading record become a new page's bookmark. |
| Current public owner | `createViewSessionStore` exported from `src/model/view-session.js`, instantiated by `WorkspaceApp` and passed through the public ConversationSurface/view-session port. The case uses only the exported store methods `writeConversation`, `read`, and `activate`. |
| Baseline setup/action/result | Create the current view-session store, write `{ scope: 'all', actorFilter: ['b', 'a', 'a'] }` for `c0`, read the preference projection, then activate `all:a` with `activation-1`; expect sorted unique `['a', 'b']`, `mode: 'following'`, and no bookmark. |
| Current result | **PASS — existing public-owner successor.** The retained `tests/view-session.test.js` case is unchanged for this exact baseline and passes against the current schema-3 store; no duplicate test was added. |
| Allowed boundary | Audit report only; no test rewrite was necessary. No `src`, vendor, package/lockfile, private export, compatibility API, or product owner was changed. |

## Evidence

Focused command:

```text
npx vitest run tests/view-session.test.js --reporter=dot
# 1 file passed; 7 tests passed
```

The case is component/model-local and exercises the current exported owner
directly. This evidence does not claim the separate old v2 persistence cases;
those are distinct ledger rows and remain governed by their own dispositions.
