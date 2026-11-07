# :core:testing

Screenshot harness for every module: Robolectric (SDK 36, native graphics) plus Roborazzi, sized like the storyboard.

## Write a screen test

```kotlin
class TodayScreenshotTest : RrScreenshotTest() {
    @Test fun light() = captureScreen("T1-Today", dark = false) { TodayScreen(state = sampleToday) }
    @Test fun dark() = captureScreen("T1-Today", dark = true) { TodayScreen(state = sampleToday) }
}
```

- `RrScreenshotTest` sets `@RunWith(RobolectricTestRunner)`, `@GraphicsMode(NATIVE)` and
  `@Config(sdk = [36], qualifiers = "w390dp-h844dp-xhdpi")`, so captures are 780×1688 px like `screens/<ID>-<theme>.png`.
  Use `RR_SCREEN_QUALIFIERS_NIGHT` if a class must pin night mode itself.
- `captureScreen(id, dark)` wraps the content in `RrTheme`, paints `bg`, reports the storyboard's 47 dp status bar and
  34 dp gesture bar as system bar insets (`safeArea = false` to skip), and records
  `src/test/screenshots/<ID>-light.png` or `-dark.png`.
- `wrap = { content -> CompositionLocalProvider(LocalRepositories provides fakes) { content() } }` injects providers
  (fake repositories, view-model factories) inside the theme.
- `fontScale = 2f` records `<ID>-light-font200.png` for the 200% check (no storyboard diff).
- `captureComponent(name, dark)` records a component at its own height under `src/test/screenshots/components/`.
- `captureBoard(name, "boards/Kit.png")` records a whole board as drawn (size the test with `@Config(qualifiers = …)`).
- Captures run in inspection mode: endless animations (spinners, Working labels) hold still so the UI can settle.
  Overlays in their own window (`RrAlertDialog`, `RrMenu`) are not in the capture; draw `RrAlertDialogLayer` or
  `RrMenuSurface` in place for a screenshot.

## Record and verify

```sh
./gradlew :feature:today:recordRoborazziDebug   # write goldens
./gradlew :feature:today:verifyRoborazziDebug   # fail on any change (the regression gate)
```

Modules need, in their unit-test options, `jvmArgs("--add-opens=java.base/java.io=ALL-UNNAMED",
"--add-exports=java.base/jdk.internal.access=ALL-UNNAMED")` (Robolectric SDK 36 on JDK 17+) and
`roborazzi { outputDir.set(file("src/test/screenshots")) }`; see `core/designsystem/build.gradle.kts`.

## Storyboard diff

When the handoff folder is on the machine, each `captureScreen` also writes `build/reports/storyboard-diff/<ID>-<theme>.png`
(storyboard | capture | differences in red), a `.txt` with the share of differing pixels, and an `index.html` for the
module. It is a report, never an assertion, and does nothing on CI. The folder is found from `RR_HANDOFF_DIR`, else at
`.agents/handoff/android-app` in the repository that owns the working directory (a worktree resolves to its main
checkout). The diff compares against the golden on disk, so record first.
