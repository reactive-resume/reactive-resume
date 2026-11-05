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

## Fingerprint changed: store build

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
6. Play Console: the workflow uploads straight to production with a full rollout and sends changes for review. It
   does not publish to testing tracks. With Managed Publishing on, publish approved changes in the console.
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
