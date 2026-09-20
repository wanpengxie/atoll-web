# E–H R61 — AD347 describe-gated Composer candidates

Date: 2026-09-21  
Base: `a9c1b651192157f450cb03d4c54c39e20b764daf`
Worktree: `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web/.worktrees/unit-e-h-ad347-a9c1b65`

## Case contract

| Field | Evidence |
|---|---|
| Unique old case | `fae8b70:tests/dynamic-f3.test.jsx:433-440`, the slash menu must expose `compact` for the selected Agent and must not expose undeclared `new`. |
| User capability | A user can type `/` and choose only Agent control words that the target Agent publicly declares through `describe`; a missing declaration is not presented as an executable candidate. |
| Invariant | Candidate visibility is derived from the current target Agent's canonical `capabilityIndex`/`describe.types`; system `/restart` remains its documented separate route, while Agent-scoped rows require a declared request word. |
| Current public owner | `src/ui/composer/Composer.jsx` renders the public command list; `src/ui/composer/composer-model.js` owns `dynamicSlashCommands`, `commandRegistry`, `commandAvailability`, and `slashCommandMenu`; `useComposerCommands` supplies the current `capabilityIndex`. |
| Minimal test boundary | `tests/f6-composer-isolation.test.jsx` only. Existing `tests/composer-command-port.test.js` already covers model-level dynamic schema/request behavior; this case preserves the old public UI action and accessible option observable. |

## Action and observable

The migrated test mounts the public `Composer` through the existing
`useComposerCommands` harness, supplies only a valid `agent.compact` request
word in the target Agent's `describe.types`, and types `/`. It requires:

- the accessible `/compact` option to be present;
- the undeclared `/new` option to be absent; and
- the public model's Agent-scoped candidate set to contain exactly
  `['compact']`.

This keeps the old user action and visible candidate result. It does not use
diagnostic events, private exports, or a recreated capability source.

## Result

**PASS / MIGRATE; no product change required.** The existing Composer owner
already gates both built-in and dynamic Agent commands through the target
Agent's `describe.types`; the added test closes the previously unallocated
AD347 baseline with the old UI observable.

Focused verification:

```text
npm exec vitest run tests/f6-composer-isolation.test.jsx -- -t AD-347 --reporter=verbose
1 passed

npm exec vitest run tests/f6-composer-isolation.test.jsx --reporter=dot
11 passed

npm exec vitest run tests/composer-command-port.test.js --reporter=dot
16 passed

npm run build
vite build: success (4306 modules transformed)
```

`git diff --check` passes after rebasing onto `a9c1b65`. The change is
test/audit-only: no second owner,
store, compatibility path, vendor/package/lockfile, backend, protocol, skip,
or weakened assertion was added.
