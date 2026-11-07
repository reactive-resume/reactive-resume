# Android app build plan

Native Android app for Reactive Resume (Kotlin, Jetpack Compose), built from the mobile storyboard in
`/Users/amruth/Projects/reactive-resume/.agents/handoff/android-app/` (HANDOFF.md, SCREENS.md, boards, screens,
reference/Tokens.kt, icons). Branch `feat/android-app`; nothing is pushed.

## Toolchain

- JDK 21 (Homebrew): `export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home`
- Android SDK `~/Library/Android/sdk` (platform 37), `local.properties` holds `sdk.dir` (gitignored; create it in new
  checkouts).
- Gradle 9.6.0 wrapper, AGP 9.5.1, Kotlin 2.4.21 (AGP built-in Kotlin),
  Compose BOM 2026.09.00. Versions live in `gradle/libs.versions.toml`.
- One emulator at a time on this machine (limited RAM). Only the lead runs the emulator, in Phase 3.

## Decisions

| Topic                                 | Choice                                                                                                                                                                                                             | Why                                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Rendering                             | Server PDF behind `PageRenderer` (`:core:page`), `PdfRenderer` bitmaps, cached per revision                                                                                                                        | HANDOFF §5 default                                                                                                                      |
| DI                                    | No framework: constructor injection, one `AppGraph` built in `:app`, repositories reach Compose through `LocalRepositories`                                                                                        | Kosha (the owner's other Android app) uses no DI library; fewer annotation processors in a 25-module build                              |
| API client                            | `:core:network` generates Kotlin models + a client from `docs/spec.json` with a small in-repo generator run as a Gradle task                                                                                       | The spec is OpenAPI 3.1, 6.5 MB, almost entirely inline (2,204 `anyOf`, 1 component schema): stock openapi-generator output is unusable |
| HTTP                                  | OkHttp 5 + okhttp-sse + kotlinx.serialization (no Retrofit)                                                                                                                                                        | The generated client calls OkHttp directly                                                                                              |
| Sign-in                               | Native password, create account and two-step forms call Better Auth, then the app completes OAuth 2.1 + PKCE in-process (code → token); social providers and passkeys run in Custom Tabs on the same authorize URL | Storyboard draws native forms (A2, A3); the API accepts only OAuth bearer JWTs                                                          |
| Navigation                            | One `NavHost`, type-safe routes in `:core:navigation/Routes.kt`; tab bar only on the 4 tab roots; sheets are full-window dialog destinations drawing `RrBottomSheet`                                               | Pushed screens hide the tab bar on every board                                                                                          |
| Builder Share mode and workspace tabs | Slots: `:app` passes `:feature:share` content into the builder screen and `:feature:workspace` content into the Application screen                                                                                 | Keeps the mode bar and tab strip still while modules stay independent                                                                   |
| Namespace                             | `:feature:public` uses package `me.rxresu.feature.publiclink`                                                                                                                                                      | `public` is a Java keyword                                                                                                              |

## Modules and owners

| Module                                                     | Owner | Contents                                                                                               |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| `:app`                                                     | lead  | Activity, `AppGraph`, NavHost, deep links, theme switch, splash, launcher icon                         |
| `:core:navigation`                                         | lead  | Routes, transitions, `sheet<T>()`, tab shell, deep-link parser                                         |
| `:core:designsystem` + `:core:testing`                     | F1    | Tokens, fonts, icons, every Kit component, motion, haptics, Roborazzi harness, Kit test                |
| `:core:network`, `:core:data`, `:core:database`            | F2    | Spec generator, client, SSE, repositories (real + fakes), Room draft queue and caches, preferences     |
| `:core:auth`, `:core:page`, `:core:strings`                | F3    | OAuth/PKCE/DCR, native password flow, server check, token storage; PageRenderer; `.po` → `strings.xml` |
| `:feature:auth`, `:feature:settings`                       | P1    | A1–A4, S1–S6                                                                                           |
| `:feature:today`, `:feature:documents`, `:feature:search`  | P2    | T1–T2, D1–D6                                                                                           |
| `:feature:builder`                                         | P3    | B1–B10                                                                                                 |
| `:feature:share`, `:feature:assistant`, `:feature:letters` | P4    | B11–B18, L1–L2                                                                                         |
| `:feature:applications`, `:feature:workspace`              | P5    | J1–J8, W1–W5                                                                                           |
| `:feature:career`, `:feature:public`, `:feature:system`    | P6    | C1–C7, P1–P2, X1                                                                                       |

## Order

1. Phase 0 (lead): scaffold, contracts (`Routes.kt`, `SessionTokens`/`ServerOrigin`, `AuthSession`, `PageRenderer`), this plan. Commit.
2. Phase 1: F1, F2, F3 in parallel worktrees. Lead merges each, then builds `:core:navigation` shell and `:app`. Commit.
3. Phase 2: P1, P2, P5, P6 start together; P3, P4 too (builder shell contract = design-system top bar + mode bar,
   `Builder` route, share slot). Lead merges as they finish.
4. Phase 3: full build, lint, tests, Roborazzi; emulator smoke against the real API; independent review
   (`REVIEW.md`); `HANDOFF-REPORT.md`. Commit.

## Rules for every agent

- Own only your modules. `:core:*`, `:app` and `gradle/libs.versions.toml` changes go through the lead (ask in your
  report; a missing component is a request, not a local look-alike).
- Tokens and design-system components only. No Material visuals. Copy from the web app; `GLOSSARY.md` for terms.
- Roborazzi test per screen and theme at `w390dp-h844dp-xhdpi[-night]`; compare to `screens/<ID>-{light,dark}.png`.
- Never weaken tests or skip checks.
- Commit messages: Conventional Commits, no AI attribution. If signing fails, `git -c commit.gpgsign=false commit`.

## Status

- [x] Phase 0: scaffold, contracts, plan (3a9091160).
- [x] Phase 1: F1 design system + harness, F2 network/data/database, F3 auth/page/strings merged; navigation shell, app
      NavHost, repositories, preferences and draft-sync wiring (through 3d6dcc099).
- [ ] Phase 2: P1–P6 running in parallel worktrees from 3d6dcc099.
- [ ] Phase 3: integrate, emulator smoke, independent review, report.

## Known backend gaps (from foundation agents)

- External-app consent (A4): app bearer can't satisfy Better Auth's cookie-session consent endpoint; web fallback.
- No native guest accounts: server refuses OAuth tokens for anonymous users.
- Saved versions and feedback snapshots have no PDF endpoint; public PDF requires downloads enabled.
- REST PDF check requires authentication (signed-out P2).
- Two-step, passkey and session management, API key creation, password set and account deletion are browser-only for
  bearer callers.
- App Links: `MOBILE_ANDROID_PACKAGES` and `MOBILE_ANDROID_CERT_SHA256` must list `me.rxresu`, `me.rxresu.debug` and
  their signing fingerprints; assetlinks lacks `delegate_permission/common.get_login_creds` for passkeys.

## Lead backlog (requests from feature agents)

- Design system round 2 (after D1 lands): `RrBottomSheet` fit-content height must follow content and detent changes;
  `RrSectionHeader` top padding; `RrListRow` AnnotatedString title and top-aligned 40 dp tile layout; quick-action
  tile (D2); vertical step list (D4); link-style `RrCallout` action; close (×) leading icon on `RrTopBar`;
  `RrAvatar` icon fallback and 200% initials. Replace the `TODO(lead)` stand-ins in today/documents/search.
- One app-level undo/toast service in `:core:navigation` to replace `rememberAppScope` (today, documents) and
  `ToastScope` (workspace).
- Routes: query on `Coach` and `Assistant` for search "Ask" rows.
- App wiring: "New resume" quick action (with :feature:system); `POST_NOTIFICATIONS` declared by :feature:today.
- Copy to confirm with the owner: D4 reader "Read on your server (free) / Reads the text layer, without AI" (the
  Android reader can't read on the device like the storyboard's "Nothing leaves your phone").
