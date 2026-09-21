# A–D TC-1442 — durable unseen identities beyond the retired 256-key bound

- Date: 2026-09-21
- Baseline: `fae8b70:tests/view-session.test.js:77`
- Current base: `2944e352224e5c36be98025e4d554541297764a2`
- Branch: `unit-a-d/tc1442-view-session`
- Worktree: `/tmp/ad-tc1442-view-2944e35`
- Disposition: `PASS` through the existing current public-owner case; no
  duplicate test was added.

## Case contract

- Case: `it('does not forget unseen stable identities past the former 256-key
  boundary', ...)` in `tests/view-session.test.js`.
- User capability: a user may accumulate more than 256 distinct unseen live
  records without silently losing the older identities when the view-session
  state is persisted and reloaded.
- Invariant: unseen state is derived from the full finite set of stable identity
  and durable sequence pairs. The current owner normalizes duplicate identities
  by retaining the greatest valid sequence and does not apply a retired
  arbitrary 256-key cap.
- Current public owner: `createViewSessionStore` exported by
  `src/model/view-session.js`, instantiated by `WorkspaceApp`; the case uses
  only public `activate`, `save`, and `readView` methods. No private helper,
  compatibility API, or test-only export is used.

## Baseline setup, action, and observable result

1. Create memory-backed storage for principal `me`, activate `c0/all` as `a1`,
   and construct 300 stable live identities with finite sequence numbers.
2. Save the browsing state with all 300 `unseenKeys` and `unseenRecords`.
3. Create a new public store over the same storage and read `c0/all`.
4. Verify `unseenTail` is `300`, and both the stable key order and identity/
   sequence records are retained exactly.

The current canonical case preserves these actions and observable results. It
therefore proves the durable unseen identity contract through the current
public store rather than through an implementation-only collection.

## Verification

Command:

```text
npx vitest run tests/view-session.test.js --reporter=dot
```

Expected/current result on this worktree: `1 file, 7 tests passed`.

`npm run build` also passes on this exact base. This worktree adds only this
case-level audit record; no `src/`, vendor, package, lockfile, private API,
skip, compatibility, or product change was made.
