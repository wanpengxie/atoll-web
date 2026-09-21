# A–D TC-1439 — page-local browsing position and latest-on-new-page boundary

- Date: 2026-09-21
- Baseline: `fae8b70:tests/view-session.test.js:28`
- Current base: `d50a11ed25b5dedebbfd51aab9d71c45605efbcb`
- Branch: `unit-a-d/tc1439-view-session`
- Worktree: `/tmp/ad-tc1439-view-d50a11e`
- Disposition: `PASS` through the existing current public-owner case; no
  duplicate test was added.

## Case contract

- Case: `it('keeps a browsing bookmark only for this page session and starts a
  new page at latest', ...)` in `tests/view-session.test.js`.
- User capability: a user who scrolls into a conversation can switch away and
  return within the same browser document without losing the active browsing
  position, while a newly opened page for the same principal starts at the
  latest/following position instead of unexpectedly resuming an old middle
  position.
- Invariant: the live document's activation owns browsing mode and bookmark;
  the durable principal record carries unseen evidence and revision but never
  persists a browsing position. One `createViewSessionStore` remains the
  source of truth for both boundaries.
- Current public owner: `createViewSessionStore` exported by
  `src/model/view-session.js`, instantiated by `WorkspaceApp`; its public
  `activate`, `save`, and `readView` methods are exercised directly. No private
  hook, compatibility API, or test-only export is used.

## Baseline setup, action, and observable result

1. Create a memory-backed store for principal `me` and activate `c0/all` as
   `page-a`.
2. Save a browsing bookmark (`middle-row`, row offset `-18`) and verify the
   same live page reads it back as `browsing`.
3. Create a second store with the same principal and storage, representing a
   newly opened page.
4. Verify the new page reads `following` with a `null` bookmark.

The current canonical case preserves these actions and observable results. It
therefore proves the page-local position boundary through the current public
store. It does not exercise the separately blocked retired-v2 storage
migration rows (TC-1443/TC-1444), and makes no obsolete-capability claim.

## Verification

Command:

```text
npx vitest run tests/view-session.test.js --reporter=dot
```

Expected/current result on this worktree: `1 file, 7 tests passed`.

`npm run build` also passes on this exact base. This worktree adds only this
case-level audit record; no `src/`, vendor, package, lockfile, private API,
skip, compatibility, or product change was made.
