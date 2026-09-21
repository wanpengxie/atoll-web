# TC-0259 visible arrival accumulation and tail geometry

## Contract

- Baseline: `d50a11ed25b5dedebbfd51aab9d71c45605efbcb`.
- User capability: a browsing reader that interrupts a jump before the settled
  tail paint keeps the first unseen arrival; a second arrival is shown as
  `2` rather than replacing it with `1`.
- User capability: one following append emits one physical tail write for one
  mounted root and physical geometry; a real extent change may emit one new
  write.
- Public owners: `useProjectionReadingOwner` in
  `src/ui/timeline/useConversationProjection.js` owns the settled receipt and
  unseen acknowledgement; `VendorListExecutor` owns the sole typed DOM tail
  writer. No second store, writer, compatibility path, or private oracle was
  introduced.

## Root causes and minimal changes

1. The projection acknowledged arrivals as soon as semantic mode became
   `following`. A jump command can be held by the DOM adapter and revoked by a
   wheel before its paint receipt, so that early acknowledgement removed the
   first event before the second event arrived. Acknowledgement now requires
   `tailCaughtUp.caughtUp` and a positive settled boundary.
2. `totalListHeightChanged` incremented `geometryRevision` for every callback,
   including repeated callbacks with the same `scrollHeight` and
   `clientHeight`. The adapter now records the mounted root's physical
   geometry and advances the revision only when one of those dimensions
   changes. Root replacement/unmount resets that snapshot.

## Evidence

- Unit: `npm test -- --run tests/following-tail-list.test.jsx tests/live-timeline-arrivals.test.js tests/reading-observation-settle.test.jsx tests/tc0259-visible-arrival.test.jsx` — **20/20 passed**.
- Chromium strict wheel-before-paint, repeat 20 — **20/20 passed**; each run
  retained `↓ 2 条新动态`, browsing mode, physical gap `2696`, and one
  advancing tail writer.
- Chromium strict inside jump, repeat 10 — **10/10 passed**; each run ended
  following at gap `0` with one tail writer.
- Chromium following append — **1/1 passed**; one tail writer, following mode,
  gap `0`.
- `npm run build` — **passed** (4306 modules transformed).

## Conflict boundary

The TC0225 scope-handoff branches also touch
`useConversationProjection.js` and one TC0225 branch touches
`VendorListExecutor.jsx`; this commit contains only the TC-0259 settled-ack
and physical-geometry hunks and does not integrate or overwrite TC0225 scope
handoff work. `ConversationSurface`, Workspace, Reading history, Outbox,
vendor, package, and lockfiles are untouched.
