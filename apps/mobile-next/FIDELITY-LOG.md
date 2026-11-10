# Fidelity log

## 2026-11-10 · Pass 1 · text metrics, iOS (iPhone 14 simulator, iOS 27.2, debug storyboard build)

Method: `app/(dev)/metrics/[set].tsx` draws storyboard texts at their dumped positions; `scripts/text-metrics.py`
compares the ink bounding box of each with the storyboard PNG (dp, capture minus storyboard).

| Style                  | Sample                       | Top       | Bottom    | Correction            |
| ---------------------- | ---------------------------- | --------- | --------- | --------------------- |
| rootTitle 34/40 serif  | Today                        | −1.5      | −1.0      | +1 dp in `Text` (iOS) |
| pageTitle 28/34 serif  | Product designer             | −0.5      | −0.5      | none                  |
| sheetTitle 22/28 serif | Needs you, Sections          | 0 to +0.5 | 0 to +0.5 | none                  |
| heading 20/28          | Technical interview at Lumen | 0         | 0         | none                  |
| body 15/24             | hero paragraph, status line  | +0.5      | 0         | none                  |
| rowTitle 16/24         | Basics                       | +0.5      | +0.5      | none                  |
| ui 14/20               | row secondary, date          | 0 to +1   | +1        | none (within 1 dp)    |
| keyLine 13/18          | Tuesday 10 Nov · 10:00       | +1        | +0.5      | none (within 1 dp)    |

Line boxes: every style lays out at exactly lines × line height (checked through the layout dump once the harness runs).

## 2026-11-10 · Pass 3 · iOS line boxes

Agent A's first scoreboard showed lists drifting about 1.3 dp per two-line row. Probe (`onLayout` on bare `Text`):
every iOS Text measures lines × line height + 1 device pixel (24.33, 20.33, 28.33, two lines 48.33), with or without
custom fonts or `lineHeight` quirks. Fix in `src/ui/Text.tsx`: `marginBottom: -1 / PixelRatio.get()` on iOS, so each
Text contributes exactly its line box to layout. The design tag now also reports style overrides (font size, line
height, family) instead of the variant's.

## 2026-11-10 · Pass 3 · iOS scoreboard so far (debug build, per-agent captures)

| Group | Screens           | Passing | Notes                                                                                                                |
| ----- | ----------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| A     | A1–A4, S1–S8      | 12 / 12 | 0.5–1.1% pixel difference, both themes                                                                               |
| F     | C1–C7, P1, P2, X1 | 7 / 10  | C1 (root title offset), C2 (dump joins two text nodes), C7 (C1 stub behind the sheet is drawn higher than C1 itself) |

`rootTitle` glyph offset on iOS reduced from +1 to +0.5 dp: the layout tool measures the translated box, and +1 put
the title 1.5 dp from the dump's text box (57.5) on every root tab. At +0.5 the box measures 58.5 (within 1 dp) and
the glyphs sit 1.0 / 0.5 dp high (within 1 dp).

## 2026-11-10 · Pass 4 · text metrics and first scoreboard, Android (Pixel_10_Pro emulator, API 37, 1170 × 2532 at 480 dpi = 390 × 844 dp, debug storyboard build)

Line boxes: `onLayout` on the metrics probe reports exactly lines × line height for every style on Android (rootTitle 40,
pageTitle 34, sheetTitle 28, heading 28, body 24 and 48 for two lines, rowTitle 24, ui 20, keyLine 18). No line-box fix
is needed; `textDefaults` (`includeFontPadding: false`, `textAlignVertical: "center"`) already gives CSS line boxes.

Glyphs, measured with `scripts/text-metrics.py` (dp, capture minus storyboard; 0.5 dp resolution at the PNGs' 2 px/dp):

| Style                  | Sample                       | Top before | Bottom before | Correction (Android) | Top after | Bottom after |
| ---------------------- | ---------------------------- | ---------- | ------------- | -------------------- | --------- | ------------ |
| rootTitle 34/40 serif  | Today                        | +0.5       | +1.0          | −1 dp                | −0.5      | 0            |
| pageTitle 28/34 serif  | Product designer             | +1.0       | +1.0          | −1 dp                | 0         | 0            |
| sheetTitle 22/28 serif | Needs you, Sections          | +0.5, +1.0 | +0.5, +1.0    | −1 dp                | −0.5, 0   | −0.5, 0      |
| heading 20/28          | Technical interview at Lumen | 0          | 0             | none                 | 0         | 0            |
| body 15/24             | hero paragraph, status line  | +0.5       | 0             | none                 | +0.5      | 0            |
| rowTitle 16/24         | Basics                       | +0.5       | +0.5          | none                 | +0.5      | +0.5         |
| ui 14/20               | date, row secondary lines    | 0 to +1.0  | +1.0          | −0.5 dp              | 0 to +0.5 | +0.5 to +1.0 |
| keyLine 13/18          | Tuesday 10 Nov · 10:00       | +1.0       | +0.5          | −1 dp                | 0         | −0.5         |

The corrections live in `glyphShift.android` in `src/ui/Text.tsx`; iOS values are unchanged. The ui style's remaining
+1 bottom is the comma descender in "Northwind Labs, Harbour Studio".

Launch: no Android-specific fixes were needed (edge-to-edge insets, `boxShadow` strings, keyboard-controller and the
static fonts all work). Native build needs `packages/forme-native/android/src/main/jniLibs` (Rust output, git-ignored;
`pnpm --filter @reactive-resume/forme-native build:native`, or copy from a checkout that built it).

Scoreboard (`fidelity.py --system-bars`): A1–A4 and S1–S8 pass with 0 layout failures, 0.42–0.71 % differing pixels
per theme and no bands. The debug build's floating gear accounts for most of the remaining pixels.

## 2026-11-10 · Pass 5 · integration of the three screen groups, iOS (iPhone 14 simulator, debug storyboard build)

The merged tree did not compile (`Chip` destructured `trailingIcon` twice; `Text` called the removed `iosLineBox`), so
every screen first produced no dump. After the compile fixes: 24 of 30 passing; after this pass: 30 of 30, no EXTRA
elements on screen.

Line boxes: two fixes had been merged, `marginBottom: -1 / PixelRatio.get()` and a line height 0.01 under the token.
`onLayout` on every style, one and two lines, stacked: with the margin each Text still measures +1 device pixel (24.33,
48.33) though stacking no longer drifts; with the line height every style measures exactly lines × line height
(24.00, 48.00) and stacks exactly. Kept the line height; the margin is gone.

Root title (iOS): the layout tool measures the box with its transform, so a translate moves box and ink together. With
the 2 dp margin and the +0.5 translate the box sat at 57.5 but the ink 1.5–2.0 dp high. Now no margin and no translate;
`Text` moves the rootTitle ink 2/3 dp down inside its box (padding, taken back with a negative margin). T1, T2, D1, J1
and C1: box 58.0 × 40.7 (dump 57.5 × 40), ink top −0.5 to −1.0, bottom −0.5, both themes.

Serif widths (D1's "Cover letters" count 1.2 dp right): the boards' widths equal HarfBuzz shaping with the font's GPOS
kerning ("Cover letters" 91.56, design 91.5); the app's equalled the unkerned advances (92.36, laid out 92.67). The
serif tokens set `letterSpacing: 0`, which React Native on iOS passes as `NSKern` 0 and that turns kerning off.
`fontVariant` and ligature settings changed nothing. Without the attribute: 91.67. Non-zero tracking (rootTitle −0.17)
keeps kerning ("Today" 68.7 against 68.65 kerned, 71.43 unkerned).

Backdrops: the boards draw a stub under S7, S8, C7, D2 and D3. `src/dev/storyboard/backdrop.tsx` (route
`/storyboard-backdrop/<ID>`) draws exactly what each dump lists outside the sheet or dialog; the scenarios present the
real sheet over it. S1's storyboard-only hidden body is gone.

## 2026-11-10 · Pass 6 · Android after the design-system changes (Pixel_10_Pro emulator, API 37, 390 × 844 dp, debug storyboard build)

Text metrics (`app/(dev)/metrics/[set].tsx` with `onLayout`, `scripts/text-metrics.py`): line boxes exact for every
style (rootTitle 40, pageTitle 34, sheetTitle 28, heading 28, body 24 and 48, rowTitle 24, ui 20, keyLine 18). Glyphs
after the Android offsets, dp (capture minus storyboard), top / bottom:

| Style      | Sample                       | Top       | Bottom            |
| ---------- | ---------------------------- | --------- | ----------------- |
| rootTitle  | Today                        | −0.5      | 0                 |
| pageTitle  | Product designer             | 0         | 0                 |
| sheetTitle | Needs you, Sections          | 0, −0.5   | 0, −0.5           |
| heading    | Technical interview at Lumen | 0         | 0                 |
| body       | hero paragraph, status line  | +0.5      | 0                 |
| rowTitle   | Basics, Summary, Experience  | +0.5      | +0.5              |
| ui         | date, row secondary lines    | 0 to +0.5 | +0.5 (comma +1.0) |
| keyLine    | Tuesday 10 Nov · 10:00       | 0         | −0.5              |

Kerning: Android keeps Instrument Serif's kerning with or without `letterSpacing: 0` ("Cover letters" 91.67 both ways,
boards 91.5; "Offer" 39.0 both ways, boards 38.5; "Today" at −0.17 tracking 69.0, boards 68.5). Dropping the attribute
for iOS changes nothing on Android.

Fixes:

- Glyph shifts are ink corrections, but the layout tool measured the translated box, so on C6 the ui labels (0.7 dp high
  on both platforms from the screen's own layout) went 1.2 dp out. `Text` now reports the line box at its layout
  position when it applies a shift (`untranslatedBox` in the harness). Only Android has shifts.
- `textDefaults` centres text vertically (`textAlignVertical`, Android only), so a Text stretched by its row drew its
  lines in the middle: C2's list numbers sat beside the middle line. `Text` now aligns to the top as CSS does; text
  inputs keep the centring from `textDefaults`.
- C4's topic chips start above the fold and their labels sit below it: the harness dropped the labels as off-frame. An
  off-frame text or icon now stays when its innermost component is partly on screen.

Scoreboard (`fidelity.py --system-bars`): 30 of 30 (A1–A4, S1–S8, T1, T2, D1–D6, C1–C7, P1, P2, X1), 0 layout failures,
0 EXTRA, 0.38–0.91 % differing pixels per theme except D3 dark 2.02 % (the backdrop's document thumbnails are brighter
than the boards under the dark scrim, the same on iOS). Backdrops, sheet and dialog shadows, rings, the 47/34 insets, the
dock, `TextBlock` on C2, P1's page and the text fields needed no Android change.
