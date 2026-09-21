# BROWSER-N-S TC0316 — Phase-C waiting-edit interrupt handoff

## Verdict

**ACCEPT — public browser migration is green (unique credit: TC0316).**

The current Workspace preserves the waiting request while it is edited,
interrupting the active Agent exits that edit session, presents the stopped
Agent turn, publishes the canonical takeover notice, and leaves the Composer
usable for a follow-up message.  This is a full public browser flow; no
private store, React fiber, diagnostics endpoint, wire frame, or selector-only
probe is part of the verdict.

## Scope and provenance

- Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda`
  (`tests/browser/phase-c.spec.js:205-224`, C-BR-04a).
- Exact product base: `05ad3432436e9c3441fb02fb89d161c6da36baf2`.
- Independent detached worktree: `atoll-web-ns-tc0315-05ad343`.
- Successor: `tests/browser/tc0316-phase-c-waiting-edit-interrupt.spec.js`.
- This closeout changes only the successor browser spec and this audit file;
  no product, vendor, package, mock fixture, or skip was changed.

## De-duplication and ownership

The migration ledger row is `TC-0316` (`C-BR-04a`, baseline line 205).
Before claiming it, exact scans of all refs, worktrees, tracked browser
tests, and audit output found no `TC0316`/`TC-0316` successor or active
claim.  The nearby `TC0315` contract is separately owned by commit
`82b373867bc8421e420016fd85b108a5e69d3b6c7` in `/tmp/atoll-web-tc0315-942fee6`
and was not duplicated here.  Existing `ad027-processing-edit.spec.js`
covers an active processing turn and ordinary Composer draft; it does not
cover a queued waiting edit being superseded by an interrupt, so it is not a
duplicate of TC0316.  The uncommitted TC0317 worktree is a different
waiting-insert contract and is excluded.

## Public contract mapping

The successor keeps the baseline user journey while using current public
Workspace roles and DOM:

1. reset `long-running` with seed `140` and log in as `root`;
2. send an active Agent request and wait for the public `停止` control;
3. send `准备编辑的等待消息`, verify its public Waiting row, and enter
   `编辑`;
4. stop the active turn and require the stopped Agent bubble
   `✗ 已停止 · 发消息即继续`, the edit session to close, and a visible
   takeover alert;
5. require the Composer to accept and render `停止后仍能正常发送`.

The retired baseline copy `编辑已被另一项控制终止` was replaced by the
current public owner’s canonical text `另一项控制已接管编辑`.  This is a
copy migration only: the state transition remains “interrupt supersedes the
waiting edit, closes it, and leaves sending available”; the exact canonical
wording is also covered by the public AD032 owner contract.

## Exact execution

Focused smoke:

```text
ATOLL_TEST_WEB_PORT=25381 ATOLL_TEST_MOCK_PORT=25382 \
  npx --no-install playwright test \
  tests/browser/tc0316-phase-c-waiting-edit-interrupt.spec.js \
  --reporter=line --output=test-results-tc0316-05ad343-single3
```

Result: **1 passed (10.5s)**.

Fresh repeat:

```text
ATOLL_TEST_WEB_PORT=25391 ATOLL_TEST_MOCK_PORT=25392 \
  npx --no-install playwright test \
  tests/browser/tc0316-phase-c-waiting-edit-interrupt.spec.js \
  --repeat-each=3 --reporter=line \
  --output=test-results-tc0316-05ad343-repeat3
```

Result: **3 passed (22.6s)**.  Each iteration attached zero Playwright
`pageerror` values.  The spec passed `node --check` and `git diff --check`.

Build on the same detached worktree:

```text
npm run build
```

Result: **PASS** (`vite v8.0.16`, 4306 modules transformed; only the existing
large-chunk advisory was emitted).

## Owner and boundary

The public owner exercised by this contract is the Waiting/Composer handoff
in the current Workspace (`useWaitingEditingController` through
`ConversationSurface`), with the active stopped turn rendered by the public
Timeline owner.  No product regression remains on this contract at the exact
base.  No fixture or selector workaround was needed.
