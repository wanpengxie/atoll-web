# A–D TC-1447 — Composer outside the fixed reading geometry contract

Date: 2026-09-21
Base: `75a9f4a6ecb7c4d309b91a459ebc0e59ce936634`
Branch/worktree: `unit-a-d/tc1447-composer-geometry` / `/tmp/ad-tc1447-75a9f4`

## Case contract

| Field | Evidence |
|---|---|
| Baseline | `fae8b70:tests/visual-interaction-contract.test.jsx:44`, `it('keeps Composer outside the fixed reading geometry contract')` |
| User capability | A user can read and follow the conversation while the Composer remains an independent bottom input surface; Composer edits, floating Waiting controls, and input scrolling must not become a second timeline geometry owner. |
| Invariant | `ConversationSurface` owns composition only: the reading slot is reserved by the surface geometry, the bottom stack is the single Composer/Waiting presentation slot, and semantic reading/geometry commands remain in their typed owners. No Composer draft or command state is mirrored into the reading surface. |
| Current public owner | `src/ui/conversation/ConversationSurface.jsx` owns the public surface boundary and receives `composer` as an opaque slot; `src/app/WorkspaceApp.jsx` supplies the Composer and composes the surface; `src/styles/app-shell.css` owns the reading/bottom slot geometry; `src/styles/composer.css` owns Composer-local overflow. |
| Baseline setup/action/result | The old contract inspected the public ConversationSurface/Timeline composition and CSS, then asserted no observer/raw-scroll/send-clear writer in the surface, a reserved reading slot, an absolute bottom stack, contained Composer scrolling, and a floating slot above the Composer. |
| Current result | **PASS — current public-owner successor.** The existing `tests/visual-interaction-contract.test.jsx` assertion at line 60 preserves the user-visible geometry boundary against the current ConversationSurface/Workspace composition. No duplicate case was added. |

## Owner mapping and first breakpoint

The old `src/ui/Timeline.jsx` shell path is retired. That is the migration
breakpoint, not a product regression: the current owner is the ConversationSurface
boundary and its explicit opaque Composer slot.

The current source preserves the contract through these public boundaries:

1. `ConversationSurface` renders `.conversation-reading-slot` and
   `.conversation-bottom-stack`; it does not create a draft store, Composer
   command owner, observer, or raw scroll writer.
2. `WorkspaceApp` provides `composer: <Composer model={...} commands={...} />`
   through `conversationPort`, so Composer state stays owned by Composer and its
   command port rather than by the reading surface.
3. `app-shell.css` reserves the reading rectangle with
   `--conversation-bottom-reserve`, places the bottom stack at the surface
   bottom, and keeps the input/floating slots in that same presentation stack.
4. `composer.css` limits overflow to `.composer-editor`; it does not acquire the
   conversation list's scroll/geometry authority.

## Verification

Focused command:

```text
npx vitest run tests/visual-interaction-contract.test.jsx --reporter=verbose
```

Result: **1 file, 6 tests passed**. The TC-1447 assertion passed together with
the adjacent virtual-list, reading-intent, visual-viewport, media-box, and
mobile-channel geometry contracts.

Build command:

```text
npm run build
```

Result: **passed** (`vite v8.0.16`); only the existing large-chunk advisory was
reported.

This is a source/current-owner contract. It does not claim a fresh Chromium
paint trace for every viewport; the report does not convert that unrun browser
dimension into a pass. No `src/`, vendor, package, lockfile, private export,
compatibility layer, skip, or product behavior was changed.
