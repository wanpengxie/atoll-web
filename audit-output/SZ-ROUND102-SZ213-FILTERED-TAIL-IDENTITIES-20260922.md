# S-Z Round 102 — SZ213 filtered-tail installed identities

## Contract

SZ213 is the user-visible guarantee that reaching the tail of an actor-filtered
conversation confirms only the identities installed by that filtered
Presentation. It must not claim that the physical channel cursor was read. The
public observable is the `useConversationProjection` result: the immutable
`projection.presentation.rows` and the typed `viewport.tailCaughtUp` /
`onTailCaughtUp` receipt. A passing receipt therefore has the exact filtered
row identity set and `physicalSeq: 0`.

## Current owner and evidence

- Unique current owner: `useConversationProjection` (Reading authority receipt
  over the `ConversationPresentation` projection).
- Test: `tests/sz213-filtered-tail-identities.test.jsx`.
- Physical timeline fixture contains `hidden` at seq 1 from `agent-b` and
  `visible` at seq 2 from `agent-a`; the public view is `scope: mine` with
  `actorFilter: {agent-a}`.
- The public projection contains exactly `['visible']`. A settled tail
  observation then emits exactly `visibleRowIDs: ['visible']`, `physicalSeq: 0`,
  and never emits `hidden` in the receipt identity set.

## Uniqueness / non-duplication

The ledger target was a missing successor for the removed
`tests/timeline-reading-integration.test.jsx` path (SZ213 remained OPEN). This
case is distinct from:

- SZ151, which covers a homogeneous filtered boundary and its zero physical
  cursor; this test adds the mixed physical timeline and exact installed
  identity-set contract.
- SZ214, which covers an unfiltered view's physical installed high-water; this
  test requires the filtered view's physical cursor to remain zero.

No product source, old path, compatibility layer, private store, selector, or
skip was changed.

## Verification

- Base / reservation: `357de99c273e1e9da1cd87e95eb20465b627e7a2`, branch
  `unit-s-z/sz213-current-357de99`.
- Focused: `tests/sz213-filtered-tail-identities.test.jsx` — 1/1 passed.
- Adjacent: `tests/sz-round43-filtered-tail-authority.test.jsx` and
  `tests/sz214-unfiltered-high-water-public-owner.test.jsx` — 3/3 files/tests
  passed together (including SZ213).
- Build: `npm run build` passed (Vite 4,306 modules; only existing chunk-size warnings).
