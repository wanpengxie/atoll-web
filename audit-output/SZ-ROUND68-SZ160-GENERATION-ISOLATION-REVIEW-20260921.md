# SZ-160 generation-fence isolation review

Date: 2026-09-21. Reviewed commit:
`e131801d7201d3c2ee3c54bf73d5772cd7ca8e37`.

## Review finding

The first SZ-160 fixture changed `sourceLease` together with `generation` and
also changed `hasOlder` on the replacement frame. That left the old/new
authority tuple confounded: the test did not isolate the generation fence.

## Test-only correction

The revised fixture keeps `sourceLease`, `hasOlder`, `messageCurrent`,
`headSeq`, `oldestSeq`, coverage, sync, and all other status authority facts
identical across the two committed frames. Only `generation` changes from 1 to
2; request functions remain distinct solely as the public operation ports being
tested. The test additionally asserts the replacement public status retains
the old frame's stable authority values while exposing generation 2.

The old generation's deferred `{ kind: 'exhausted' }` then settles after the
generation-2 commit. A current public `onNearTop()` still reaches request B
exactly once, proving the rejection is attributable to generation fencing and
not source-lease replacement or a changed `hasOlder` fact.

## Verification

```text
npx vitest run tests/sz160-history-generation-owner.test.jsx --reporter=dot
1 passed
npx vitest run tests/sz160-history-generation-owner.test.jsx --reporter=dot
1 passed
npm run build
success (Vite build)
```

Only the SZ-160 test and this audit report changed. No product source,
backend/protocol, vendor/package/lockfile, skip, compatibility path, private
export, or second cursor/store was changed.
