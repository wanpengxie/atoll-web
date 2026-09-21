# TC-0650 — Composer mention-then-command audience

Date: 2026-09-21
Base: `54111bfb7803bfba91d07c7151bfddf492a53afd`
Owner: current public `Composer` + `useComposerCommands`

## Claim and uniqueness

This audit claims only the 1487-ledger row **TC-0650**: the user explicitly
selects one Agent with `@`, then selects and submits a slash command; the
command must still target the explicitly mentioned Agent.

It is distinct from the already counted contracts:

- TC-0643/0644 cover chip persistence/removal, not command routing.
- TC-0648/0649 cover literal `@` and Escape, not a selected recipient followed
  by a command.
- TC-0174 covers mention list selection and ordinary message delivery.
- AD-346 covers slash candidate selection and the two-Enter send sequence
  without an explicit `@` recipient; AD-347 covers describe-gated candidates.
- AD-358–362 cover attachment and IME/send paths, not this target contract.

The historical case is explicit in
`fae8b70:tests/dynamic-f3.test.jsx:598-616`: the old user path was
`@Codex` → choose the Agent → `/compact` → first Enter selects → second Enter
sends, with `audience: ['codex']`. No current audit or test in the inspected
ledger named this combined path before this claim.

## User contract and current owner

The public interaction is:

1. Type `@co` in the Composer Tiptap editor and choose `codex` from the
   `@ 收件人` listbox.
2. Type `/co` and choose `/compact` from the Agent command listbox.
3. Press Enter once: the editor becomes `/compact ` and no pending command is
   created.
4. Press Enter again: exactly one pending control frame is materialized with
   `msg_type: 'agent.compact'`, empty payload, and `audience: ['agent:codex:1']`.

The test goes through the current public `<Composer>` DOM and the
`useComposerCommands` command owner. It observes the recipient remove button,
listboxes, mounted editor text, and the public pending frame. It does not call
`resolveComposerDelivery`/`createComposerCommandRequest` directly, inspect a
private store, or restore the removed flat Composer API.

The current mechanism is visible in the owner path:

- `Composer.jsx` routes mention choice through `commands.pickMention` and slash
  choice through `commands.changeDraft`, preserving the mounted Tiptap editor.
- `composer-model.js` gives explicit mention delivery precedence and derives
  `targetAgent` from the one delivery row.
- `createComposerCommandRequest` sends the resulting Agent command through the
  existing command/submission owner with that target actor id.

## Evidence

Added one public-owner contract to
`tests/f6-composer-isolation.test.jsx:325`:

```text
npx vitest run tests/f6-composer-isolation.test.jsx -t 'TC-0650' --reporter=dot
Test Files  1 passed (1)
Tests       1 passed | 13 skipped (14)
```

The exact case passed five consecutive runs. The surrounding current Composer
command suites also pass:

```text
npx vitest run tests/f6-composer-isolation.test.jsx tests/composer-command-port.test.js --reporter=dot
Test Files  2 passed (2)
Tests       30 passed (30)

npm run build
✓ built in 3.76s
```

This is a test/audit-only closure: no `src/`, Workspace, Feed, vendor,
package/lockfile, protocol, store, or compatibility owner changed.
