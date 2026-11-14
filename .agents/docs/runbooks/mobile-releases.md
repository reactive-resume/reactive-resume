# Mobile releases

Every change to the app reaches users as a store build: there are no over-the-air updates. A push to `main` that
touches the app's inputs builds and uploads both platforms to internal testers automatically; promoting a tested build
to the public is a manual step in each store console. Workflow, secrets and build numbers:
[mobile CI](./mobile-ci.md). Release state (store accounts, open gates, secret locations) is maintainer-only and kept
outside the repository.

## Before merging a mobile change

1. Deploy backend changes first and keep the API backward compatible: installed binaries stay in use for weeks, and
   the first Expo app's last OTA bundle keeps running on phones that have not updated.
2. Bump `version` in `apps/mobile/app.config.ts` when the store needs a new version string. App Store Connect accepts
   no new builds for a version once that version is approved for release, so start the next version first. Play needs
   only a higher version code, which CI provides.
3. Update `releaseNotes` for every locale in `apps/mobile/store/metadata.json`, translated, at most 500 characters
   each. Play receives them with every internal upload; App Store Connect needs the same text when you submit.

## After the workflow uploads

- **TestFlight**: the run waits until App Store Connect has processed the build. Internal testers get it when the
  internal group has automatic distribution on. Export compliance is declared by `usesNonExemptEncryption: false`.
- **Play Internal testing**: the release is `completed` on track `internal`; enrolled testers can install it after
  Play processes it.
- Smoke-test store-installed builds on both platforms (sign-in, drafts, export, share extension).

## Promote to production

1. App Store Connect: create or select the app version, choose the tested TestFlight build, add release notes and
   reviewer details, and submit for App Review.
2. Play Console: promote the tested internal release to production (or a staged rollout) and send it for review. With
   Managed Publishing on, publish the approved change.
3. Verify both public store versions. Workflow **Mobile Android APK** checks daily at 03:07 UTC for a live production
   release (full or staged rollout) and publishes Play's universal APK as GitHub release `android-<versionCode>`
   (not marked Latest). Dispatch it to mirror sooner. iOS ships through the App Store only; IPA and AAB files are never
   attached.

## Reverting

There is no rollback channel. Ship a fix as a new build (it gets the next build number), then promote it. Coordinate
backend rollbacks separately and keep the API compatible in both directions.
