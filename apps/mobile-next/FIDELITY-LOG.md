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
