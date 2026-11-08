# Android app: handoff report

Native Android app for Reactive Resume in Kotlin and Jetpack Compose, built from the mobile storyboard in
`.agents/handoff/android-app/` (61 screens, light and dark). Branch `feat/android-app`, not pushed.

## What was built

- **25 Gradle modules** under `apps/android`: `:app`, nine `:core:*` modules and fourteen `:feature:*` modules. The
  structure and the reason for each choice are in `PLAN.md`; the rules for future work are in `AGENTS.md`.
- **All 61 storyboard screens**, with real navigation between them, in light and dark. Each screen has Roborazzi
  captures named after its storyboard file (`<ID>-<Name>-light.png` / `-dark.png`), plus extra states (empty, error,
  offline, locked, 200% font). 323 goldens in total, verified on every build.
- **Design system** (`:core:designsystem`): every Kit component plus about 30 more drawn from the screens (docked and
  detented sheets, month/date/time pickers, week strip, stage stepper, proposal card, score ring, recorder…), tokens
  from `reference/Tokens.kt`, motion helpers that honour reduced motion, and `rememberRrHaptics()` with the in-app
  switch. No Material visuals: Material 3 is plumbing only.
- **Data**: a Kotlin client generated from `docs/spec.json` by an in-repo generator (261 operations, 643 models, open
  objects keep unknown keys so saves never drop data), 16 repositories with storyboard-seeded fakes, a Room offline
  draft queue with conflict copies, and WorkManager sync.
- **Sign-in**: native password, create account, forgot/reset and two-step forms finished with an in-process OAuth 2.1 +
  PKCE exchange (dynamic client registration per server, `resource` on every grant, Keystore-encrypted tokens,
  single-flight refresh). Social providers and passkeys use a Custom Tab. Any server, http on localhost in debug.
- **Pages**: server PDFs (`/resumes/{id}/pdf`, letters' exports) rendered with `PdfRenderer`, cached per revision,
  last good page offline. Tapping the page opens the block under the finger (text positions read from the PDF), with
  Outline as the exact alternative.
- **System**: share targets (link → Save a job; PDF → ATS checker or Import), App Links (`/builder/*`, `/feedback/*`,
  public pages on rxresu.me and rx.cv), dynamic launcher shortcuts, local notifications from a 15-minute sync (one
  channel per category), Glance widgets, in-app language on API 26–32, Ctrl+K / `/` search.

## How to build and run

```sh
cd apps/android
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew assembleDebug lintDebug testDebugUnitTest verifyRoborazziDebug   # the full gate
./gradlew installDebug                                                      # me.rxresu.debug
```

To run against a local server: start the built server with `APP_URL=http://localhost:4710`,
`FLAG_ALLOW_UNSAFE_OAUTH_REDIRECT_URI=true` and a database (the repo's `tooling/dev/test-db.mjs` makes one per
checkout), run `adb reverse tcp:4710 tcp:4710`, then pick "Your own server" → `http://localhost:4710` in the app. Use
`localhost`, not `10.0.2.2`: Better Auth upgrades a non-localhost http issuer to https and discovery then fails the
issuer check. Without SMTP, new accounts need `email_verified` set in the database before password sign-in.

## Verification

- **Gate** (`assembleDebug lintDebug testDebugUnitTest verifyRoborazziDebug`): passes. 591 unit and screenshot tests,
  0 failures, 0 skipped; lint clean in every module.
- **Emulator smoke** (Pixel 10 Pro, Android 17, local server; captures in `smoke/`): server check → create account →
  native consent → Today; password sign-in; sample resume → builder page from the server PDF; tap a block → entry
  sheet; edit a position → autosave → server has it → page re-renders; Share mode → Share PDF opens the system share
  sheet; a link shared from another app → Save a job prefilled → saved → opens the application; Move to… →
  Screening, and Saved → Applied with "Mark as applied" (resume recorded); Check mode; dark mode; sign-out → Welcome
  with the account's page cache cleared. Not exercised on the device: social
  sign-in, passkeys, App Link verification (needs the server changes below), notifications, widgets, voice practice,
  printing, SAF saves.
- **Bugs the device run found and fixed**: stale cached OAuth client after a server reset; token calls carrying form
  cookies (403 `MISSING_OR_NULL_ORIGIN`); Better Auth's repeated `ba_param` rejected; idle auth connections reused
  after the server closed them; sign-up not continuing the authorization; page cache folder deleted at launch; a sheet
  whose exit animation was interrupted never closing; tap-to-edit finding no blocks in Forme PDFs (no line bounds:
  lines are now located with the platform text search); sign-out not returning to Welcome; sheets closed with
  `hide()` popping the back stack twice (entry Done left the builder); applied dates sent as instants where the API
  takes `YYYY-MM-DD`.
- **Independent review** (`REVIEW.md`, by an agent that wrote none of the code): 30 findings (22 major, 8 minor). 25
  fixed with tests, R18 partly; not fixed: R17 and R18's sources (API), R27 (design-system decision), R29 and R30
  (follow-ups). The per-finding response is at the end of `REVIEW.md`.

## Decisions

| Decision          | Choice                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering         | Server PDF behind `PageRenderer` (handoff default). On-device Forme rendering is the follow-up.                                                                                                      |
| Stack             | AGP 9.5.1, Kotlin 2.4.21, Gradle 9.6.0, Compose BOM 2026.09.00, Navigation type-safe routes, OkHttp 5 + kotlinx.serialization, Room, DataStore, WorkManager, Glance, AppAuth helpers, Coil 3, ZXing. |
| DI                | None, as in Kosha: constructor injection and one `AppGraph`; repositories reach Compose through `LocalRepositories`.                                                                                 |
| API client        | In-repo generator (`build-logic/…/ApiClientGenerator.kt`, `./gradlew :core:network:generateApiClient`); stock openapi-generator can't handle the spec (OpenAPI 3.1, 6.5 MB, 2,204 inline `anyOf`).   |
| Sign-in           | Native forms + in-process PKCE; browser only for social providers, passkeys and external-app consent.                                                                                                |
| Timezone          | Dates and "today" follow the account's saved timezone; `x-client-timezone` stays the device zone, as the web sends it.                                                                               |
| Screenshot locale | Tests run in English (Portugal): the default US catalog with day-month dates, the same on every machine. Times render 12-hour where the boards show 24-hour.                                         |
| Strings           | `:core:strings` is generated from `apps/mobile/locales/*.po` (55 locales, 3,567 keys); copy missing from the catalogs lives in each feature's `values/strings.xml` in English.                       |

Where a storyboard note and the web disagreed, the web won. The recorded cases include: list group order and toasts in
Applications, "Already interviewing", the Prepare tab countdown instead of "Ready", save status wording ("Offline ·
saved on this device", "Not saved · Retry"), check score thresholds, job-match frequency wording, consent copy, AI
provider defaults, "AI & developer", career date and schedule wording, and "Prepare a resume" / "Tailor resume for
this job".

## Server changes needed

1. **App Links**: set `MOBILE_ANDROID_PACKAGES=me.rxresu,me.rxresu.debug` and add the signing-certificate SHA-256 of
   each build to `MOBILE_ANDROID_CERT_SHA256` (`apps/server/src/http/app-links.ts`). Debug keystore on this Mac:
   `26:4C:C2:D7:3D:0A:23:9F:AC:AD:94:96:41:53:F0:BA:0B:DE:03:FD:EA:B3:FA:E1:67:A2:8B:4E:10:29:B6:0E`.
   The release key isn't set up yet: add the Play App Signing fingerprint when it is. Serve the same
   `assetlinks.json` on `rx.cv` (the alias host) so public links there verify.
2. **Native passkeys** (follow-up): add `delegate_permission/common.get_login_creds` to `assetlinks.json`.
3. **Optional, smoother first sign-in**: the app's own dynamically registered client gets the consent screen on first
   sign-in. Marking first-party native clients (redirect `https://rxresu.me/auth/native-callback` or
   `me.rxresu:/auth/native-callback`, name "Reactive Resume for Android") as trusted would skip it.
4. **API gaps** found while building (each screen degrades honestly today):
   - No PDF endpoint for saved versions or feedback snapshots; the public PDF requires downloads to be enabled.
   - External-app consent (A4) needs a bearer-token consent endpoint; the app falls back to the web page.
   - No guest flag on the session or profile; no OAuth tokens for anonymous users.
   - Browser-only for bearer callers: two-step setup, passkeys, session management, API key creation, setting a
     password, deleting the account.
   - `aiDraftApplicationMessage` offers only cover-letter and follow-up kinds; `Briefing` has no sources or ready flag;
     `FitResult` has no must-have/nice-to-have field; lanes have no colour; custom-domain availability and price aren't
     exposed; `DocumentSummary` has no primary-resume flag; no preview endpoint for JSON Resume or LinkedIn imports.
5. **Copy to confirm**: D4's reader option "Read on your server (free) / Reads the text layer, without AI" (the
   storyboard's "Nothing leaves your phone" isn't true when the server reads the PDF); "Synced changes made in another
   tab." (web wording) on a phone.

## Known gaps

- **Screen-level**: Import CSV and Manage stages are disabled; three message kinds (thank-you, status check,
  withdrawal) wait on the API; choosing which documents were actually sent on "Mark as applied" waits on the API
  (R17); interview-prep company sources (API); packet / approved PDF export; assistant camera input and specialised
  tool cards; letter bodies with quotes, tables or nested lists stay read-only; B17 location jumps to the editor, not
  a page overlay; thumbnail-to-page transition (R29); Outline drag across pages or into the Sidebar (R30, the menu
  covers it); QR frame and letter colour editors are module-local.
- **Design decisions for the owner**: white on dark `danger` is about 3.9:1 (below AA for small text; the token source
  keeps it deliberately); widgets use system fonts (Glance has no custom fonts).
- **Keyboard**: the shortcut sheet lists the web's shortcuts, but only Ctrl+K and `/` work.
- **Visual**: storyboard pixel differences run about 5–20% per screen, mostly sample data, Instrument Serif line
  boxes on Android, the static fonts versus the web's variable fonts, and the locale's 12-hour clock. Per-screen
  differences are listed in the feature agents' notes and `REVIEW.md`.
- **Not verified on a device**: TalkBack, RTL, 200% font on hardware, App Links, notifications, widgets, voice
  recording, printing, SAF.
- **Translations**: about 1,200 English strings in feature modules aren't in the Lingui catalogs yet, so other locales show English there.

## Next steps

1. Apply the server changes above, sign a release build and verify App Links on rxresu.me and rx.cv.
2. Work through `REVIEW.md`'s remaining items and the gaps above.
3. On-device rendering: `packages/forme-native` (Rust, JNI bridge exists) with the `packages/pdf` templates in an
   embedded JS engine behind the same `PageRenderer`; it also gives exact tap-to-edit blocks and offline renders.
4. iOS: the storyboard and tokens are platform-neutral; the design-system names (`Rr*`), routes and repository
   contracts here map one to one onto a SwiftUI app.
5. Add the feature modules' English strings to the Lingui catalogs and regenerate `:core:strings`.
