# Native Forme bridge

Expo SDK 58 / React Native 0.88 module backed by `forme-pdf = "=0.29.0"`. No WASM or WebView is used by the renderer or subsetter.

## Build

Install rustup, Xcode, Android SDK/NDK 28.2.13676358, cargo-ndk 4.1.2 and **cbindgen 0.29.4**, then run:

```sh
cargo install cbindgen --version 0.29.4 --locked
cargo install cargo-ndk --version 4.1.2 --locked
bash packages/forme-native/rust/build.sh
```

`rust/rust-toolchain.toml` pins Rust **1.95.0** and installs the two iOS and three Android targets through rustup. `build.sh` rejects any other cbindgen version before generating files. Run Cargo commands from `rust/` so rustup picks up that pin. The local build script requires macOS; EAS uses the prebuilt flow below.

This generates `ios/include/forme_native.h`, `ios/FormeNative.xcframework` (arm64 device and simulator), and Android `src/main/jniLibs/{arm64-v8a,armeabi-v7a,x86_64}/libforme_native.so`. Generated binaries are ignored; build them before Expo prebuild/pod install/Gradle. `CARGO_BUILD_JOBS` defaults to 4. Commit the Cargo lockfile with version changes.

Add this workspace package to the Expo app. Expo autolinking discovers its Swift and Kotlin modules. The Android adapter builds a small JNI library with CMake. The iOS deployment target is 17.4 and Android minimum is API 24.

## EAS prebuilt binaries

The manually dispatched `.github/workflows/mobile-forme-build.yml` builds both platforms on macOS with the pinned Rust tools and NDK. It packages the generated header, arm64 device/simulator xcframework, and all three Android `jniLibs` into one archive. Linux Android workers and macOS iOS workers need only Node and `tar`; they never run Cargo. Local development keeps `bash rust/build.sh`.

Each archive and workflow artifact is named `forme-native-v<package-version>-<source-hash>`. The hash covers sorted relative paths and SHA-256 file contents of every file under `rust/`, excluding the generated `rust/target/` directory. This includes the Cargo lockfile, build script, toolchain pin and cbindgen configuration. Changing any input requires a new pin. The archive has a separate SHA-256 because rebuilding the same source is not assumed to produce byte-identical archives.

To prepare an EAS build:

1. Dispatch the workflow on the intended source commit. It always saves the archive and `prebuilt.json` as a workflow artifact (30-day retention). Enabling its explicit `publish` input also creates a prerelease with both files; existing release assets are never overwritten. This workflow is authored only: no dispatch, upload or release was performed for M8-T2a.
2. Review the workflow result and generated manifest. Publish the corresponding release asset if it has not been published, then commit the generated manifest to `packages/forme-native/scripts/prebuilt.json`. The HTTPS URL and exact archive checksum must be reviewed together. **Never download a manifest/checksum at build time or pin a locally repacked archive to a different CI archive.** Preserve older entries only if older source hashes still need builds.
3. M8-T2/coordinator adds the following script to `apps/mobile/package.json` (owned by M1-T1), alongside its EAS profiles:

   ```json
   {
     "scripts": {
       "eas-build-pre-install": "node ../../packages/forme-native/scripts/fetch-prebuilt.mjs"
     }
   }
   ```

Use **pre-install**, not post-install: EAS post-install runs after Expo prebuild and, on iOS, pod install. The fetcher uses only Node built-ins, so it works before dependencies are installed. It locates the workspace package relative to its own script, independent of the current directory. It runs only when `EAS_BUILD_PLATFORM` is `ios` or `android`; there is no package or workspace install hook, so ordinary web/server installs do not fetch anything. Ensure a custom `.easignore`, if added, includes this package's scripts, Rust sources and checksum manifest.

The checked-in manifest initially has no pins: publishing is outside this local-only task. EAS deliberately fails with the local build command until the first approved artifact is published and pinned. No unverified download, automatic Rust installation or local fallback runs on EAS.

Fetch checks package version and current Rust hash, validates the pinned SHA-256 before extraction, rejects unexpected archive paths/symlinks and checks both iOS slices, header and all Android libraries before installing generated files. Both platforms are installed together because Android needs the header too. Downloads, extraction and validation finish before existing binaries are replaced; a failed download/checksum leaves previous files intact. Generated libraries and temporary extraction directories stay gitignored. No runtime adapter, podspec or Gradle changes are needed.

Local reproduction, from the repo root (build first):

```sh
node packages/forme-native/scripts/artifact.mjs identity
node packages/forme-native/scripts/artifact.mjs pack /tmp/forme-native-prebuilt
node packages/forme-native/scripts/fetch-prebuilt.mjs --platform android --manifest /tmp/forme-native-prebuilt/prebuilt.json
node packages/forme-native/scripts/fetch-prebuilt.mjs --platform ios --manifest /tmp/forme-native-prebuilt/prebuilt.json
```

Explicit `--platform` enables local verification; `file:` URLs are accepted only with an explicit local `--manifest`. Production pins must use HTTPS. A missing pin, wrong checksum, stale Rust input, missing library or HTTP error produces a failure with `bash packages/forme-native/rust/build.sh` as the local recovery command.

## Third-party notices

`THIRD_PARTY_NOTICES.md` is generated from `cargo metadata --locked`, the resolved crate manifests and their bundled licence/notice files. Regenerate after changing Cargo dependencies:

```sh
node packages/forme-native/scripts/notices.mjs
```

Run on a development/CI machine with the pinned Rust toolchain; EAS does not generate notices. The output includes all resolved crates (including build and target-specific dependencies), their upstream licence expressions and texts, HarfBuzz's **Old-MIT** copyright/permission text, and its bundled Microsoft USE notice. `cms 0.2.3` publishes no separate licence files; its README's Apache-2.0-or-MIT declaration is preserved explicitly. CI rejects stale notices and a changed generated header. M8-T2 consumes this Markdown in the app licences screen; the app manifest/export list is intentionally unchanged here.

## JavaScript API

```ts
import { fetch } from "expo/fetch";
import { nativeEngine, renderSerializedDocWithLayout, subsetFont } from "@reactive-resume/forme-native";
import { configureFontReader, configureImageFetch, downloadFont, renderResumePdf } from "@reactive-resume/pdf/native";

const result = await renderSerializedDocWithLayout(document);
// result.pdf: Uint8Array; result.layout and result.warnings match the core types.
const subset: Uint8Array = await subsetFont(fontBytes, documentText);

// Configure once at startup. A disk-cache wrapper must use downloadFont on disk errors.
const streamingFetch = fetch as unknown as typeof globalThis.fetch;
configureFontReader((source, options) => downloadFont(source, streamingFetch, options));
configureImageFetch(streamingFetch);
const pdf = await renderResumePdf(nativeEngine, { data, onPageMap, onLostCharacters });
```

Both expensive operations execute on dedicated serial native workers: a Swift dispatch queue on iOS and an executor-backed coroutine scope on Android, separate from Expo's shared async queue. Android closes the worker when the module is destroyed. Expo still handles result conversion and Promise rejection. JSON serialization and font-byte base64 encoding still run in JavaScript. Only `fonts[].src` `Uint8Array` sources become data URIs, without mutating the input. Font/image URLs must be resolved by the caller; this bridge performs no downloads. Both operations reject on invalid input; Rust panics are contained at the C ABI. Out-of-memory aborts cannot be recovered.

`nativeEngine` is structurally compatible with `FormeEngine` from `@reactive-resume/pdf/native`. Its async font preparer adds generated digits, hyphens and fallback punctuation, caches the last prepared data URI per font/character set, and embeds the full font if subsetting fails, matching the browser policy. `subsetFont` remains available for direct use; do not pass it into the synchronous browser `createFontPreparer`.

Font downloads and `configureImageFetch` require a streaming response body; pass `expo/fetch` on mobile as above. Images stop downloading at 12 MB; there is no whole-body fallback. The app owns persistent font caching through `configureFontReader`; `downloadFont` retains the Google-host fallback and fails after 30 seconds without download progress. Shared font conversion stays inside `packages/pdf`.

HarfBuzz 8.4.0 is bundled through `harfbuzz-sys 0.8.0`. Its subsetter preserves Unicode mapping and all layout features, matching the browser policy. Typst `subsetter` was rejected because it removes the Unicode cmap and targets already-shaped PDF glyph embedding.

Native `serde_json` writes absent `style.backgroundColor` as `null`; WASM's `serde_wasm_bindgen` writes `undefined`, omitted when JSON is saved. S1 lists every such difference. No layout geometry or warning differences are accepted silently.

## C ABI

Use the generated header. `forme_render_with_layout` and `forme_subset_font` return owned `FormeResult` pointers. Input spans must remain valid during each call. Copy outputs before calling `forme_result_free` exactly once; subset bytes occupy `result.pdf`. `result.error.len > 0` denotes failure. Freeing a null result is allowed. Never free buffers separately or mix allocators.

Fixtures and their fonts are test-only and are not imported by the module. Font licenses are in `fixtures/licenses`. Reproduction app and scripts live under `apps/spike-s1`; that scratch app is excluded from integration.
