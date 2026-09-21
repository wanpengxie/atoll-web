# TC-0991 public fixture/oracle migration

Date: 2026-09-21

## Claim

TC-0991 is the unique case claimed from the remaining I-M choice of TC-0984
or TC-0991.  The fae8b70 user contract is: a fixed Waiting reserve is
materialized, and a row whose pixels are below the readable bottom is absent
from the public visible-row evidence.  The old source is
`fae8b70:tests/message-list-lifecycle.test.jsx:990`.

## Exact base and initial attribution

- Base: `ef526af72bca9dde189a663c6cf96ea054c5c749` (`ef526af`, detached
  worktree `.worktrees/im-tc0991-ef526af`).
- The unmodified current bridge failed TC-0991 twice with the strict oracle:
  the footer was present, but `observations.at(-1)?.visibleRows` was absent.
- This was a test fixture/oracle mismatch, not a product red: the current
  owner publishes non-settled browsing samples through `onReadingSample`, and
  rejects an all-covered viewport because empty evidence is not an accepted
  reading sample.

## Migration boundary

Only `tests/i-m-exact-path-contracts.test.jsx` changed:

1. The local public Virtuoso fixture now materializes the production
   `data-reading-container`, `data-reading-mode`,
   `data-reading-presentation-revision`, and `data-reading-root-identity`
   attributes on its public scroll root.
2. The fixture supplies one readable row and one row below the 100px reserve,
   and hit-tests each row at its own public geometry.  The strict oracle now
   requires exactly the readable row, proving that the covered row is absent
   without requiring an impossible empty sample.
3. The public session fixture supplies its explicit `intentRevision: 0`, and
   the oracle listens to the current public `onReadingSample` boundary rather
   than the retired settled-observation callback.

No product source, private export, vendor/package, compatibility path, or
second owner changed.

## Green evidence

`npx vitest run tests/i-m-exact-path-contracts.test.jsx -t 'TC-0991' --retry=2`
→ **1 passed, 169 skipped**.

The same command with `--retry=0` was run five separate times: **5/5 passed**
(each run 1 passed, 169 skipped). `git diff --check` is clean.
