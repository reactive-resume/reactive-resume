# Mobile release workflow

`.github/workflows/mobile-release.yml` builds and uploads every release. It builds the app in `apps/mobile` on Blacksmith
runners (Linux for Android, Apple Silicon macOS for iOS): Expo Prebuild generates fresh native projects, Gradle and
Xcode compile them, and Fastlane (`tooling/mobile/fastlane/Fastfile`) signs and uploads them. There is no EAS Build,
EAS Submit or EAS Update, no `eas.json` and no `EXPO_TOKEN`. How a change reaches users:
[mobile releases](./mobile-releases.md).

## Triggers and jobs

- **Push to `main`** touching `apps/mobile/**`, `packages/**`, `patches/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  `tooling/mobile/**` or the workflow file runs a release.
- **Dispatch** (on `main` only) reruns a release.

A release runs three jobs:

1. `prepare` (environment `mobile-store`): runs the `tooling/mobile` Ruby tests, reads the app version from
   `apps/mobile/app.config.ts`, then Fastlane lane `store_build_numbers` reads the latest TestFlight build (for this
   version and overall, the higher of the two) and the highest version code in every Google Play track.
   `nextBuildNumber` in `tooling/mobile/release.ts` (tested in `release.test.ts`) turns them into one number for both
   platforms: equal readings advance by one; otherwise the next multiple of 10 above the higher one, so the platforms
   meet again on a round number. A store that cannot be read fails the run; nothing is guessed.
2. `build` (environment `mobile-signing`, iOS and Android in parallel, fail-fast): typecheck and `test:ci`, the iOS
   share-extension Swift test, fetch the pinned Forme binaries, `expo prebuild --clean` with `APP_VARIANT=production`
   and `MOBILE_BUILD_NUMBER`, then `fastlane <platform> build`. The signed AAB and IPA are kept 90 days; a separate
   `-evidence` artifact keeps `release.json`, source maps, dSYMs, R8 mappings and native symbols for 90 days.
3. `upload` (environment `mobile-store`, `main` only, after both builds succeed): `fastlane android upload` publishes
   to Play **Internal testing** (`completed`, with each locale's `releaseNotes` from `apps/mobile/store/metadata.json`);
   `fastlane ios upload` uploads to TestFlight and waits for processing, so a build App Store Connect rejects fails the
   run. Internal testers receive it through the TestFlight internal group's automatic distribution.

Runs queue (`cancel-in-progress: false`, `queue: max`) so each one reads the numbers the previous one uploaded. Never
rerun an old run after a newer one uploaded; dispatch a fresh release instead. Production submission and App Review
are done by hand in the store consoles from a tested internal build.

## Android APK mirror

`.github/workflows/mobile-android-apk.yml` polls daily at 03:07 UTC (and on dispatch) on a free hosted runner. Lane
`android production_release` reads the newest Play production release with status `completed` or `inProgress`; when
GitHub has no release `android-<versionCode>` yet, lane `android universal_apk` downloads the universal APK Play
generated from that bundle and the workflow publishes it, tagged at the commit Mobile release built it from (found
through the build's 90-day artifact, else `main`). Play signs the APK with the app-signing key, so it updates and is
updated by Play Store installs. It uses `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` from `mobile-store`, the same account that
reads tracks; it can also list and download generated APKs (checked 2026-11-14). A failed download (Play still generating the APK) retries on the next
poll.

## Secrets and environments

Create environments **`mobile-signing`** and **`mobile-store`**, both restricted to branch `main`, with no required
reviewers. Signing secrets go in `mobile-signing`, store secrets in `mobile-store` (or as repository secrets). Never
paste credentials into chat, source, logs or artifacts; base64 is encoding, not encryption.

Signing (`mobile-signing`):

- `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`: the existing
  Play upload keystore.
- `IOS_DISTRIBUTION_P12_BASE64`, `IOS_DISTRIBUTION_P12_PASSWORD`: Apple Distribution certificate and private key.
- `IOS_PROVISION_PROFILE_BASE64`: App Store profile for `me.rxresu`, team `654ASRW868`, including `group.me.rxresu`.
- `IOS_SHARE_PROVISION_PROFILE_BASE64`: App Store profile for the share extension `me.rxresu.expo-sharing-extension`,
  same certificate and app group.

Store (`mobile-store`):

- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: service-account JSON that can read the app's tracks and release to testing
  tracks.
- `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`: App Store Connect team API key (App Manager or Admin) used to read
  TestFlight build numbers and upload.

The production build reads no other variables: `app.config.ts` uses only `APP_VARIANT` and `MOBILE_BUILD_NUMBER`,
which the workflow sets. Add a new build-time variable to the build job's `env` from `vars` or `secrets` by name.

Keep bundle and package ID `me.rxresu`, the Apple team, app group and associated domains unchanged. Play App Signing
keeps its own certificate; `MOBILE_ANDROID_CERT_SHA256` on the server lists that one, not the upload key. CI writes
signing files with owner-only permissions into a temporary keychain and directory and removes them after the build;
it never changes Apple capabilities (native Apple sign-in uses the web Services ID `me.rxresu.web`). Renew
certificates and profiles before they expire and update the secrets.

## Local checks

No device, signing or network is needed:

```sh
node tooling/mobile/release.ts --version                       # with GITHUB_OUTPUT set
pnpm --filter @reactive-resume/tooling exec vp test run mobile/release.test.ts
ruby tooling/mobile/build_test.rb && ruby tooling/mobile/ios_build_test.rb && ruby tooling/mobile/distribution_test.rb
RUNNER_TEMP=$(mktemp -d) BUNDLE_GEMFILE=tooling/mobile/Gemfile bundle exec ruby tooling/mobile/signing_test.rb
```

## Android Play Console warnings

The Android lane passes `android.enableMinifyInReleaseBuilds=true` and `android.enableShrinkResourcesInReleaseBuilds=true`
to Gradle. Resource shrinking needs R8; do not disable minification on its own. Match Play's obfuscated class names
against the same release's archived `mapping.txt` before attributing a report.
