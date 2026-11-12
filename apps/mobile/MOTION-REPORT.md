# Motion report

Probes from `design/motion-probes.json` (MOTION.md §10.4), recorded with `tools/rn_capture.mjs record --warm` and
measured with `tools/motion_probe.py suite`. A probe passes when its fitted duration is within max(17 ms, 8%) of the
token, the token curve fits with RMS ≤ 0.06 and no other curve fits better by more than 0.01, and tab-in starts
within 20 ms of tab-out's end.

## iOS

Release storyboard build (`me.rxresu.storyboard`, configuration Release, no Metro), iPhone 14 simulator (slot 1),
light theme. Final run: 2026-11-10 21:00, on the committed code (build C).

**Result: 18 of 26 on the final run. Not done.** No run reached 26: the best runs scored 20 (builds A and B), and
build C scored 14 and 18. The set of failing probes changes from run to run. Only press-in, menu and reorder-lift
fail in nearly every run.

The machine was never quiet. Other agents' Xcode builds, an Android emulator, two other simulators and a browser kept
the 1-minute load average between 5 and 470 (10 cores) for the whole session. The two build C runs had 14 to 22.
Every failing probe was also recorded on its own (the "solo" columns).

### Final run (build C, `build/motion/ios8`, load average 16)

| Probe             | What                                                                                                   | Result   | Measured  | Token                     | Curve fit (RMS) | Best other             | Note                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------- | --------- | ------------------------- | --------------- | ---------------------- | ------------------------------------- |
| press-in          | Button pressed: 1 → 0.97                                                                               | pass     | 115.0 ms  | 120 ms ease               | 0.0399          | ease-out-strong 0.0461 |                                       |
| press-out         | Button released: 0.97 → 1 (exit, 70% of d1)                                                            | pass     | 82.1 ms   | 84 ms ease                | 0.0025          | ease-out-strong 0.0014 |                                       |
| push-covered      | Push: covered screen shifts 30% (200 → 83)                                                             | pass     | 318.5 ms  | 320 ms ease               | 0.0053          | ease-out-strong 0.009  |                                       |
| push-new          | Push: new screen slides in (marker centre 414 → 24)                                                    | pass     | 316.0 ms  | 320 ms ease               | 0.0004          | ease-out-strong 0.0066 |                                       |
| pop-covered       | Pop: covered screen returns (83 → 200), 70% of d3                                                      | pass     | 216.6 ms  | 224 ms ease               | 0.0012          | ease-out-strong 0.0056 |                                       |
| modal             | Full-screen modal rises (marker centre 976 → 132)                                                      | pass     | 338.5 ms  | 320 ms ease               | 0.0184          | ease-out-strong 0.0169 |                                       |
| sheet-rise        | Sheet rises (marker centre 860 → 390)                                                                  | **fail** | 251.0 ms  | 320 ms ease               | 0.0158          | ease-drawer 0.0173     | duration 251.0 ms, token 320 ms       |
| sheet-scrim       | Scrim fades in with the sheet (d2)                                                                     | **fail** | 150.0 ms  | 200 ms ease               | 0.0156          | ease-drawer 0.0082     | duration 150.0 ms, token 200 ms       |
| sheet-close-scrim | Sheet closed by its button: scrim fades out (70% of d2)                                                | **fail** | 90.0 ms   | 140 ms ease               | 0.025           | ease-drawer 0.0286     | duration 90.0 ms, token 140 ms        |
| sheet-release     | Sheet dragged 40% and released: dismisses with ease-drawer, duration scaled to the remaining 60% of d3 | **fail** | 118.8 ms  | 192 ms ease-drawer        | 0.0303          | ease 0.0085            | duration 118.8 ms, token 192 ms       |
| tab-out           | Tab switch: old content fades out (140 ms)                                                             | **fail** | 73.0 ms   | 140 ms ease               | 0.0076          | ease-drawer 0.0046     | duration 73.0 ms, token 140 ms        |
| tab-in            | Tab switch: new content fades up after the old is gone (d2)                                            | **fail** | 189.0 ms  | 200 ms ease               | 0.0034          | ease-out-strong 0.004  | starts at 2085.3 ms, expected 2032 ms |
| tab-in-rise       | Tab switch: new content rises 6 dp                                                                     | pass     | 185.0 ms  | 200 ms ease               | 0.0303          | ease-out-strong 0.0365 |                                       |
| segment           | Segmented control thumb slides (List → Board)                                                          | pass     | 201.0 ms  | 200 ms ease-in-out-strong | 0.0027          | ease-drawer 0.0276     |                                       |
| switch            | Switch thumb moves (d1)                                                                                | pass     | 121.0 ms  | 120 ms ease               | 0.001           | ease-out-strong 0.0044 |                                       |
| toast-rise        | Toast rises 8 dp (d3)                                                                                  | pass     | 321.0 ms  | 320 ms ease               | 0.0124          | ease-out-strong 0.0179 |                                       |
| toast-fade        | Toast fades in with the rise (d3)                                                                      | pass     | 300.5 ms  | 320 ms ease               | 0.0097          | ease-out-strong 0.0132 |                                       |
| toast-fuse        | Toast fuse runs linearly (lab lifetime 1.5 s)                                                          | pass     | 1482.5 ms | 1500 ms linear            | 0.0022          | ease-drawer 0.0742     |                                       |
| dialog            | Dialog fades in (d2) while scaling from 0.98                                                           | pass     | 192.0 ms  | 200 ms ease               | 0.0031          | ease-out-strong 0.0072 |                                       |
| menu              | Menu settles 4 dp away from its trigger (d2)                                                           | **fail** | 115.5 ms  | 200 ms ease               | 0.0183          | ease-drawer 0.0178     | duration 115.5 ms, token 200 ms       |
| row-fold          | A row that leaves folds its height (d2)                                                                | pass     | 201.5 ms  | 200 ms ease               | 0.0008          | ease-out-strong 0.0054 |                                       |
| row-close-gap     | Rows below close the gap (d2)                                                                          | pass     | 202.5 ms  | 200 ms ease               | 0.0017          | ease-out-strong 0.0063 |                                       |
| reorder-lift      | Lifting a row: 1 → 1.02 (d1)                                                                           | **fail** | 74.5 ms   | 120 ms ease               | 0.0149          | ease-drawer 0.0118     | duration 74.5 ms, token 120 ms        |
| reorder-neighbour | The neighbour slides up one slot (d2, ease-in-out-strong)                                              | pass     | 199.0 ms  | 200 ms ease-in-out-strong | 0.0016          | linear 0.0389          |                                       |
| title-collapse    | After 40 dp of scroll the bar title fades in (d2)                                                      | pass     | 193.5 ms  | 200 ms ease               | 0.004           | ease-out-strong 0.0033 |                                       |
| page-hero         | Page band → full-screen preview (shared element, d3 ease-drawer)                                       | pass     | 321.0 ms  | 320 ms ease-drawer        | 0.0012          | ease-out-strong 0.0132 |                                       |

### Every run on the fixed code

Build A: the Menu fix and the first motion-lab fixes (the switch to the next lab's still scene at 5.1 s). Build B adds
the reorder lift change. Build C switches every lab at 4.9 s and only the title lab at 5.1 s: at 5.1 s, ios6 caught
the switch in the first frame of the next recording (toast-fuse, 595 ms). The builds also carry other agents'
uncommitted edits in the shared checkout, none of them to motion values. "full" means all 18 labs back to back;
"solo" means one lab, opened still just before it was recorded. A dash means not recorded. r1's reorder recording
caught the first-link system prompt after the fresh install ("no motion").

| Probe             | Token                     | A full `ios3` | A solo `q1` | A solo `q2` | A solo `q3` | A full `ios4` | B solo `r1` | B solo `r2` | B full `ios5` | B full `ios6`  | C full `ios7`  | C full `ios8`  |
| ----------------- | ------------------------- | ------------- | ----------- | ----------- | ----------- | ------------- | ----------- | ----------- | ------------- | -------------- | -------------- | -------------- |
| press-in          | 120 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | **fail** 177.0 | **fail** 179.0 | pass 115.0     |
| press-out         | 84 ms ease                | –             | –           | –           | –           | –             | –           | –           | –             | pass 90.1      | pass 90.6      | pass 82.1      |
| push-covered      | 320 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 318.5     | pass 311.0     | pass 318.5     |
| push-new          | 320 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 316.0     | **fail** 293.0 | pass 316.0     |
| pop-covered       | 224 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 216.6     | pass 216.6     | pass 216.6     |
| modal             | 320 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 316.0     | pass 331.5     | pass 338.5     |
| sheet-rise        | 320 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 319.5     | **fail** 268.5 | **fail** 251.0 |
| sheet-scrim       | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 184.0     | **fail** 168.5 | **fail** 150.0 |
| sheet-close-scrim | 140 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 131.0     | pass 132.0     | **fail** 90.0  |
| sheet-release     | 192 ms ease-drawer        | –             | –           | –           | –           | –             | –           | –           | –             | **fail** 134.8 | **fail** 133.3 | **fail** 118.8 |
| tab-out           | 140 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 134.5     | pass 131.0     | **fail** 73.0  |
| tab-in            | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 189.0     | pass 189.0     | **fail** 189.0 |
| tab-in-rise       | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 185.0     | pass 185.0     | pass 185.0     |
| segment           | 200 ms ease-in-out-strong | –             | –           | –           | –           | –             | –           | –           | –             | pass 205.0     | pass 204.5     | pass 201.0     |
| switch            | 120 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 119.5     | **fail** 61.0  | pass 121.0     |
| toast-rise        | 320 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | **fail** 227.0 | **fail** 331.0 | pass 321.0     |
| toast-fade        | 320 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 330.5     | **fail** 349.0 | pass 300.5     |
| toast-fuse        | 1500 ms linear            | –             | –           | –           | –           | –             | –           | –           | –             | **fail** 595.0 | pass 1483.0    | pass 1482.5    |
| dialog            | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 213.5     | **fail** 102.0 | pass 192.0     |
| menu              | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | **fail** 174.5 | **fail** 178.0 | **fail** 115.5 |
| row-fold          | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 203.0     | pass 201.0     | pass 201.5     |
| row-close-gap     | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 203.0     | pass 199.0     | pass 202.5     |
| reorder-lift      | 120 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | **fail** 60.0  | **fail** 53.0  | **fail** 74.5  |
| reorder-neighbour | 200 ms ease-in-out-strong | –             | –           | –           | –           | –             | –           | –           | –             | pass 199.0     | pass 199.0     | pass 199.0     |
| title-collapse    | 200 ms ease               | –             | –           | –           | –           | –             | –           | –           | –             | pass 193.5     | **fail** 135.0 | pass 193.5     |
| page-hero         | 320 ms ease-drawer        | –             | –           | –           | –           | –             | –           | –           | –             | pass 311.0     | pass 318.0     | pass 321.0     |

### What the failures are

- **press-in (measured 167–195 ms, token 120)** failed in 9 of 11 runs; it passed once solo (115 ms) and in the final run. The button's
  width reaches 0.97 within about 70 ms of the first changed frame, which matches `ease` over 120 ms. The press only
  takes 1.7 dp off the button's height, though, and the top and bottom edges move one analysis pixel at a time, the
  last pixel about 110 ms in. That step tail makes the fitted duration long. press-out (84 ms) passes in every run.
- **reorder-lift (46–80 ms, token 120)** fails in every run. The row grows 12 analysis pixels in width over the lift,
  so one pixel is 8% of the motion. Its first changed frame is already at about 50% (`ease` over 120 ms reaches that
  after 25 ms), and the fit may only start the motion up to 24 ms before the last still frame. Starting the lift in
  the same frame as the gesture (build B) did not change the measurement.
- **menu (113–182 ms, token 200)** fails in every run. Before this pass the probe measured a defect: the menu's lab
  marker layer never moved (see the log). Since the fix, the marker and the surface move together and follow `ease`
  over 200 ms for the first three frames. Then one frame jumps about a frame ahead (progress 0.61, then 0.93 against
  0.82 expected), so the fit comes out short. The best runs measured 178–182 ms, against a pass mark of 183.
- **sheet-rise, sheet-scrim, toast-rise, dialog, modal, switch, title-collapse** each failed in at least one run and
  passed in the others with the same build. Each failing series shows a frame gap or a duplicated frame near the
  start: the video's frame times step 12–20 ms instead of 16.7 under load.

pop-covered, which never passed on the debug build, passes in every run on Release (216–241 ms).

## Android

Not run in this pass.
