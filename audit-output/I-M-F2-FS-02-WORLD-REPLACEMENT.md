# I–M F2-FS-02 — Files route isolation at world/empty replacement

## 裁决

**ACCEPT candidate / corrected owner boundary.** This worktree is based on
`9983b53` and corrects the rejected `5c8708b` navigation candidate. The
channel-scoped Files behavior remains one user contract; the correction adds
the missing world/empty lifecycle fence and invalid-URL fallback.

## User capability and invariants

- A user can open Files in channel A, switch to an unseen channel B, and only
  see Files in B after explicitly opening it; returning to A restores only A's
  previously opened Files view.
- When the authoritative channel directory is replaced by an empty world
  snapshot, the old active channel/view is retired synchronously. A later B
  selection starts on `conversation`, and no per-channel Files memory from the
  old world survives.
- An invalid `#/channels/<missing>/files` URL is a navigation request, not a
  Files grant. The first valid channel B falls back to `conversation`.
- `useChannelNavigation` is the sole route/visibility owner. Directory,
  device, selection, and resource data remain in the existing
  `useAttachmentTransactions` owner; no second route/store or compatibility
  path is added.

## Rejected-candidate gap and minimal correction

The rejected `5c8708b` candidate restored Files per channel but only cleared
the per-channel set on `setChannels(new Map())`. It left `activeViewRef` and
React `activeView` at `files`, so a world/empty replacement could leak Files
into the next channel. It also preserved the initial `files` view when an
unknown URL was replaced by the first valid channel.

The current owner correction in
`src/app/hooks/useWireSession.js`:

1. `setChannels(empty)` and `clear()` clear the Files-memory set and
   synchronously commit empty active channel, `conversation`, and null focus.
2. Automatic channel fallback preserves the requested view only when the
   requested URL channel is valid; otherwise it writes `conversation`.
3. Normal channel selection keeps the existing bounded channel-scoped Files
   set. Tasks' existing temporary return handoff is unchanged.

Composer/mobile picker behavior is outside this change and was not modified.

## Tests

Unit coverage in `tests/channel-navigation-route.test.jsx` includes:

- A Files → empty world → new B sequence, followed by reintroducing A to prove
  the old Files memory is gone.
- Invalid Files URL → valid B fallback to `conversation`.
- Existing per-channel Files isolation and Tasks return behavior.

Browser coverage in `tests/browser/f2-files-split.spec.js` exercises the real
public owner at both desktop and mobile widths: A Files directory, unseen B
conversation, explicit B Files directory, and A Files directory restoration.

## Evidence

- Base: `9983b5352d10c5ec76934efbb3f3b70265662ea1`.
- Branch: `unit-i-m/f2-fs-02-world-9983b53`.
- Worktree: `.worktrees/im-f2-fs-02-world-9983b53`.
- Focused unit: `npx vitest run tests/channel-navigation-route.test.jsx --retry=1`
  → **9/9 passed**.
- Desktop/mobile isolation: `npx playwright test tests/browser/f2-files-split.spec.js --grep 'F2-FS-02 desktop|F2-FS-02 mobile'`
  → **2/2 passed**.
- Full F2 split: `npx playwright test tests/browser/f2-files-split.spec.js`
  → **9/9 passed**.
- `npm run build` → **passed** (existing large-chunk warning only).

The broader `workspace-real-runtime-composition` suite still has three
pre-existing mock-composition failures in roster/waiting assertions; that suite
mocks navigation and is outside this owner boundary. No Composer, vendor,
package, lockfile, notification, or Feed files changed.
