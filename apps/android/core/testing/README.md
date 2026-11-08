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

The `rr.android.*` convention plugins already set the Robolectric JVM flags and the Roborazzi output directory.

## Strict storyboard v2.1 fidelity

`captureScreen` also records fresh rendered PNGs and unmerged-semantics JSON under the Android root's
`build/fidelity/`. These actuals are independent of regression goldens. `DesignTag` supplies component,
type, icon and color-token metadata; text widths come from measured glyph runs. Insets use the same
`LocalRrInsets` contract as production, pinned to 47/34 dp in tests. `StoryboardFrame` is available for
standalone Compose tests.

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ./gradlew fidelity
```

Run from `apps/android`. This deletes stale actuals, reruns feature/design-system tests, invokes the
handoff's unchanged `tools/fidelity.py`, and rejects frames whose real dimensions differ from 780×1688.
Set `RR_HANDOFF_DIR` to the absolute bundle path in separate worktrees. The task never records over
storyboard PNGs or regression goldens. Missing screens and failing measurements remain failures.

Vertically scrollable captures also write `-end.png` and `-end.json` after real semantic scroll actions.
Review these for offscreen content; lazy-list semantic offsets are estimates, not pixel coordinates.
Kit renders at the same xhdpi density as phone captures and exports at 0.5 scale to its 2240×1400
reference size. Its JSON retains actual dp measurements; this avoids mdpi-only accumulated glyph rounding.

## Informational legacy diff

When the handoff folder is on the machine, each `captureScreen` also writes `build/reports/storyboard-diff/<ID>-<theme>.png`
(storyboard | capture | differences in red), a `.txt` with the share of differing pixels, and an `index.html` for the
module. It is a report, never an assertion, and does nothing on CI. The folder is found from `RR_HANDOFF_DIR`, else at
`.agents/handoff/android-app` in the repository that owns the working directory (a worktree resolves to its main
checkout). The diff compares against the golden on disk, so record first.
