# A–D reservation — TC-0561 / AD-267 durable target binding

## Reservation

- **Case key:** `TC-0561` (A–D alias `AD-267`)
- **Baseline:** `fae8b70:tests/conversation-viewport.test.js:77`
- **Current declaration:** `tests/conversation-viewport.test.js:359` (the file retained the exact case after earlier public reading-control cases were inserted)
- **Baseline title:** `binds durable message identities without issuing a second bottom intent`
- **Current base:** `56fb7c63203b6f6ad2a9ec36428751f570010b95`
- **Branch:** `unit-a-d/tc0561-durable-targets-56fb7c6`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0561-durable-targets-56fb7c6`
- **Allowed change:** this report and the existing declaration in `tests/conversation-viewport.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

When a user explicitly returns to the live tail, the send flow may learn the
durable message identity after the scrolling intent has already been issued.
The later identity correlation must enrich that existing intent rather than
minting a second bottom intent or advancing its authority revision. The
observable invariant is that the stable message ID is attached to the pending
intent, while `intentRevision` remains exactly the value created by the
original `latest` request.

The retained public contract exercises `requestLatest` followed by
`bindLatestIntentTargets` with the matching activation, input epoch, and intent
revision. It asserts the target ID is present and the intent revision is
unchanged. No duplicate navigation command, DOM oracle, private state, second
store, or compatibility API is introduced.

## Exact uniqueness precheck

The central migration ledger has one `TC-0561` row for
`tests/conversation-viewport.test.js:77`; the historical inventory maps it to
`AD-267`. Exact searches for `TC-0561`, `TC0561`, `AD-267`, `AD267`, the
baseline title, the current declaration, and adjacent identity-binding text
found no reservation report, claim commit, branch, or worktree before this
reservation. TC-0560 covers one-shot activation/epoch consumption, while
TC-0562 covers current downward evidence; neither is reused here.

## Current public owner

The current public owner is the named reading-session model in
`src/model/reading-session.js`: `requestLatest` owns the one explicit
return-to-tail intent and `bindLatestIntentTargets` is its public durable-ID
correlation transition. The retained test reaches these exports directly
through the existing local `session` wrapper. No private hook/export or
alternate scrolling authority is needed.

## File boundary and atomic claim

Only this report and the existing `tests/conversation-viewport.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.

## Closeout — 2026-09-22

- **Reservation commit:** `a267d40` (`chore(a-d): reserve TC0561 durable target binding`).
- **Migration:** the retained declaration is tagged `[TC-0561][AD-267]`; its
  original `latest` request, matching authority tuple, stable target ID, and
  unchanged `intentRevision` assertions remain intact. No test was
  deleted/skipped and no private oracle, second store, or product code was
  introduced.
- **Focused:**
  `npm test -- tests/conversation-viewport.test.js --run -t 'TC-0561' --reporter=verbose`
  — **1 passed, 20 selection skips**; the skips are Vitest selection output,
  not skipped declarations.
- **Owner suite:**
  `npm test -- tests/conversation-viewport.test.js --run --reporter=dot`
  — **21 passed, 0 failed**.
- **Adjacent reading suites:**
  `npm test -- tests/reading-session-ports.test.js tests/reading-navigation-coordinator.test.js tests/reading-geometry.test.js --run --reporter=dot`
  — **17 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. The public
  reading-session owner enriches the existing one-shot tail intent with
  durable message identity without advancing its intent revision or creating a
  second bottom authority. No product change or semantic weakening was needed.
- **Final commit:** recorded below after this closeout and test-only tag.
