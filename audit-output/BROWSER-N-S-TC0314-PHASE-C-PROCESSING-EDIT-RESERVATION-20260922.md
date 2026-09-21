# Browser N–S — TC-0314 atomic reservation

## Claim and de-duplication

This reservation claims exactly one previously unclaimed Browser N–S baseline
declaration:

- **Case:** TC-0314
- **Legacy declaration:** `fae8b70:tests/browser/phase-c.spec.js:159`
- **Legacy title:** `C-BR-03a processing edit 保持 Reading DOM，并完整交接焦点与普通草稿`
- **Central ledger row:** `audit-output/TEST-CASE-MIGRATION-LEDGER.md` (TC-0314)
- **Claim base:** `357de99c273e1e9da1cd87e95eb20465b627e7a2`
- **Planned successor:** `tests/browser/tc0314-phase-c-processing-edit.spec.js`
- **Public owner boundary:** Composer processing-edit handoff and the public
  Reading stack in `WorkspaceApp`

Before this reservation, the repository-wide scan covered the current detached
HEAD, all reachable refs, every registered worktree, tracked browser specs,
and `audit-output/`. Exact searches for `TC0314`, `C-BR-03a`, and the
legacy title found only the central ledger row and the copied legacy
`phase-c.spec.js` declaration. No TC-0314 successor, reservation, audit
packet, claim branch, or active worktree was found.

The neighboring Phase-C rows are explicitly excluded:

- TC-0312 is already owned by Browser N–S;
- TC-0313 is already owned by T–Z;
- TC-0315, TC-0316, TC-0317, and TC-0318 are separate interrupt/Waiting
  contracts and are not this processing-edit handoff;
- TC-0319 is already owned by T–Z.

The existing `ad027-processing-edit.spec.js` is an adjacent Composer owner
probe: it adds an imperative-scroll writer check and uses a separate AD027
scenario. It does not reserve or replace this exact baseline declaration,
whose public contract is Reading-stack continuity, edit focus handoff, and
ordinary-draft preservation across the processing edit.

This is a test/audit-only reservation. No product, vendor, package, lockfile,
fixture, skip, or existing assertion is changed.

## User contract retained

While a submitted turn is processing, starting and cancelling an edit must:

1. keep the same public Reading stack mounted;
2. transfer focus to the Composer edit state;
3. preserve the ordinary unsent draft after cancelling the edit; and
4. leave the public timeline in following mode without a hidden replacement
   writer or a second user-visible Reading surface.

The successor will use only real Chromium actions and public DOM observations.
Private React state, diagnostics, fiber handles, and implementation
fingerprints are not verdicts.

## Reservation gate

The successor and exact repeat/build evidence are to be added in the next
test-only commit on this detached worktree. If the public path is red, the
first reportable owner boundary is the Composer/Reading handoff in
`src/ui/composer/Composer.jsx` and the surrounding `WorkspaceApp`
composition; this reservation does not authorize a product change.
