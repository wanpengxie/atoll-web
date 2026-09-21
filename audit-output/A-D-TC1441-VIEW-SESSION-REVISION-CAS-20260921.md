# A–D TC-1441 — revision compare-and-swap within one activation

- Date: 2026-09-21
- Baseline: `fae8b70:tests/view-session.test.js:70`
- Current base: `ffe7d0f1a9fdbe6f48c60f667aa033ed2beb434f`
- Branch: `unit-a-d/tc1441-view-session`
- Worktree: `/tmp/ad-tc1441-view-ffe7d0f`
- Disposition: `PASS` through the existing current public-owner case; no
  duplicate test was added.

## Case contract

- Case: `it('uses revision compare-and-swap inside the current activation',
  ...)` in `tests/view-session.test.js`.
- User capability: while the user remains in one conversation view, the first
  position update is accepted and a delayed duplicate based on the old state
  cannot silently overwrite the newer position.
- Invariant: every save carries the current activation ID and expected
  revision. The public owner must accept exactly the matching revision, advance
  it once, and reject a repeated stale revision without changing the stored
  position.
- Current public owner: `createViewSessionStore` exported by
  `src/model/view-session.js`, instantiated by `WorkspaceApp`; the case uses
  only public `activate`, `save`, and `readView` methods. No private helper,
  compatibility API, or test-only export is used.

## Baseline setup, action, and observable result

1. Create one public view-session store and activate `c0/all` with activation
   `a1`.
2. Save bookmark `m1` using the activation's returned revision; the save is
   `true` and advances the revision.
3. Repeat a save with the same activation and the original revision, carrying
   bookmark `stale`; the save is `false`.

The current canonical case preserves these actions and results. The test's
public result is the acceptance/rejection boolean; the store's revision fence
then prevents the stale write from becoming a second user-visible position.

## Verification

Command:

```text
npx vitest run tests/view-session.test.js --reporter=dot
```

Expected/current result on this worktree: `1 file, 7 tests passed`.

`npm run build` also passes on this exact base. This worktree adds only this
case-level audit record; no `src/`, vendor, package, lockfile, private API,
skip, compatibility, or product change was made.
