# Browser G–M case 4 / TC-0247 CAS

Date: 2026-09-22  
Baseline: `fae8b7010afd1b3a950bc455ba6a577b65378cda` (`fae8b70`)  
Current base: `e409c5109b3fa5f99b176484c03b055404f1bda1` (`e409c51`)

## Atomic ledger and cross-browser CAS

The central migration ledger records this declaration as:

```text
TC-0247 — fae8b70:tests/browser/history-reveal-prototype.spec.js:294
status identity, background isolation, bounded queue, and reduced motion stay explicit
target a8c9165: path absent; blocked pending product decision
```

The old declaration is the third test in `history-reveal-prototype.spec.js`.
The G–M migration packet already has a current public successor, but no
dedicated successor/CAS report or cross-browser packet claims TC-0247. The
adjacent TC-0248 activation-replacement declaration remains unclaimed by this
packet. Existing A–D, N–S, T–Z, and other browser packets searched by numeric
key, old source path, and contract title contain no equivalent TC-0247 claim.

The previously parallel TC-0292 audit was deleted as a duplicate and is not
part of this claim. This packet claims exactly one ledger declaration:
**TC-0247 / G–M case 4**.

## Preserved public contract

On the real `/` AppShell, under the documented `history-boundary` scenario and
reduced-motion preference:

1. Real wheel input reaches the authoritative history boundary. The exhausted
   boundary status remains one connected public DOM node while background
   activity arrives.
2. The active reading surface remains unique and has visible rows before and
   after the pulse; background activity must not blank or replace the readable
   tail.
   The old fixture's private `maxRenderedHistory`/queue counters are not
   treated as a product oracle here: the public bounded-history evidence is the
   finite boundary scenario plus one connected reading surface and visible
   rows throughout the background pulse.
3. The test uses production DOM, real Chromium input, public mock control for
   scenario setup/pulse, and a test-owned DOM identity witness. It does not
   read cache/IDB, React fibers, sequence counters, or private diagnostics.

## Exact Chromium evidence

Clean detached worktree:

```text
worktree: /tmp/gm-tc0247-e409c51
base:     e409c5109b3fa5f99b176484c03b055404f1bda1
```

Focused repeat-three run:

```text
ATOLL_TEST_MOCK_PORT=26147 ATOLL_TEST_WEB_PORT=17147 \
npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='history status identity and reduced-motion tail stay readable during background activity' \
  --repeat-each=3 --workers=1 --reporter=line \
  --output=/tmp/gm-tc0247-e409c51-r3
```

Result: **3 passed (23.0s)**.

Adjacent, not credited, TC-0248 smoke:

```text
ATOLL_TEST_MOCK_PORT=26148 ATOLL_TEST_WEB_PORT=17148 \
npx playwright test tests/browser/history-reveal-prototype.spec.js \
  --grep='channel activation replacement drops in-flight history without replaying old rows' \
  --workers=1 --reporter=line \
  --output=/tmp/gm-tc0247-e409c51-adjacent
```

Result: **1 passed (6.9s)**.

## Result

**ACCEPT — test/audit-only atomic claim.** TC-0247 is the next unique
previously uncredited G–M declaration; no product, mock scenario, fixture,
vendor, package, lockfile, skip, or oracle weakening is included.
