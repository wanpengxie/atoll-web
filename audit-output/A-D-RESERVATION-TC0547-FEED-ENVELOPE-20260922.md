# A–D reservation — TC-0547 / AD-253 feed envelope vocabulary

## Reservation

- **Case key:** `TC-0547` (A–D alias `AD-253`)
- **Baseline:** `fae8b70:tests/contract-fixtures.test.js:18`
- **Baseline title:** `keeps feed envelope fields within the real closed vocabulary`
- **Current base:** `165453af9b8fd552d7c21835ab065b3e89fe5274`
- **Branch:** `unit-a-d/tc0547-envelope-165453a`
- **Worktree:** `/home/xiewanpeng/.atoll/device/daemons/local-device/channels/c0.dev/atoll-web-tc0547-envelope-165453a`
- **Allowed change:** this report and the existing declaration in `tests/contract-fixtures.test.js`; no product source, package, lockfile, vendor, fixture, private export, or unrelated test.

## User capability and invariant

An authoritative downstream feed frame must carry a recognizable protocol
envelope so the client can associate the feed with the channel it renders.
The invariant is the existing public protocol contract: every key on the
fixture's real feed envelope belongs to the closed `ENVELOPE_FIELDS` vocabulary,
and the envelope's `channel_id` equals the frame's channel identity. This is a
contract/diagnostic proof, not a second frontend authority: it does not invent
fields, normalize a server result, or claim that a fixture is a live feed.

## Exact uniqueness precheck

The central migration ledger has one `TC-0547` row for
`tests/contract-fixtures.test.js:18`; the historical inventory maps it to
`AD-253`. Exact searches for `TC-0547`, `TC0547`, `AD-253`, `AD253`, the
baseline title, and the declaration found no reservation report, claim
commit, branch, or worktree before this reservation. TC-0546 is separately
held by `unit-e-h/tc0546-downstream-509a43c` and is not touched.

This claim is distinct from TC-0546's all-frame parser acceptance, TC-0548's
OBS observation-kind completeness, and TC-0549's terminal payload carriers.
It also does not overlap the earlier content-plan contracts TC-0533–0545:
those prove parser/identity/text-point behavior, while this case proves only
the feed envelope's closed field vocabulary and channel identity.

## Current public owner

The existing public protocol owners are `parseDownstream` from
`src/protocol/frame.js` and the named `ENVELOPE_FIELDS` vocabulary from
`src/protocol/envelope.js`, exercised by the current contract-fixture test.
The test uses the checked-in contract fixture as its explicit downstream
shape and does not export or call a private parser/helper. Its setup, feed
envelope lookup, closed-key assertion, and channel-id assertion remain
unchanged; migration adds only the case tag.

## File boundary and atomic claim

Only this report and the existing `tests/contract-fixtures.test.js`
declaration may change. Product source, vendor, package, lockfile, fixtures,
private exports, and unrelated tests are out of scope. The worktree
`node_modules` symlink is untracked test infrastructure and must not be
committed.

This is an atomic claim: this reservation report is committed before changing
the test declaration. Closeout will append focused, adjacent, and build
evidence plus the final PASS or bounded regression disposition.

## Closeout — 2026-09-22

- **Reservation commit:** `99cb4a8` (`claim TC0547 feed envelope baseline`).
- **Migration:** the existing declaration is tagged
  `[TC-0547][AD-253]`; fixture selection, `ENVELOPE_FIELDS` closed-key
  assertion, and `channel_id` identity assertion remain unchanged. No test was
  deleted/skipped and no private oracle, frontend authority, or compatibility
  path was added.
- **Focused:**
  `npm test -- tests/contract-fixtures.test.js --run -t 'TC-0547' --reporter=verbose`
  — **1 passed, 3 selection skips**; the skips are Vitest selection output,
  not skipped declarations.
- **Adjacent owner suite:**
  `npm test -- tests/contract-fixtures.test.js --run --reporter=verbose` —
  **4 passed, 0 failed**.
- **Adjacent protocol suites:**
  `npm test -- tests/envelope.test.js tests/frame-fields.test.js tests/frame.test.js --run --reporter=dot`
  — **14 passed, 0 failed**.
- **Build:** `npm run build` — **passed**; Vite emitted only the existing
  large-chunk advisory.
- **Disposition:** **PASS / MIGRATED**, credit `1`. The current public
  protocol vocabulary accepts the authoritative feed envelope without unknown
  fields and preserves its channel identity. No product change or semantic
  weakening was required.
- **Final commit:** recorded below after this closeout and test-only tag.
