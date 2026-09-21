# Browser G–M case 8 / TC-0252 public underfill migration

Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`).
Current exact candidate: `86a8d4d57bc568ffb8cbc1958a3df3a4bb2506df` (`86a8d4d`).

## Atomic ledger claim

The unique migration ledger row is TC-0252:

```text
fae8b70:tests/browser/history-underfill-lifecycle.spec.js:16
identity-pending all-scope underfill stays silent and resumes from scheduler progress
```

A repository-wide scan of tracked reports, browser specs, branches, and commit
messages found no prior TC-0252 successor, case-8 claim, or equivalent
underfill credit. TC-0250 and TC-0251 are the two separate history-boundary
declarations; TC-0253 is the separate horizontal-table declaration. This
commit claims exactly one previously uncredited G–M declaration: **TC-0252 /
case 8**.

## Preserved public contract

The old test drove a private `history-underfill-lifecycle.html` scheduler and
observed its internal request/confirming/partial state. The user capability
behind that fixture is narrower and public: when older history is underfilled,
the user must keep a readable timeline while the real history consumer makes
progress; the surface must not present a false empty state or leave a visible
pending demand after older content becomes available.

The successor `tests/browser/tc0252-history-underfill-public.spec.js` uses the
real `/` login and production timeline with the existing `deep-history` mock
scenario. It performs real upward wheel input, then asserts only public
observable facts:

- the target older row `c0 history 1: ask steward for PONG` becomes visible;
- one active `.timeline-message-list` remains mounted with visible rows;
- presentation row identities contain no duplicate IDs;
- no visible pending history demand or false partial-empty ledger remains.

The test does not read `window.__ATOLL_DIAGNOSTICS__`, scheduler state,
React state, wire frames, storage, source fingerprints, or private fixture
exports. The original scheduler cardinality is deliberately not presented as
a user-visible pass gate; only the visible outcome is migrated.

## Exact Chromium evidence

Detached worktree: `/tmp/gm-case8-tc0252-86a8d4d`

```text
ATOLL_TEST_WEB_PORT=15351 ATOLL_TEST_MOCK_PORT=19351 \
  npx playwright test tests/browser/tc0252-history-underfill-public.spec.js \
  --repeat-each=5 --workers=1 --reporter=line \
  --output=test-results-gm-tc0252-public-repeat5
```

Result: **5/5 passed** in Chromium (`46.3s`).

```text
npm run build
```

Result: **passed** (`4306 modules`; existing large-chunk warning only).

No product source, mock scenario, fixture, vendor, package/lockfile, snapshot,
or existing browser spec was changed. `git diff --check` passed.

## Result and credit

**ACCEPT — test/audit-only public migration.** TC-0252 is now the unique
G–M case-8 credit. The public user contract passes repeat5 on the exact
candidate; internal scheduler diagnostics remain out of the oracle.
