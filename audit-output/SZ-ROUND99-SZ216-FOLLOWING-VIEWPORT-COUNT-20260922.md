# S–Z round 99 — SZ-216 following viewport count

Date: 2026-09-22
Case: `SZ-216`

## Contract

When the committed Reading projection has settled at the tail, the user-facing
viewport notice is zero. That display derivation must not erase a durable unseen
record whose sequence is above the installed high-water. Leaving the tail must
make the still-pending record visible again.

## Current public owner

The sole owner is `useConversationProjection`'s public Reading viewport:
`viewport.unseenNotice`, `viewport.tailCaughtUp`, and the public
`viewSessions.readView` durable receipt. The test drives the typed settled
`reading-authority` observation and uses a real `createViewSessionStore` CAS
boundary. It does not inspect private Replica maps or add an export/store.

## Distinctness

SZ-210 proves that a tail receipt's installed high-water does not sweep a
future durable record. This case proves the separate user-facing projection:
the settled following viewport shows zero while that durable record remains,
and browsing exposes it again. SZ-214 is the unfiltered physical high-water
receipt with an above-viewport row; it is not asserted here.

## Evidence

`tests/sz216-following-count-public-owner.test.jsx` seeds `future-arrival@41`
and an installed tail at sequence 40. It observes the public sequence:

1. browsing shows one notice and the exact durable record;
2. latest intent changes to following without clearing the record;
3. a settled tail observation yields `tailCaughtUp.caughtUp=true`, while
   `unseenNotice===0` and the durable record remains `[future-arrival, 41]`;
4. a later browsing gesture restores the notice to one without duplication.

Focused and adjacent current-main commands:

```text
npx vitest run tests/sz216-following-count-public-owner.test.jsx --reporter=dot
npx vitest run tests/sz216-following-count-public-owner.test.jsx tests/sz209-jump-latest-pre-tail-public-owner.test.jsx tests/sz210-tail-high-water-public-owner.test.jsx --reporter=dot
npm run build
```

No product, vendor, package, lockfile, compatibility, skip, or legacy API file
was changed.
