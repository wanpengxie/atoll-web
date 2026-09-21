# A–D TC-1438 — stale activation fence for an A→B→A view session

- Date: 2026-09-21
- Baseline: `fae8b70:tests/view-session.test.js:18`
- Current base: `e35b61243b9ca07fd0d766961e6646878d3c5223`
- Branch: `unit-a-d/tc1438-view-session`
- Worktree: `/tmp/ad-tc1438-view-e35b612`
- Disposition: `PASS` using the existing current public-owner test; no duplicate
  test was added.

## Case contract

- Case: `it('prevents an old activation from overwriting a newer A→B→A session', ...)`
  in `tests/view-session.test.js`.
- User capability: while a user rapidly changes from view A to view B and back
  to view A, a delayed save from the old A page cannot replace the position of
  the current A page. The user's latest A activation remains authoritative.
- Invariant: an activation is fenced by its activation ID and revision
  compare-and-swap. A stale activation must be rejected, while the current
  activation may save its position; there is one view-session owner for this
  state.
- Current public owner: `createViewSessionStore` exported by
  `src/model/view-session.js`, instantiated by the application and exposed via
  its public `activate`, `save`, and `readView` methods. No private helper or
  test-only export is used.

## Baseline setup, action, and observable result

1. Create one public `createViewSessionStore`.
2. Activate `c0/all` as `old`, switch to `c0/mine`, then activate `c0/all` as
   `new` (the A→B→A sequence).
3. Attempt to save the old activation with its original revision; the save is
   `false`.
4. Save the current activation; the save is `true`, and
   `readView('c0', 'all').bookmark.messageID` is `new`.

The current test preserves those actions and observable results exactly. It
therefore proves the user-facing stale-write protection through the current
public owner rather than inspecting implementation text or a deleted store.

## Verification

Command:

```text
npx vitest run tests/view-session.test.js --reporter=dot
```

Expected/current result on this worktree: `1 file, 7 tests passed`.

The current canonical test already covers TC-1438, so this worktree adds only
this case-level audit record. No `src/`, vendor, package, lockfile, private API,
skip, or compatibility change was made.
