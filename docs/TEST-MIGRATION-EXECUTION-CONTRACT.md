# Test migration execution contract

This contract governs every unit and browser test migration performed after the
subtractive frontend rewrite. Passing tests are evidence, not the source of the
product model.

## Objective

Preserve the user-visible capability and architectural invariant represented by
each baseline test while expressing it through the current public owner. Do not
restore deleted architecture merely to make an old test load.

## Required case record

Every baseline case must receive one ledger row before it is changed:

1. Baseline file and exact case name.
2. User-visible capability protected by the case.
3. Architectural invariant protected by the case.
4. Current production owner and public entry point.
5. Baseline setup, action, and observable result.
6. Current result: pass, product regression, obsolete implementation oracle, or
   blocked pending a product decision.
7. Proposed disposition and concrete evidence.

No suite-level summary may stand in for case-level accounting.

## Allowed work

- Rewrite imports, fixtures, selectors, and assertions to exercise an existing
  current public owner while preserving the same capability and invariant.
- Remove assertions that only inspect a deleted implementation detail, provided
  the ledger identifies the replacement behavioral assertion.
- Report a reproducible product regression without modifying product code.
- Run the smallest relevant verification while migrating, then the frozen-head
  aggregate verification after review.

## Forbidden work

- Delete or skip a case because it does not import, is difficult, or is red.
- Declare a capability obsolete without an explicit product decision from root.
- Export a private production helper, add a compatibility API, or restore an old
  store/owner solely for a test.
- Modify vendor packages, package manifests, lockfiles, or dependency patches.
- Add a second source of truth, fallback owner, mirrored state, or test-only
  product branch.
- Weaken a behavioral, geometry, accessibility, timing, ownership, or failure
  assertion merely to obtain green output.
- Treat source text fingerprints, mocked success, or hidden UI as product parity.

## Product-regression handoff

When a case exposes a product gap, the test worker must stop product editing and
return this packet:

- minimal reproduction;
- baseline behavior and current behavior;
- first public owner boundary where they diverge;
- affected user capability and invariant;
- evidence showing that the problem is not just a stale fixture.

Only an explicitly assigned owner may change product code. That owner must keep
the existing ownership model and may not change the test merely to approve its
implementation.

## Browser-specific requirements

- Exercise the real production entry unless the baseline contract is genuinely
  component-local.
- Compare layout, content count, ordering, focus, keyboard/pointer behavior,
  accessibility, scroll ownership, loading/error feedback, and persistence.
- A selector migration is incomplete until the same user action and observable
  result have been demonstrated.
- Screenshots and frame traces supplement behavioral assertions; they do not
  replace them.

## Acceptance gates

A task is accepted only when root can inspect:

- the complete case ledger for the assigned range;
- the test diff and any separate product-regression packets;
- proof that no forbidden production boundary changed;
- focused verification results;
- a list of unresolved cases, with no implicit deletion.

Aggregate green status is evaluated only after all individual cases have an
accepted disposition on one frozen commit.
