# Mobile release handoff

Release workflow updated: **2026-10-21**. Store observations below remain historical unless dated otherwise. **Not ready for store submission yet.** Uploaded binaries, saved listing drafts, passing source checks, production deployment, device verification, and store approval are separate states.

This is the operational handoff. See [mobile-store-review.md](./mobile-store-review.md) for policy sources, detailed verification history, report-queue SQL, and issue triage; see [store metadata](../../apps/mobile/store/README.md) for localization mappings.

## Finish these gates before submission

- [ ] Build and distribute fresh iOS/Android binaries with OTA configuration below; previously uploaded builds 4/5 do not contain the update client. Verify an actual downloaded update on both platforms.
- [ ] Owner merges and deploys matching server/web changes and database migration to the Frankfurt Docker Swarm installation. Publish the updated privacy policy and acceptable-use terms on the documentation site too.
- [ ] Configure production association and Apple sign-in environment below. Verify actual association JSON, browser-to-native callbacks, clean Apple/GitHub login, and reviewer sign-in after deployment.
- [ ] Configure testers, distribute iOS build 4 through TestFlight and Android version code 5 through Play internal testing, and install both from the stores. Android tester Google-account email and iPhone/iPad TestFlight device confirmation were requested but remain outstanding.
- [ ] Complete the signed-device matrix below. Record device/OS, build, result, and any remaining failure. A successful upload or simulator run does not close this gate.
- [ ] Replace reconstructed phone/tablet screen portions in listing designs with matching release-build captures. Export and upload screenshots for every supported device slot and requested locale. Review translations with native-language readers, especially RTL and script shaping.
- [ ] Test real AI/provider behavior with fictional data and adversarial prompts. Verify disclosure/decline, output reporting, moderation receipt, and chosen providers' retention/data-use practices. Keep reviewer AI access usable without personal API keys or honestly resolve the review-access limitation before submission.
- [ ] Recheck Apple/Google declarations against the deployed behavior, selected providers, and final screenshots. Retest private reviewer credentials immediately before submitting.
- [ ] Resolve actual console validation errors and pre-launch/device failures. Only then send for review. No App Review or production Play submission was sent during this work.

## Already prepared

| Area                 | Recorded state                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safety/account flows | Per-operation AI consent at transport boundary; private AI/public-resume reports; local shared-author blocking; direct browser account-deletion confirmation; bounded Apple token-revocation attempt                 |
| Branding             | New native icons/splash and PWA icons; iOS Donate row hidden as a conservative first-release choice                                                                                                                  |
| Native artifacts     | iOS 1.0.0 (4) processed VALID and attached to App Store version; Android 1.0.0 version code 5 processed in internal-track draft                                                                                      |
| Localization         | Titles/descriptions saved and reread in both stores for English, Spanish, French, German, Brazilian Portuguese, Simplified Chinese, Japanese, Korean, Hindi, Arabic, and Indonesian                                  |
| Artwork              | Play icon and all 11 localized feature graphics saved; full reload confirmed distinct persisted graphics. No phone/tablet screenshot panels uploaded                                                                 |
| Apple forms          | Privacy responses published, Content Rights saved with owner affirmation, age 13+ override, free price, 175 regions on manual release; private reviewer credentials saved per owner                                  |
| Google forms         | Sign-in access, no ads, category/support details, target ages 13–15/16–17/18+, IARC, Advertising ID No, and Data safety saved. App content page reported no outstanding declarations; changes still await submission |
| Reviewer account     | Owner created account; browser login succeeded; fictional resume, cover letter, and saved job application seeded. Owner confirms credentials saved privately in both stores                                          |

Brand is **Reactive Resume**, `rxresume`, or `reactive-resume`. The official domain `rxresu.me`, scheme/package `me.rxresu`, and registered Apple Services ID are existing technical identifiers; do not rename them casually.

## Production deployment and quirks

Owner controls merge/deployment. Backend runs on a VPS in Frankfurt, Germany, using Docker Swarm. Do not infer deployment from a Git push or a successful image build.

### Image publishing is not automatic Swarm deployment

The checked-in `.github/workflows/docker-build.yml` currently behaves as follows:

- Push to `main`: builds native AMD64/ARM64 images and publishes SHA/nightly aliases; **does not run the SSH redeploy step**.
- Manual dispatch with `release=false`: builds a canary/SHA image; no production deployment.
- Stable release tag or dispatch with `release=true`: promotes an existing full-SHA image; stable release mode can run SSH redeploy and cache purge when their secrets are configured.
- SSH requires `SSH_KEY`, `SSH_HOST`, and `SSH_USER`; cache purge requires its Cloudflare secrets. Missing integration secrets cause those integrations to be skipped.
- Current SSH command runs `cd docker` then `./manage_stack.sh up reactive_resume`. Verify the actual VPS script pulls the intended image and updates every replica.
- GHCR is primary; Docker Hub is a best-effort mirror. A successful workflow may still have failed mirror steps. Confirm the registry/tag/digest consumed by Swarm.

Before invoking a promotion, follow [container publishing](./container-publishing.md). Pushing this feature branch alone does not build or deploy the production Docker image. Do not assume an unrelated external pull trigger follows the same rules; verify its actual execution and the running image digest.

### Over-the-air updates

`apps/mobile/app.config.ts` enables EAS Update for the existing Expo project. Preview
and production build profiles use separate channels. Fingerprint runtime versions keep
updates compatible with the installed native modules, including the Forme Rust sources
and reviewed prebuilt checksum. JavaScript-only changes can use OTA; native dependencies,
permissions, SDK upgrades, and native Forme changes still require fresh store binaries.

The mobile UI now uses Legend List for documents and conversations, Expo UI for native
switches, and TrueSheet for shared sheets. Expo UI and TrueSheet require fresh iOS and
Android binaries; this integration cannot reach existing binaries through OTA alone.
Before release, verify keyboard avoidance, nested sheets, dirty-form dismissal, pending
saves, screen readers, reduced motion, and long-list scrolling on both platforms.

For local visual review, `pnpm --filter mobile preview:web` opens the development UI
gallery with the app's shared primitives, light/dark themes, and a 300-item list. This
gallery excludes native PDF and authenticated routes. Browser checks supplement native
device QA; Expo UI switches use the web preview implementation in the browser.

One-time activation:

1. Create an Expo access token with access to the `reactive-resume` project and save it as
   GitHub Actions secret `EXPO_TOKEN`. Never commit the token or put it in release notes.
2. From `apps/mobile`, create `preview` and `production` channels with
   `eas channel:create preview --non-interactive` and
   `eas channel:create production --non-interactive` if they do not already exist.
3. Configure [Blacksmith native releases](./mobile-ci.md), then build store binaries on
   both platforms. These builds explicitly embed the `production` update channel;
   complete the store/device gates in this document before production release.
4. Publish a production update through the Docker release workflow, install the matching
   store build, open it to download, then restart to apply. Verify startup offline and
   saved drafts. Repeat on iOS and Android. Existing preview binaries keep their channel.

The Docker workflow publishes from the image's exact source commit: non-production
images go to preview, stable releases to production after SSH deployment and three
matching healthy commit probes. Production deployment must expose `/api/health` from
the application without caching or substituting a proxy's `OK` response. A missing
`APP_REVISION`, old replica, or unhealthy backend withholds the mobile update. A timeout
or missing `EXPO_TOKEN` fails the mobile job; Docker publishing is not rolled back.

Updates download on launch and normally apply on the next restart. Never reload an
active editor to force an update; let the existing draft lifecycle finish. A matching
fingerprint is required, so an update targeting new native code waits for users to
install the new binary. Older native runtimes retain their last compatible update.
Clients and self-hosted servers can remain older; keep API changes backward compatible.

For rollback, run `eas update:rollback <LATEST_UPDATE_GROUP_ID>` from `apps/mobile`.
It republishes the previous update for that branch/runtime, or rolls back to the embedded
update if none exists. This changes the mobile app only. Coordinate backend rollback
separately and preserve API compatibility in both
directions. Do not bump runtime versions just to force an incompatible update through.

### Native review prompts

The `expo-store-review` integration requires fresh iOS and Android binaries. It requests
the platform review UI after five minutes of signed-in foreground use, waiting for a
main tab and a hidden keyboard. Background time does not count; a new account or app
launch starts a new five-minute wait. A device-local three-day cooldown survives app
restarts and account changes. Store quotas may suppress the UI; ratings, dismissals,
and completed reviews are not observable. No rating filtering or automatic store
redirect is used. Settings → Support → Report an issue independently opens GitHub's
new-issue chooser.

Before release, verify foreground/background timing, sign-out, keyboard/editor
deferral, and cooldown persistence on both platforms. TestFlight does not show the
production review prompt; use Apple's development behavior and Play's internal test
track as appropriate, and record actual store-build results separately.

### Database and web release

- Include migration `migrations/20261017135047_clammy_the_enforcers/` for `ai_content_report`; normal server startup applies migrations. Back up production before deployment and inspect migration logs. Do not reset the database or delete volumes.
- Deploy server and web together. New native report calls need the new backend; the direct account-deletion query parameter needs the new web code. During a rolling update, old replicas can still serve old behavior; verify after rollout completes.
- Keep `APP_URL=https://rxresu.me`. Preserve existing `AUTH_SECRET` and `ENCRYPTION_SECRET`; rotating these casually can invalidate sessions or make saved provider credentials unreadable.
- Swarm service environment/secrets must be updated separately from pulling a new image. The application expects actual environment values, not an assumed `*_FILE` convention.
- Documentation hosting may have an independent deployment. Source changes to `docs/legal/privacy-policy.mdx` and `docs/legal/terms-of-service.mdx` are not proof that public policies changed.
- PWA icon changes need the web deployment and browser/service-worker cache refresh. An installed PWA may retain old artwork until refreshed or reinstalled.

### Required mobile environment

```dotenv
MOBILE_IOS_APP_IDS=654ASRW868.me.rxresu
MOBILE_ANDROID_PACKAGES=me.rxresu
MOBILE_ANDROID_CERT_SHA256=3E:8A:8B:56:BB:3D:B6:55:C6:04:F3:85:99:A8:4B:B0:4F:B7:E1:72:60:0A:95:8C:41:CD:59:D7:04:82:25:81
APPLE_CLIENT_ID=me.rxresu.web
APPLE_CLIENT_SECRET=<supply protected deployment value; never commit it>
```

The Android fingerprint was read from **Play App Signing → Digital Asset Links JSON**, not EAS's upload certificate. Never use the local inspection APK's debug certificate in production. If Play rotates signing keys, update the supported fingerprint list from Play Console and retest links on affected Android versions.

Apple setup is registered for domain `rxresu.me` and callback `https://rxresu.me/api/auth/callback/apple`, associated with primary app `654ASRW868.me.rxresu`. Associated Domains and Sign in with Apple capabilities were enabled. These settings do not replace the runtime client ID/secret.

Protected Apple deployment values are local at `/Users/amruth/.config/rxresu/apple-sign-in.env`, mode 600; the authentication `.p8` key is outside the repository. **Client-secret JWT expires 2027-04-15T15:13:47Z; rotate before expiry.** Upload/signing API keys and the Sign in with Apple authentication key have different purposes. Do not copy any private key, JWT, reviewer password, or service-account JSON into this branch, logs, screenshots, or issue comments.

### Post-deploy acceptance

- [ ] `/api/health` reports healthy and the running image matches the intended commit/digest.
- [ ] `/.well-known/apple-app-site-association` returns valid JSON with the expected team/app association.
- [ ] `/.well-known/assetlinks.json` returns valid JSON containing package and Play signing fingerprint above. At the last live check on 2026-10-17, **both association URLs returned plain `OK`**, so HTTP 200 alone is insufficient.
- [ ] A fresh store-installed app completes browser login and opens `/auth/native-callback` in the app; test cancellation and an expired session too.
- [ ] Repeat Android browser login with **Open supported links** disabled. The callback page targets package `me.rxresu` through an Android intent while retaining the registered HTTPS callback and its OAuth query. If the browser blocks automatic opening, **Try opening the app again** must finish the handoff with a tap. This web fallback also supports existing store binaries; native sign-in still validates state, issuer and PKCE.
- [ ] Private reports persist in production and are visible to the authorized operator. Verify export includes the account's reports.
- [ ] Test erasure with a separately created disposable account, including attachments/provider tokens and report cascade. Keep the primary reviewer account available.
- [ ] Public support/privacy/deletion URLs show the final instructions, retention details, contact information, and shared-content policy.

## Releasing a new version

Decide first whether the change needs a store build. Compare the saved platform hash
from the installed Blacksmith build's `fingerprint.json` with the current production
fingerprint, from `apps/mobile`:

```sh
eas fingerprint:compare <INSTALLED_NATIVE_FINGERPRINT_HASH> --environment production
```

**Fingerprint unchanged (JavaScript-only change):** no store work. A stable Docker release publishes the update to the `production` channel after the deployment health probes pass (see [Over-the-air updates](#over-the-air-updates)). Apps download it on launch and apply it on the next restart. OTA updates must not change the app's primary purpose or add features that need new store declarations; ship those through review.

For an older EAS-built binary, `--build-id <EAS build ID>` remains supported instead
of the hash. Compare both platforms. Keep API changes backward compatible with older
binaries and deploy the backend first.

**Fingerprint changed (native change):** build and upload new binaries.

1. Deploy the backend first. Keep the API backward compatible: older binaries and OTA bundles remain in use.
2. Optionally bump `version` in `apps/mobile/app.config.ts` (for example `1.0.0` to `1.1.0`). CI supplies increasing iOS build numbers and Android version codes. iOS needs a new version string after a version is released; Play needs only a higher `versionCode`.
3. Complete the [signed-device test matrix](#signed-device-test-matrix), store declarations, listing/reviewer details, and release notes before submission. The workflow retains saved listings and screenshots. Ensure Play credentials permit production releases and the App Store Connect key has App Manager or Admin access. No testing tracks or TestFlight groups are required.
4. Dispatch **Mobile Release** on `main`, platform `all`, **format=store**, and **upload** enabled. Approve `mobile-signing`, inspect this run's signed artifacts, then approve `mobile-store` to submit them. Latest main-push CI must have passed for the exact source commit before upload begins. Leave **upload** disabled if only checking a build. The [Blacksmith setup guide](./mobile-ci.md) covers credentials, build numbering, and approval environments. No EAS Build credits are used. Fastlane does not synchronize Apple capabilities. If exporting credentials through `eas credentials`, keep `EXPO_NO_CAPABILITY_SYNC=1`; Apple sign-in uses web Services ID `me.rxresu.web`, so turning off its primary App ID's Sign in with Apple capability would break sign-in.
5. **App Store Connect:** the workflow uploads the IPA, creates or updates its app version, waits for its matching processed build, submits for App Review, and sets automatic release after approval. Missing metadata or a pending review can block submission; review status and public availability must be checked separately.
6. **Play Console:** the workflow uploads directly to production with a completed, full rollout and sends changes for review. It does not publish to testing tracks. Review and Managed Publishing still control public availability; if Managed Publishing is enabled, publish approved changes in the console, or disable it there for automatic publication after review.
7. Verify both public store versions and smoke-test store-installed builds. Workflow success proves submission, not approval or publication. Confirm that a later OTA update reaches each new binary, because its fingerprint and runtime version changed.

Stable distribution uses the App Store and Play Store. IPA and AAB files are not attached to GitHub Releases. Manual Android APKs are available through Actions artifacts as described below; they do not replace store builds or store review.

### Manual Android downloads

Dispatch **Mobile Release** on `main` with `platform=android`, `format=apk`, the desired
`abi` (`arm64-v8a` by default), and `upload=false`. Approve the `mobile-signing` gate.
The selected ABI is built with Expo Prebuild, Gradle and the existing Fastlane lane,
using the existing Android upload keystore and preview EAS environment/channel.
The normal increasing workflow build number is used; retries reuse that number.

Download the signed APK from the run's `mobile-android-<build-number>` Actions
artifact within 14 days. A separate evidence artifact retains the source SHA,
fingerprint and available debugging files for 90 days. Neither a Git tag nor a
GitHub Release is created, and pushes to `main` no longer build APKs.

The APKs retain package `me.rxresu`. Their upload signing certificate may differ from
Play App Signing, so they cannot necessarily upgrade a Play installation or be
upgraded by one. Back up local drafts before uninstalling to switch distributions.
Retain the same upload signing key for future APK updates. For verified App Links,
add its certificate fingerprint to the backend's `MOBILE_ANDROID_CERT_SHA256` list
alongside the Play fingerprint; do not replace the Play fingerprint. Test native
sign-in on an actual sideloaded build before advertising it as verified.

See [mobile CI](./mobile-ci.md#manual-android-apks) for signing approvals and retention.
Export production release evidence to permanent records before Actions retention
expires; the maximum 90-day retention is not permanent archival storage.

## Native artifacts and signing

| Field       | iOS                                                                                                                                            | Android                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Version     | 1.0.0 (4)                                                                                                                                      | 1.0.0, version code 5                                                                                                                                        |
| EAS build   | `afe7e122-ebf2-44fa-906d-dbcada3a8b20`                                                                                                         | `1bd29d31-4d2c-4bc7-9e3f-2bbe5a5ff061`                                                                                                                       |
| Build URL   | [EAS iOS](https://expo.dev/accounts/reactive-resume/projects/reactive-resume/builds/afe7e122-ebf2-44fa-906d-dbcada3a8b20)                      | [EAS Android](https://expo.dev/accounts/reactive-resume/projects/reactive-resume/builds/1bd29d31-4d2c-4bc7-9e3f-2bbe5a5ff061)                                |
| SHA-256     | `455a1e71eda35aa21e5be644802c61f5ad46ff6d484632b0a3bef1abac1bdbcd`                                                                             | `da8a204762e7173d0cc43ee4f58f344ed08c010304bf86aeb96cbc801c8ce4fb`                                                                                           |
| Validation  | Strict deep code signing; iOS SDK 27.1; matching entitlements; 14 non-tracking privacy manifests; no development Bonjour/local-network entries | Bundletool and upload signature valid; target API 36, min API 24; non-debuggable; all 68 64-bit ELF LOAD and inspection APK ZIP alignments pass 16 KB checks |
| Store state | App `6823975835`; build resource `dbaa48a2-520f-4109-9756-aa1c1dc036ca`; attached to 1.0.0                                                     | App `4975481521325019096`; internal track `4701728381949252022`; draft release 1; no testers/rollout yet                                                     |

Earlier builds are superseded. Local IPA/AAB/inspection outputs and evidence are under `/tmp/rxresu-store-artifacts`; listing verification is under `/tmp/reactive-resume-listing-audit`. These are temporary local evidence, not durable build storage. Retrieve store artifacts through EAS links if local files disappear. The inspection APK is debug-signed solely for inspection; it does not prove Play-installed identity or behavior.

EAS project is `reactive-resume/reactive-resume`, ID `5830280e-e1ba-45b7-b9c9-ba048fa3bd4d`, retained for OTA updates and Observe. The historical EAS builds used remote version counters; Blacksmith uses the GitHub counter and migration offset described in [mobile-ci.md](./mobile-ci.md). Never reset versions to 4/5. Apple capabilities remain manually configured; `EXPO_NO_CAPABILITY_SYNC=1` is still required when using `eas credentials`.

Historically, submission keys lived in EAS credentials and `apps/mobile/eas.json` held no credential paths. Blacksmith requires exporting those existing signing credentials and storing upload keys in Actions secrets. iOS upload used an existing developer API key, while distribution signing required an approved Admin team key. Android's first AAB upload was manual. Never commit credential files. Historical Expo Doctor result: 20/20 after adding direct `expo-asset` dependency.

Forme native artifacts are published and checksum-pinned in `packages/forme-native/scripts/prebuilt.json`; the Blacksmith build explicitly fetches them before prebuild. A source/ABI change needs matching published prebuilts and checksum updates. Do not replace the pin with an unverified download or assume package version alone identifies native content.

## Signed-device test matrix

Test through TestFlight/Play internal testing with fictional documents, not Metro or only a development client:

- iPhone/iPad and Android phone/tablet; minimum supported and current OS; Android 16 KB environment; cold launch, background/restore, rotation and safe areas.
- Clean reviewer login; Apple and GitHub OAuth; canceled login, callback reopening, session expiry, account/server switching, sign-out, and cross-account cache isolation.
- Create/import/edit resume and cover letter; save, force-close/relaunch, preview PDF, export/share, offline/interrupted saves and conflict recovery. Inspect actual exported files.
- Deny/revoke camera, photo, microphone, and notification permissions. Unrelated workflows must remain usable.
- Large text, font/density changes, VoiceOver/TalkBack focus/labels, keyboard, light/dark themes, RTL and Arabic/CJK/Devanagari fonts.
- AI consent with accept/decline/cancel and changed provider/account; ensure declined operations never transmit. Report generated content and a shared resume; test block/relaunch/unblock and report receipt.
- Account deletion via Settings → Account opens a browser confirmation; it does not silently erase on navigation. Test separately with disposable credentials and Apple-linked account revocation/fallback where applicable.

Known limit: Android font/density changes can recreate the activity, resetting navigation and unsent transient forms. Persisted document drafts survive; do not claim every form survives. The earlier in-place scaling workaround was reverted because it clipped text. Device performance and full screen-reader/permission-denial coverage remain unclosed.

## Listings, screenshots, and review access

Design sources live in [Figma](https://www.figma.com/design/paEvXcSQes7pnrGtnLS73a?node-id=16-1958) and the owner's Penpot workspace. ZIP archives, editable `.fig` source, and exported listing directories are deliberately excluded from Git. Only seven runtime native icon/splash PNGs under `apps/mobile/assets` and required PWA icons are committed. Runtime copies are byte-identical to the artwork used in uploaded builds 4/5; builds no longer depend on ignored launch-kit folders.

All 264 supplied listing PNGs passed decoding/dimension/no-alpha checks: per language, 5 large iPhone (1320×2868), 5 medium iPhone (1206×2622), 5 Android phone (1080×1920), 4 iPad (2064×2752), 4 Android tablet (1920×1080), and 1 Play feature graphic (1024×500). Check active store slots again before upload. Dimension checks do not prove screenshot fidelity. Original READMEs explicitly identify phone/tablet panels, template thumbnails, and tablet navigation as illustrative reconstructions.

Metadata source is `apps/mobile/store/metadata.json`. Name remains **Reactive Resume** (30-character store limit); the longer free/open-source phrase belongs in descriptions. All 11 locales are saved in both stores, but native-language review is not established. Newly added safety messages also have untranslated mobile catalog entries with English fallback; do not promise fully localized runtime UI without checking.

Reviewer account has fictional resume, letter, and saved application; email/username and password are in private store review-access fields. Owner confirms both stores saved them. No 2FA, QR code, membership, location, or biometric restriction is required. Default server is `https://rxresu.me`. Do not delete this primary account or paste its password into chat/source. A real provider is not configured for this account yet; resolve how reviewers exercise advertised AI tools without exposing personal keys.

Apple access fields: App Store Connect → Reactive Resume → Distribution → iOS App 1.0.0 → App Review Information → Sign-in required. Google: App content → Sign in details. Retest access immediately before review and keep backend/sample content available throughout review.

Apple Silicon Mac and Vision Pro availability defaults remain enabled but untested. Test these targets or explicitly choose supported availability before submission; do not click compatibility verification without testing. Play Data safety's no-sharing answer relies on explicit user-initiated/consented transfers and service-provider exemptions; review actual providers before final submission. IARC Everyone/PEGI 3 is a content rating, distinct from the intended audience of ages 13+.

## Safety operations and unresolved issues

Owner committed to daily monitoring and prompt action. Reports share `ai_content_report`; query `reviewed_at IS NULL` through restricted DB access and mark reviewed only after actual triage. There are **no email alerts or operator dashboard**. Public-resume blocking is device-local, account/server-scoped, and username-based; changing username bypasses that address block. It is not a server-wide ban. Operators must disable abusive public sharing/remove offending content when warranted; live operational verification remains necessary.

Do not close these five issues based only on source checks:

| Issue                                                                                     | Remaining evidence                                                                     |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [#2897 GitHub OAuth](https://github.com/reactive-resume/reactive-resume/issues/2897)      | Clean production account/login round trip; capture sanitized server errors if it fails |
| [#3275 RTL resumes](https://github.com/reactive-resume/reactive-resume/issues/3275)       | Final signed-build Arabic/Hebrew/Persian preview/export fixtures                       |
| [#3147 keyword clipping](https://github.com/reactive-resume/reactive-resume/issues/3147)  | Exact sanitized reporter fixture still absent; test narrow sidebar/wrapped keywords    |
| [#2812 Onyx header](https://github.com/reactive-resume/reactive-resume/issues/2812)       | Current renderer/header/profile placement against reported layout                      |
| [#2794 square-image crop](https://github.com/reactive-resume/reactive-resume/issues/2794) | Original fixture absent; square image with edge markers in preview and exported PDF    |

Prior local checks recorded in the audit passed: API 399 unit and 71 isolated real-DB integration cases; auth 33; PDF 361; AI 7; web account 4; real report/export/deletion browser E2E; mobile consent/public-safety harnesses; relevant typechecks, boundaries, production builds, lint/format. These results do not establish production migration, provider behavior, device coverage, or store approval. Do not run destructive smoke fixtures against personal production accounts.

## Feature parity exceptions

- Applications CSV import/export is web-only on mobile by owner decision, 2026-10-19.
