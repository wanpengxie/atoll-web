# Vendored react-virtuoso 4.18.13

This directory contains the trace-free Atoll build of
`react-virtuoso@4.18.13`. It is derived from upstream git commit
`ebd6b0f0ff41e1fe003a50fe47b168b3ed698868` under the included MIT license.

The package version remains `4.18.13`; identify this build by hashes:

- tarball SHA-256:
  `dfca0ad585da9c189ce10240c99e54ebc51da1cd5413e10652e733ccecd33491`
- installed `dist/index.mjs` SHA-256:
  `a6b71abd550ab5710112c987f6b1022ad56bcd192b5b1b09538108b70dfd9a87`
- npm integrity:
  `sha512-S/xzfAEv46ZLX29ceaLA1Ma02mFd9436u8fxg70htcqO1NAUkkbdrvIhmC65ApjcPw6PBLHrF2U4WLPMzmVrmg==`

## Rebuild

Apply `atoll-react-virtuoso-4.18.13.patch` to a clean checkout of the upstream
commit. The repository intentionally keeps one source patch rather than the
superseded sequence of investigation deltas.

| patch | SHA-256 |
| --- | --- |
| `atoll-react-virtuoso-4.18.13.patch` | `cd943a35f4c6b51f97ffe3958027e1acc974b9905d58e044553b039dd1e3965a` |

Then use the upstream pinned toolchain:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm --filter react-virtuoso test
corepack pnpm --filter react-virtuoso typecheck
corepack pnpm --filter react-virtuoso lint
corepack pnpm --filter react-virtuoso format:check
corepack pnpm --filter react-virtuoso build
```

Expected output hashes:

| file | SHA-256 |
| --- | --- |
| `dist/index.mjs` | `a6b71abd550ab5710112c987f6b1022ad56bcd192b5b1b09538108b70dfd9a87` |
| `dist/index.cjs` | `2a18a7730c0eefc333f421cf2406a48dd5964bb96cbe11cc398ab63d70bb1e50` |
| `dist/index.d.ts` | `a116bbb766f6c83b9449de5dda6c31d5a11487c57e09181dba72799b4c7f9c73` |

To reverse the source patch, apply it with `git apply --reverse`. To roll back
this application, restore
the dependency and lockfile to registry `react-virtuoso@4.18.13`, perform a
clean lock-based install, and rerun the same tests. Do not edit `node_modules`
in place as a deployment mechanism.

The application uses npm scripts and `package-lock.json` as its operational
install path. Its tracked `pnpm-lock.yaml` is also synchronized to this exact
tarball so either package manager cannot silently select the registry build.

The application adapter is committed together with this package on the exact
`00d9566dfc131a66fa9f1cdcfb3c00dc94249736` application base. It preserves
the current cold/EOF transaction, Composer geometry isolation, channel-file
request ownership, and history-start role while adding reciprocal visual-slot
handoff and the bounded Browsing expansion lease.
Do not reconstruct the adapter by copying an older full
`Timeline.jsx` over the current application.
