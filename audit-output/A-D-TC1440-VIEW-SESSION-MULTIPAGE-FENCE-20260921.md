# A–D TC-1440 — multi-page position fence with durable unseen merge

- Date: 2026-09-21
- Baseline: `fae8b70:tests/view-session.test.js:47`
- Current base: `218375f0f839d5ccdfb6ee11b5d13a4d5c3c2afa`
- Branch: `unit-a-d/tc1440-view-session`
- Worktree: `/tmp/ad-tc1440-view-218375f`
- Disposition: `PASS` through the existing current public-owner case; no
  duplicate test was added.

## Case contract

- Case: `it('does not let a second page overwrite this page session position',
  ...)` in `tests/view-session.test.js`.
- User capability: two pages for the same principal may be open at once. A
  second page can record new unseen evidence, but it must not overwrite the
  first page's active browsing position; the first page must still see the
  durable unseen evidence after its normal storage refresh.
- Invariant: browsing bookmark/mode is document-local to each activation,
  while unseen records and the revision are durable and merged through one
  view-session owner. A later page starts at latest and cannot borrow or erase
  the earlier page's live position.
- Current public owner: `createViewSessionStore` exported by
  `src/model/view-session.js`, instantiated by `WorkspaceApp`; the case uses
  only public `activate`, `save`, and `readView` methods. No private helper,
  compatibility API, or test-only export is used.

## Baseline setup, action, and observable result

1. Create shared memory storage and a first principal store; activate `c0/all`
   as `page-a` and save a browsing bookmark `page-a-row`.
2. Create a second store for the same principal/storage; activate the same
   view as `page-b`, which opens at `following` with no bookmark.
3. Save `page-b-row` plus unseen record `new-row` from the second page.
4. Read from the first page and verify its `page-a-row` browsing bookmark is
   retained, while its revision advances and the durable `new-row` evidence is
   visible.

The current canonical case preserves these actions and observable results. It
therefore demonstrates the multi-page position fence and durable unseen merge
through the current public store.

## Verification

Command:

```text
npx vitest run tests/view-session.test.js --reporter=dot
```

Expected/current result on this worktree: `1 file, 7 tests passed`.

`npm run build` also passes on this exact base. This worktree adds only this
case-level audit record; no `src/`, vendor, package, lockfile, private API,
skip, compatibility, or product change was made.
