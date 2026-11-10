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

## 2026-11-10 · Pass 6 · all 67 screens on one tree, iOS (iPhone 14 simulators 2 and 4, debug storyboard build)

Applications and workspace merged onto builder, letters and the behaviour wiring. Baseline after the merge: 50 of 67
passing. Final: 67 of 67 passing `fidelity.py`; five screens still carry EXTRA lines (below).

Causes fixed:

- Scroll-viewport dump clip (applications branch) dropped elements the boards list behind footers and docks (B1, D4,
  B17 regressions). Boards disagree here: B1, D4, B17 list what sits behind the footer or dock; W1, W3, B5, B6, B9,
  B10, B11 end their content at the viewport. The clip is now opt-in (`PushScreen clipDump`) on those screens, and
  for screens without a footer or dock it also leaves out the home-indicator strip.
- Backdrop text above the scrim: the boards draw the backdrop's `.body` (title down) at `opacity:.5` under the
  scrim; the bar stays full. Storyboard backdrops now do the same (`PushScreen bodyOpacity`); real screens keep the
  spec's scrim only. New stubs where the boards draw one: B14 (back caret only), B19 (bar, title, status at 50%),
  B21 (B2 without Add and the swipe hint).
- Borderless last rows: the boards tag a ListRow only when it draws (a rule) or is a link; plain borderless last rows
  have no component entry. `last` + `boxHidden` on those rows (B2, B5, B8, B10, B12, B13, B14, B15, B19, L1, L2).
- C4: a Chip's label sits below the frame while its box is in it; the boards dump the label as the chip.
  `Box ownsText` lets the owner's box decide (`FrameOwnerContext`).
- B3: `Text wordEllipsis` cuts a clamped text at a whole word and "…" (measured by a hidden copy), so the screen draws
  and the dump reports "…used by six…". iOS `onTextLayout` puts the whole remainder in the last line, so it cannot
  say what a tail-truncated text shows.
- Blank captures (builder group) and the dev client's "Refreshing…" banner (top 40–80 dp band) are capture noise;
  recaptured in batches of three to five with a cold relaunch.

EXTRA lines left (contract issues for the lead, not tool failures):

- B1: Skills ListRow at 829. The board has its texts but no component entry (n 70–71 absent), though the row is in
  the frame.
- B3: "More fields" at 717. SCREENS B3 puts rare fields under "More fields" at the end; the board omits it.
- B9: "Check the exported PDF" at 737 (8 dp above the dock). SCREENS B9 puts it at the end of the list; the board
  omits it.
- B10: "Already covered" and its first row above the dock. SCREENS B10 says below the fold; with three missing terms
  it lands above it. The board leaves the space empty.
- W1: Payments experience row tagged (it has a rule, more rows follow) and Research synthesis peeking 15 dp above the
  footer. The board draws 4 of the 10 requirements its own headline counts and ends the list after row four; no link,
  row or fold is drawn, and the web app lists them all. Kept the ten.

| Screen           | Layout            | Light % | Dark % | Bands | EXTRA | Result |
| ---------------- | ----------------- | ------- | ------ | ----- | ----- | ------ |
| A1-Welcome       | 0 failing / 10 ok | 1.07    | 1.03   | 0     | 0     | pass   |
| A2-SignIn        | 0 failing / 28 ok | 0.65    | 0.6    | 0     | 0     | pass   |
| A3-TwoStep       | 0 failing / 8 ok  | 0.54    | 0.49   | 0     | 0     | pass   |
| A4-Allow         | 0 failing / 26 ok | 0.64    | 0.59   | 0     | 0     | pass   |
| T1-Today         | 0 failing / 51 ok | 0.61    | 0.54   | 0     | 0     | pass   |
| T2-FirstRun      | 0 failing / 39 ok | 0.62    | 0.56   | 0     | 0     | pass   |
| D1-Library       | 0 failing / 53 ok | 0.88    | 0.88   | 0     | 0     | pass   |
| D2-Actions       | 0 failing / 52 ok | 0.64    | 0.57   | 0     | 0     | pass   |
| D3-New           | 0 failing / 46 ok | 0.67    | 0.61   | 0     | 0     | pass   |
| D4-Import        | 0 failing / 38 ok | 0.68    | 0.62   | 0     | 0     | pass   |
| D5-Search        | 0 failing / 38 ok | 0.72    | 0.68   | 0     | 0     | pass   |
| D6-Trash         | 0 failing / 24 ok | 0.72    | 0.67   | 0     | 0     | pass   |
| B1-Overview      | 0 failing / 65 ok | 0.61    | 0.56   | 0     | 1     | pass   |
| B2-Section       | 0 failing / 16 ok | 0.65    | 0.59   | 0     | 0     | pass   |
| B3-Entry         | 0 failing / 31 ok | 0.71    | 0.66   | 0     | 2     | pass   |
| B4-Improve       | 0 failing / 32 ok | 0.84    | 0.76   | 0     | 0     | pass   |
| B5-Basics        | 0 failing / 23 ok | 0.81    | 0.75   | 0     | 0     | pass   |
| B20-NewEntry     | 0 failing / 16 ok | 0.59    | 0.53   | 0     | 0     | pass   |
| B21-EntryActions | 0 failing / 39 ok | 0.64    | 0.55   | 0     | 0     | pass   |
| B6-Design        | 0 failing / 61 ok | 0.54    | 0.48   | 0     | 0     | pass   |
| B7-Template      | 0 failing / 17 ok | 2.43    | 2.38   | 0     | 0     | pass   |
| B8-Layout        | 0 failing / 25 ok | 0.54    | 0.49   | 0     | 0     | pass   |
| B9-Check         | 0 failing / 44 ok | 0.69    | 0.63   | 0     | 1     | pass   |
| B10-JobMatch     | 0 failing / 40 ok | 0.84    | 0.79   | 0     | 3     | pass   |
| B11-Share        | 0 failing / 46 ok | 0.6     | 0.54   | 0     | 0     | pass   |
| B12-WebPage      | 0 failing / 26 ok | 0.61    | 0.54   | 0     | 0     | pass   |
| B13-Visitors     | 0 failing / 15 ok | 0.71    | 0.65   | 0     | 0     | pass   |
| B14-Download     | 0 failing / 33 ok | 0.75    | 0.67   | 0     | 0     | pass   |
| B15-Versions     | 0 failing / 21 ok | 0.5     | 0.53   | 0     | 0     | pass   |
| B16-Assistant    | 0 failing / 43 ok | 0.7     | 0.59   | 0     | 0     | pass   |
| B17-Proposals    | 0 failing / 38 ok | 0.69    | 0.6    | 0     | 0     | pass   |
| B18-Preview      | 0 failing / 46 ok | 0.61    | 0.6    | 0     | 0     | pass   |
| B19-More         | 0 failing / 58 ok | 0.72    | 0.69   | 0     | 0     | pass   |
| L1-Letter        | 0 failing / 33 ok | 0.97    | 0.9    | 0     | 0     | pass   |
| L2-LetterDesign  | 0 failing / 33 ok | 0.61    | 0.55   | 0     | 0     | pass   |
| J1-List          | 0 failing / 66 ok | 0.66    | 0.6    | 0     | 0     | pass   |
| J2-Board         | 0 failing / 46 ok | 0.6     | 0.53   | 0     | 0     | pass   |
| J3-Calendar      | 0 failing / 63 ok | 0.62    | 0.56   | 0     | 0     | pass   |
| J4-Insights      | 0 failing / 33 ok | 0.66    | 0.58   | 0     | 0     | pass   |
| J5-SaveJob       | 0 failing / 42 ok | 0.88    | 0.81   | 0     | 0     | pass   |
| J6-Detail        | 0 failing / 44 ok | 0.61    | 0.55   | 0     | 0     | pass   |
| J7-Stage         | 0 failing / 26 ok | 0.59    | 0.53   | 0     | 0     | pass   |
| J8-Interview     | 0 failing / 39 ok | 0.82    | 0.79   | 0     | 0     | pass   |
| J9-Close         | 0 failing / 33 ok | 0.68    | 0.61   | 0     | 0     | pass   |
| W1-Fit           | 0 failing / 31 ok | 0.82    | 0.76   | 0     | 3     | pass   |
| W2-Apply         | 0 failing / 33 ok | 0.71    | 0.68   | 0     | 0     | pass   |
| W3-Prep          | 0 failing / 28 ok | 0.84    | 0.78   | 0     | 0     | pass   |
| W4-Practice      | 0 failing / 20 ok | 0.66    | 0.61   | 0     | 0     | pass   |
| W5-Messages      | 0 failing / 28 ok | 0.75    | 0.69   | 0     | 0     | pass   |
| C1-Career        | 0 failing / 43 ok | 0.61    | 0.55   | 0     | 0     | pass   |
| C2-Coach         | 0 failing / 42 ok | 0.59    | 0.52   | 0     | 0     | pass   |
| C3-Facts         | 0 failing / 22 ok | 0.65    | 0.58   | 0     | 0     | pass   |
| C4-Story         | 0 failing / 23 ok | 0.73    | 0.67   | 0     | 0     | pass   |
| C5-Preferences   | 0 failing / 36 ok | 0.73    | 0.68   | 0     | 0     | pass   |
| C6-Offers        | 0 failing / 38 ok | 0.81    | 1.49   | 0     | 0     | pass   |
| C7-Schedule      | 0 failing / 31 ok | 0.79    | 0.7    | 0     | 0     | pass   |
| S1-Settings      | 0 failing / 42 ok | 0.67    | 0.62   | 0     | 0     | pass   |
| S2-Account       | 0 failing / 32 ok | 0.7     | 0.65   | 0     | 0     | pass   |
| S3-Preferences   | 0 failing / 33 ok | 0.57    | 0.52   | 0     | 0     | pass   |
| S4-Profile       | 0 failing / 26 ok | 0.85    | 0.8    | 0     | 0     | pass   |
| S5-AI            | 0 failing / 45 ok | 0.78    | 0.72   | 0     | 0     | pass   |
| S6-Provider      | 0 failing / 26 ok | 0.74    | 0.68   | 0     | 0     | pass   |
| S7-FirstSend     | 0 failing / 27 ok | 0.61    | 0.55   | 0     | 0     | pass   |
| S8-SignOut       | 0 failing / 15 ok | 0.51    | 0.54   | 0     | 0     | pass   |
| P1-Public        | 0 failing / 37 ok | 0.5     | 0.44   | 0     | 0     | pass   |
| P2-ATS           | 0 failing / 29 ok | 0.62    | 0.57   | 0     | 0     | pass   |
| X1-Notify        | 0 failing / 36 ok | 0.92    | 0.8    | 0     | 0     | pass   |

## 2026-11-10 · Pass 7 · cold Release, iOS (iPhone 14 simulators 2 and 4, Release storyboard build, app relaunched per screen)

Start: 58 of 67 at `4340b1bb0`. The nine failures were not cold-start or Release effects. The 67/67 debug run was on
`151f58816`, before the data-layer merge (`79a26abd6`) enriched the fake seed (`src/data/board-fixtures.ts`) with data
that screens still drew from their own storyboard overlays, so both showed.

| Screen     | Cause                                                                                                                                        | Fix                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| W1, W3, W4 | Seed's Lumen fit, briefing and two attempts added to the overlay's (`storyboard.savedItems`); the seed's briefing (2 questions) won the sort | Overlay's items moved into the seed; overlay removed                                            |
| S5         | Seed's Ollama provider plus the overlay's (`extraProviders`)                                                                                 | Overlay removed                                                                                 |
| B10        | Seed now has a Lumen posting, so the board match (`!posting`) was skipped and the engine ran (10 of 14)                                      | Board match for any fake linked application; engine not loaded for it                           |
| T1         | Seed's Fieldnote `followUpAt` (9 Nov, future) and applied entry at 12:00Z (9.9 days, under the no-reply threshold)                           | Follow-up date removed (boards draw an undated no-reply step); applied 08:00Z, as E's scenarios |
| J1         | Seed's 13 closed applications (J4's outcomes) add a "Closed · 13" row                                                                        | J1 scenario trashes the closed ones                                                             |
| C3         | Seed's 8 posting-term facts (W1's 12 facts)                                                                                                  | C3 scenario forgets the facts its board doesn't draw                                            |
| B18        | Page render query (fixture PDF via expo-print, seconds in Release) still pending at dump time; `isBusy` counted only fake reads              | Harness waits for in-flight queries and mutations, also inside the stable-dump loop             |

`platform-third.test.ts` dates its own follow-up now that the seed has none. Result: 67 of 67 cold on Release, both
themes, 0.1–0.4% differing pixels.
