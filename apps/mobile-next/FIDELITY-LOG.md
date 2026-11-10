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
