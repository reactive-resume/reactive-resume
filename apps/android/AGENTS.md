# Android app (`apps/android`)

Native Kotlin + Jetpack Compose app. The root `AGENTS.md` still applies. Decisions, module owners and status are in
`PLAN.md`. The design handoff (storyboard screens, notes, tokens) lives outside git at
`/Users/amruth/Projects/reactive-resume/.agents/handoff/android-app/` on the owner's machine.

## Build and test

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home   # JDK 21
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties                      # once per checkout (gitignored)
./gradlew assembleDebug
./gradlew :feature:today:testDebugUnitTest            # unit + screenshot tests of one module
./gradlew :feature:today:recordRoborazziDebug         # write screenshot goldens
./gradlew :feature:today:verifyRoborazziDebug         # fail on screenshot changes
./gradlew :feature:today:lintDebug
```

- Several builds may run at once on a 32 GB machine: keep the heap settings in `gradle.properties`, send long output to
  a log file, and never run `./gradlew --stop` (it kills every checkout's daemon). If a build reports "stop command
  received", run it again.
- No emulator for feature work: Robolectric and Roborazzi only. One device at a time on this machine.

## Modules

- `:app`: activity, `AppGraph` (constructor injection, no DI framework), `RrApp` NavHost, tab bar, toasts.
- `:core:navigation`: `Routes.kt` (every screen as a type-safe route), `Shell.kt` (`screen<T>()`, `tabRoot<T>()`,
  `modal<T>()`, `sheet<T>()`, `RrNavMotion`, `LocalToasts`, slot locals), `DeepLinks.kt`.
- `:core:designsystem`: tokens, `RrTheme`, every component (`Rr*`). `:core:testing`: screenshot harness (README there).
- `:core:network`, `:core:data`, `:core:database`: generated API client, repositories (`LocalRepositories`, real and
  fake), offline drafts. `:core:auth`: sign-in (`AuthService`). `:core:page`: `PageRenderer`. `:core:strings`: catalogs.
- `:feature:<area>`: screens. Each exposes `fun NavGraphBuilder.<area>Graph(nav: NavController, motion: RrNavMotion)`,
  called from `RrApp`. Builder Share mode and workspace tabs are slots (`LocalBuilderShareMode`, `LocalWorkspaceTab`).

## Feature rules

- Own your modules only. Changes to `:core:*`, `:app`, `gradle/libs.versions.toml` or `build-logic` are requests to the
  lead. A missing component is a request, never a local look-alike.
- Design-system components and tokens only: no Material components or colours, no raw `Color(...)`, no `dp` values
  that aren't on the boards or in tokens. Paper is white in both themes.
- Strings: `me.rxresu.core.strings.R.string.*` (search the English text in `core/strings/src/main/res/values/strings.xml`).
  Copy missing from the catalogs goes in the feature's own string resources (`src/main/res/values/`), in English, copied from the web
  app (`apps/web/src`); terms follow `GLOSSARY.md`. Sentence case, no exclamation marks, no emoji.
- Screens take state and callbacks (stateless) and a `ViewModel` owns loading. Create view models with
  `viewModel { XViewModel(LocalRepositories.current.x) }`; previews and tests pass fake repositories.
- Accessibility: TalkBack labels on icon-only controls, 44 dp targets, start/end layout (RTL), font scale 200%, a menu
  alternative for every drag or swipe.
- Haptics through `rememberRrHaptics()`, one per gesture, never on scroll, typing or plain navigation. Motion through
  `RrMotion`; honour `RrTheme.reducedMotion`.
- One Roborazzi test per screen and theme: `captureScreen("<ID>-<Name>", dark)` with the storyboard file stem
  (`T1-Today`, `J6-Detail`, …) so the diff report pairs it with `screens/<ID>-<theme>.png`. Unit-test view models and
  non-trivial logic with fakes and virtual time; never real waits.
- Commits: Conventional Commits (`feat(android): …`), no AI attribution. If signing fails:
  `git -c commit.gpgsign=false commit`.
