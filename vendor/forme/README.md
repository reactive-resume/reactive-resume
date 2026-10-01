# Rebuild the Reactive Resume Forme engine

Upstream source: https://github.com/danmolitor/forme
Commit: `86f0d67781c6265e3796995a7755ddc62b980d67` (`v0.26.0`).
Published JavaScript/TypeScript wrapper package: `@formepdf/core@0.26.0`.
Patch: `unicode-extraction.patch`, applied relative to repository root.
Artifact SHA-256: `592034a69eb2c266d0a8f1fa5f71c9ea8c8c028b20622357be4e0435f77222ff`.
Each optimized WASM target is 6,923,466 bytes. The package includes the upstream MIT license.

Published 0.26.0 passes native ligature and plain Hebrew/Japanese extraction checks, but eight
application regressions still fail: Arabic, Hindi, Hebrew vowels, emoji, and fallback spacing.
This patch preserves those exports while the project uses the 0.26.0 wrapper and package family.

## Prerequisites

- Rust 1.95.0 with `wasm32-unknown-unknown` target.
- wasm-bindgen CLI 0.2.108 (matches upstream Cargo.lock).
- Binaryen wasm-opt 133.
- Python 3.12 or newer; Git; pnpm 12.8.1 for installed-package verification.

Tested build used the installed stable Rust 1.95.0 toolchain, invoked with `cargo +stable`.
Upstream's rust-toolchain requests 1.98.0; an explicit toolchain overrides it.

## Commands

```sh
git clone https://github.com/danmolitor/forme forme-source
git -C forme-source checkout 86f0d67781c6265e3796995a7755ddc62b980d67
git -C forme-source apply /absolute/path/to/unicode-extraction.patch
cd forme-source/engine
cargo +1.95.0 test --locked --lib --no-default-features
cargo +1.95.0 build --locked --release --target wasm32-unknown-unknown --features wasm --lib
```

Create a working copy of published `@formepdf/core@0.26.0` (use `prepare-vendor.py` below).
Retain all `dist/` JavaScript and declarations, README, scripts, licenses, and original
wrapper dependency versions. Set package version `0.26.0+reactive.1`.

```sh
python3 prepare-vendor.py /absolute/path/to/vendor-core
wasm-bindgen forme-source/engine/target/wasm32-unknown-unknown/release/forme.wasm --target nodejs --out-dir vendor-core/pkg-node --out-name forme
wasm-bindgen forme-source/engine/target/wasm32-unknown-unknown/release/forme.wasm --target web --out-dir vendor-core/pkg-web --out-name forme
wasm-bindgen forme-source/engine/target/wasm32-unknown-unknown/release/forme.wasm --target bundler --out-dir vendor-core/pkg --out-name forme
```

Keep `pkg-node/package.json` type `commonjs`; `pkg/package.json` and
`pkg-web/package.json` type `module`. These already exist in published package.
For each of three `forme_bg.wasm` files, optimize to a temporary output then replace:

```sh
wasm-opt vendor-core/pkg-node/forme_bg.wasm -o optimized.wasm -O --enable-bulk-memory --enable-sign-ext --enable-reference-types --enable-multivalue --enable-nontrapping-float-to-int
```

Repeat for `pkg-web/forme_bg.wasm` and `pkg/forme_bg.wasm`. Use `-O` for parity with
wasm-pack release optimization; retain generated binding files from same build.

```sh
python3 pack-vendor.py vendor-core formepdf-core-0.26.0-reactive.1.tgz
```

`pnpm pack` normalizes away SemVer build metadata. `pack-vendor.py` preserves it
and generates a deterministic archive from package files, with timestamp zero.

## Verification

- Upstream Rust unit suite: 243 passed.
- Published Node and worker wrappers installed from tarball: 28 extraction checks passed
  using unpatched PDF.js 6.3.289, no engine warnings.
- Six captured ResumeDocument cases preserve Arabic vowels, emoji spacing, and joined emoji
  across font fallback runs in both wrappers.
- Independent Apple PDFKit: exact audited scripts, vocalized Hebrew/Arabic, conjunct Hindi,
  repeated vowel variants, multi-codepoint emoji, Latin ligatures, mixed Latin/RTL with
  explicit document direction.
- Raw LTR paragraph whose text is predominantly RTL is reordered by both readers'
  direction heuristics; metadata direction must match intended document paragraph.
- Arabic/Hindi scalar-layer raster comparisons: original ink bounds preserved at 3×,
  with only small edge antialiasing changes.

Run the actual application regressions from the workspace root:

```sh
pnpm --filter @reactive-resume/pdf test src/forme/export-text.integration.test.ts src/forme/ligatures.integration.test.tsx
pnpm test:e2e tests/e2e/specs/pdf-text.spec.ts
```

Browser tests require the disposable database and production build described in
`tests/e2e/README.md`. Keep this artifact until a published Forme version passes these
checks with native ligatures enabled, then remove the override and vendored files together.
