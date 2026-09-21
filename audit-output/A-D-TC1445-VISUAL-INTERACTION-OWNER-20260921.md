# A–D TC-1445 — visual interaction owner migration audit

Date: 2026-09-21

## Case contract

- Case: TC-1445, baseline `fae8b70:tests/visual-interaction-contract.test.jsx:9`.
- User capability: conversation history remains usable through one mature virtual
  list geometry executor; reading position/following behavior does not acquire a
  second application scroll owner or a retired virtualization engine.
- Invariant: one surface geometry/focus owner; typed reading intent stays separate
  from DOM and network effects; authorized positioning commands are issued through
  one public DOM capability and remain scoped to the active reading input.
- Baseline action: source the former `LegendMessageList.jsx` and `src/ui/Timeline.jsx`
  owners, then assert Virtuoso ownership, absence of TanStack/raw-scroll/retired
  helpers, one tail writer, and no geometry writer in the old Timeline shell.
- Current result: the former files are absent by architecture. The current successor
  test in `tests/visual-interaction-contract.test.jsx` preserves the same user
  contract against the current public owner graph; all six assertions pass.

## Current public owner and first breakpoint

The baseline's first breakpoint is an owner-path change, not a product red:
`LegendMessageList` and `src/ui/Timeline.jsx` no longer exist. The current public
owner is split by capability without introducing a second geometry authority:

1. `src/ui/timeline/VendorListExecutor.jsx` owns the mounted Virtuoso list and
   composes browsing/reading callbacks.
2. `src/ui/timeline/reading-dom-command-executor.js` is the only typed capability
   that turns `position-row`, `scroll-tail`, content-anchor, and focus commands into
   DOM/library writes.
3. `src/ui/timeline/useBrowsingReadingController.js` and
   `src/ui/timeline/reading-navigation-coordinator.js` own input-scoped reading
   observation and navigation transaction semantics; they do not access DOM APIs.
4. `src/ui/conversation/ConversationSurface.jsx` composes the surface and passes
   ports; it is not a geometry writer.
5. `src/app/SurfaceShell.jsx` owns only visual-viewport keyboard frame publication,
   separate from conversation-list geometry.

This is the current unique owner mapping for TC-1445. No product change is needed.

## Preserved observable behavior

The successor contract in `tests/visual-interaction-contract.test.jsx` verifies:

- Virtuoso is the current list engine and the retired TanStack/adapter/scroll-
  authority modules are absent.
- `reading-dom-command-executor.js` has one `scrollToIndex` positioning path and one
  local `root.scrollTo` tail path; list following is explicitly `followOutput={false}`.
- Tail intent is consumed only through the typed issuer and current reading state;
  browsing/navigation modules contain no direct `document`, `window`, selector,
  geometry, or raw-scroll access.
- `ConversationSurface` has no scroll writer, and Composer/Workspace composition
  remains outside fixed reading geometry.

The test remains a source-level architecture contract. It does not claim that static
source inspection proves browser paint continuity; runtime geometry remains a
separate Chromium contract and is not silently marked complete by this case.

## Verification

Worktree: `/tmp/ad-tc1445-visual-993b4cf`

Base: `993b4cf4909db54ee1008e36cf31e5530cd300ab`

Focused command:

```text
npx vitest run tests/visual-interaction-contract.test.jsx --reporter=verbose
```

Result: **1 file, 6 tests passed**.

Build command:

```text
npm run build
```

Result: **passed** (`vite v8.0.16`; only the existing large-chunk advisory was
reported).

No source, vendor, package, lockfile, private export, compatibility layer, skip, or
product behavior was changed. This commit adds only this audit report; the existing
current successor test is used unchanged.
