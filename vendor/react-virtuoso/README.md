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

Apply the files under `patches/` to a clean checkout of the upstream commit in
this exact order:

1. `base-0c5-formal-gate.patch`
2. `observer-generation-delta.patch`
3. `formal-flow-invariant-delta.patch`
4. `stable-observer-delta.patch`
5. `formal-prop-stability-delta.patch`
6. `formal-tail-flow-delta.patch`
7. `browsing-anchor-delta.patch`

| patch | SHA-256 |
| --- | --- |
| `base-0c5-formal-gate.patch` | `eea020d008098b85d1dac48fd3643eeca176dbf0f5a350e6ffeafe1ec5de276c` |
| `observer-generation-delta.patch` | `4dcc3142a9c0edfb0f0d273df369b9bb5cb1e24814f412e86f5f4f38c3bf74e3` |
| `formal-flow-invariant-delta.patch` | `5327b3f66a246d422cccf1bf596f4ce0146f443a5c8b371d763955128af6f252` |
| `stable-observer-delta.patch` | `522d35f3b11835b38cb63c52c2994e2cf2f7123a3240fe429af7d25b1d020693` |
| `formal-prop-stability-delta.patch` | `d9a3dee03a9b00dbca7daed8ed2e027c34952eeef549161220e2f30cd7d0be32` |
| `formal-tail-flow-delta.patch` | `4f83cb255924b64c8a5ac3d5b49491b6c65a1ff3251a7888e67d1eff151ff91e` |
| `browsing-anchor-delta.patch` | `cdc5b8508afa4212c57e40a6d6a92a794a2a6f52500a277456872e47fed07ca0` |

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

To reverse the source patch, apply the seven patches with
`git apply --reverse` in reverse order. To roll back this application, restore
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
