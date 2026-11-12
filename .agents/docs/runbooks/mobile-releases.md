# Mobile releases

How a change reaches the native app: an over-the-air (OTA) update for JavaScript-only changes, or a new store build
when native code changed. Runner, signing and secret setup for the release workflow live in
[mobile CI](./mobile-ci.md). Release state (store accounts, open gates, secret locations) is maintainer-only and kept
outside the repository.

## Decide: OTA update or store build

Compare the saved platform hash from the installed Blacksmith build's `fingerprint.json` with the current production
fingerprint, from `apps/mobile`:

```sh
eas fingerprint:compare <INSTALLED_NATIVE_FINGERPRINT_HASH> --environment production
```

For an older EAS-built binary, `--build-id <EAS build ID>` works instead of the hash. Compare both platforms.

A changed fingerprint means a new store build. Native dependencies or config plugins, permissions or entitlements,
`app.config.ts` native fields, Expo SDK upgrades, `apps/mobile/patches`, and Forme native sources or
`packages/forme-native/scripts/prebuilt.json` all change it.

## Fingerprint unchanged: OTA update

No store work. A stable Docker release publishes the update to the `production` channel after the deployment health
probes pass. Apps download it on launch and apply it on the next restart. OTA updates must not change the app's
primary purpose or add features that need new store declarations; ship those through review.

- `docker-publish.yml` calls `mobile-ota-update.yml` only for stable production releases, using the image's exact
  source commit after a successful deployment. Nightlies, canaries and prereleases skip OTA.
- The OTA job requires three matching healthy commit probes of `/api/health`. A missing `APP_REVISION`, an old replica
  or an unhealthy backend withholds the update. A timeout or missing `EXPO_TOKEN` fails the mobile job; Docker
  publishing is not rolled back.
- Never reload an active editor to force an update; let the draft lifecycle finish. An update targeting new native code
  waits for users to install the new binary. Older native runtimes keep their last compatible update.
- Rollback: `eas update:rollback <LATEST_UPDATE_GROUP_ID>` from `apps/mobile`. It changes the mobile app only;
  coordinate any backend rollback separately and keep the API compatible in both directions.

## Automatic native Android Internal Testing

Every push to `main` builds the Kotlin app in `apps/android`, runs its lint/unit tests,
and signs/publishes its AAB to Google Play **Internal Testing** (`internal`, `completed`).
It uses the existing `me.rxresu` listing, upload key, service-account secret and shared
version counter. Existing internal testers can receive the build after Play processing.
Runs queue instead of canceling earlier pending releases. See [mobile CI](./mobile-ci.md)
for credentials, environment restrictions and queue limits.

This is the native Android binary, not an Expo OTA update. Testers installing it replace
the Expo Android app under the same package. Production and iOS uploads remain explicitly
selected through the manual workflow below.

## Fingerprint changed: manual production store build

1. Deploy the backend first. Keep the API backward compatible: older binaries and OTA bundles stay in use for weeks.
2. Optionally bump `version` in `apps/mobile/app.config.ts`. CI supplies increasing iOS build numbers and Android
   version codes. iOS needs a new version string after a version is released; Play needs only a higher `versionCode`.
3. Finish the signed-device checks, store declarations, listing and reviewer details, and release notes before
   submission. Write the release notes as `releaseNotes` for every locale in `apps/mobile/store/metadata.json`,
   translated, at most 500 characters each. Both lanes send each locale's notes; App Store Connect blocks review while
   any listing locale lacks them, and accepts them only from the app's second released version onwards. Play credentials must permit production releases; the App Store Connect key needs App Manager or Admin.
4. Dispatch **Mobile release** on `main`, platform `all`, `format=store`, `upload` enabled. The run signs
   and submits without manual approval. The latest main-push CI must have passed for the exact source commit before
   upload begins. Leave `upload` disabled to only check a build or inspect the signed artifacts first.
5. App Store Connect: the workflow uploads the IPA, creates or updates the app version, waits for the processed build,
   submits for review and sets automatic release after approval.
6. Play Console: a manual store upload goes to production with a full rollout and sends changes for review.
   Automatic main-push uploads go to Internal Testing instead. With Managed Publishing on, publish approved
   production changes in the console.
7. Verify both public store versions and smoke-test store-installed builds. Workflow success proves submission, not
   approval. Confirm a later OTA update reaches each new binary, because its runtime version changed.

If exporting credentials through `eas credentials`, keep `EXPO_NO_CAPABILITY_SYNC=1`: Apple sign-in uses the web
Services ID `me.rxresu.web`, and turning off the primary App ID's Sign in with Apple capability breaks sign-in.

Stable distribution uses the App Store and Play Store. IPA and AAB files are not attached to GitHub Releases.

## Manual Android APKs

Dispatch **Mobile release** on `main` with `platform=android`, `format=apk`, one `abi` (`arm64-v8a` by default) and
`upload=false`. Download the signed APK from the run's `mobile-android-<build-number>`
artifact within 14 days; a separate evidence artifact keeps the source SHA and fingerprint for 90 days. No Git tag or
GitHub Release is created.

APKs keep package `me.rxresu`, but their upload signing certificate may differ from Play App Signing, so a Play
install and an APK install may not upgrade each other. For verified App Links, add the APK certificate fingerprint to
`MOBILE_ANDROID_CERT_SHA256` next to the Play fingerprint. Export release evidence to permanent records before Actions
retention expires.

## Native Android app

The Kotlin app in `apps/android` uses the same package (`me.rxresu`), Play listing, upload key and version counter as
the Expo app, so a native production build replaces the Expo app for every Play user. Main pushes first publish
the native app to Internal Testing. Dispatch **Mobile release** with
`platform=android-native`:

- `format=preview`, from any branch: a minified APK, package `me.rxresu.preview`, signed with the committed
  `apps/android/app/preview.jks`. It installs beside the Play app and over earlier previews. Download it from the
  `android-preview-<build-number>` artifact within 14 days. It uses no secrets. Its links and social sign-in return to
  the Play app, so test with password sign-in.
- `format=apk`, on `main`: a release APK signed with the upload key, like the Expo manual APK above.
- `format=store`, on `main`: an AAB. With `upload` enabled, the same Play lane submits it to production with a full
  rollout. The first upload ships the native app to every Play user.

Store builds use the Play App Signing key, which `MOBILE_ANDROID_CERT_SHA256` already lists, so App Links need no
server change.
