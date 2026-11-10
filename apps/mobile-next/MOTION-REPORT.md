# Motion report

Probes from `design/motion-probes.json` (MOTION.md §10.4), recorded with `tools/rn_capture.mjs record --warm` and
measured with `tools/motion_probe.py suite`. A probe passes when its fitted duration is within max(17 ms, 8%) of the
token, the token curve fits with RMS ≤ 0.06 and no other curve fits better by more than 0.01, and tab-in starts
within 20 ms of tab-out's end.

## iOS

Release storyboard build (`me.rxresu.storyboard`, configuration Release, no Metro), iPhone 14 simulator (slot 1),
light theme. Run of 2026-11-10 19:45, on the final code.

**Result: 20 of 26.** Not done: press-in, menu and reorder-lift fail in every run; sheet-rise, sheet-scrim and
toast-rise failed in this run and pass in others.

The machine was never quiet. Other agents' Xcode builds, an Android emulator and two other simulators kept the
1-minute load average between 12 and 470 (10 cores) for the whole session, and 80 to 120 during the final run. Every
failing probe below was recorded again on its own (the "solo" columns).

### Final run (build B, `build/motion/ios5`, load average 81–121)

| Probe             | What                                                                                                   | Result   | Measured  | Token                     | Curve fit (RMS) | Best other             | Note                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------- | --------- | ------------------------- | --------------- | ---------------------- | ----------------------------------------------------------------- |
| press-in          | Button pressed: 1 → 0.97                                                                               | **fail** | 167.5 ms  | 120 ms ease               | 0.0246          | ease-out-strong 0.0284 | duration 167.5 ms, token 120 ms                                   |
| press-out         | Button released: 0.97 → 1 (exit, 70% of d1)                                                            | pass     | 87.6 ms   | 84 ms ease                | 0.0059          | ease-out-strong 0.0079 |                                                                   |
| push-covered      | Push: covered screen shifts 30% (200 → 83)                                                             | pass     | 318.5 ms  | 320 ms ease               | 0.0068          | ease-out-strong 0.0116 |                                                                   |
| push-new          | Push: new screen slides in (marker centre 414 → 24)                                                    | pass     | 316.0 ms  | 320 ms ease               | 0.0006          | ease-out-strong 0.009  |                                                                   |
| pop-covered       | Pop: covered screen returns (83 → 200), 70% of d3                                                      | pass     | 241.1 ms  | 224 ms ease               | 0.0321          | ease-out-strong 0.0297 |                                                                   |
| modal             | Full-screen modal rises (marker centre 976 → 132)                                                      | pass     | 316.0 ms  | 320 ms ease               | 0.0005          | ease-out-strong 0.0089 |                                                                   |
| sheet-rise        | Sheet rises (marker centre 860 → 390)                                                                  | **fail** | 286.5 ms  | 320 ms ease               | 0.0258          | ease-drawer 0.0287     | duration 286.5 ms, token 320 ms                                   |
| sheet-scrim       | Scrim fades in with the sheet (d2)                                                                     | **fail** | 154.0 ms  | 200 ms ease               | 0.0143          | ease-out-strong 0.0135 | duration 154.0 ms, token 200 ms                                   |
| sheet-close-scrim | Sheet closed by its button: scrim fades out (70% of d2)                                                | pass     | 131.5 ms  | 140 ms ease               | 0.002           | ease-out-strong 0.0028 |                                                                   |
| sheet-release     | Sheet dragged 40% and released: dismisses with ease-drawer, duration scaled to the remaining 60% of d3 | pass     | 191.8 ms  | 192 ms ease-drawer        | 0.0004          | ease-out-strong 0.0094 |                                                                   |
| tab-out           | Tab switch: old content fades out (140 ms)                                                             | pass     | 137.0 ms  | 140 ms ease               | 0.0035          | ease-out-strong 0.0028 |                                                                   |
| tab-in            | Tab switch: new content fades up after the old is gone (d2)                                            | pass     | 189.0 ms  | 200 ms ease               | 0.004           | ease-out-strong 0.0049 |                                                                   |
| tab-in-rise       | Tab switch: new content rises 6 dp                                                                     | pass     | 185.0 ms  | 200 ms ease               | 0.0393          | ease-out-strong 0.0464 |                                                                   |
| segment           | Segmented control thumb slides (List → Board)                                                          | pass     | 205.0 ms  | 200 ms ease-in-out-strong | 0.0017          | linear 0.0587          |                                                                   |
| switch            | Switch thumb moves (d1)                                                                                | pass     | 119.0 ms  | 120 ms ease               | 0.0015          | ease-drawer 0.0039     |                                                                   |
| toast-rise        | Toast rises 8 dp (d3)                                                                                  | **fail** | 310.0 ms  | 320 ms ease               | 0.0644          | ease-out-strong 0.0675 | curve ease fits with RMS 0.0644; ease-out-strong fits with 0.0675 |
| toast-fade        | Toast fades in with the rise (d3)                                                                      | pass     | 332.5 ms  | 320 ms ease               | 0.0038          | ease-out-strong 0.0045 |                                                                   |
| toast-fuse        | Toast fuse runs linearly (lab lifetime 1.5 s)                                                          | pass     | 1483.5 ms | 1500 ms linear            | 0.0013          | ease-drawer 0.0744     |                                                                   |
| dialog            | Dialog fades in (d2) while scaling from 0.98                                                           | pass     | 191.5 ms  | 200 ms ease               | 0.0137          | ease-out-strong 0.0189 |                                                                   |
| menu              | Menu settles 4 dp away from its trigger (d2)                                                           | **fail** | 166.5 ms  | 200 ms ease               | 0.0149          | ease-out-strong 0.014  | duration 166.5 ms, token 200 ms                                   |
| row-fold          | A row that leaves folds its height (d2)                                                                | pass     | 199.5 ms  | 200 ms ease               | 0.0019          | ease-out-strong 0.0072 |                                                                   |
| row-close-gap     | Rows below close the gap (d2)                                                                          | pass     | 203.0 ms  | 200 ms ease               | 0.0022          | ease-out-strong 0.0083 |                                                                   |
| reorder-lift      | Lifting a row: 1 → 1.02 (d1)                                                                           | **fail** | 72.0 ms   | 120 ms ease               | 0.0137          | ease-drawer 0.0109     | duration 72.0 ms, token 120 ms                                    |
| reorder-neighbour | The neighbour slides up one slot (d2, ease-in-out-strong)                                              | pass     | 199.0 ms  | 200 ms ease-in-out-strong | 0.0016          | linear 0.0389          |                                                                   |
| title-collapse    | After 40 dp of scroll the bar title fades in (d2)                                                      | pass     | 188.5 ms  | 200 ms ease               | 0.0032          | ease-out-strong 0.0042 |                                                                   |
| page-hero         | Page band → full-screen preview (shared element, d3 ease-drawer)                                       | pass     | 317.0 ms  | 320 ms ease-drawer        | 0.0008          | ease 0.0161            |                                                                   |

### Every run on the fixed code

Build A has the Menu and motion-lab fixes. Build B adds the reorder lift change. "full" means all 18 labs back to
back; "solo" means one lab, opened still just before it was recorded. A dash means not recorded in that run. r1's
reorder recording caught the first-link system prompt after the fresh install ("no motion").

| Probe             | Token                     | A full `ios3`  | A solo `q1`    | A solo `q2`    | A solo `q3`    | A full `ios4`  | B solo `r1`    | B solo `r2`    | B full `ios5`  |
| ----------------- | ------------------------- | -------------- | -------------- | -------------- | -------------- | -------------- | -------------- | -------------- | -------------- |
| press-in          | 120 ms ease               | **fail** 179.5 | **fail** 182.0 | **fail** 180.0 | **fail** 194.5 | **fail** 178.0 | pass 115.0     | **fail** 168.0 | **fail** 167.5 |
| press-out         | 84 ms ease                | pass 89.1      | pass 87.1      | pass 88.1      | pass 80.6      | pass 79.1      | pass 88.1      | pass 90.6      | pass 87.6      |
| push-covered      | 320 ms ease               | pass 318.5     | –              | –              | –              | pass 318.5     | –              | –              | pass 318.5     |
| push-new          | 320 ms ease               | pass 316.0     | –              | –              | –              | pass 316.0     | –              | –              | pass 316.0     |
| pop-covered       | 224 ms ease               | pass 216.6     | –              | –              | –              | pass 241.1     | –              | –              | pass 241.1     |
| modal             | 320 ms ease               | **fail** 274.5 | **fail** 259.0 | pass 316.0     | pass 316.0     | pass 316.0     | –              | –              | pass 316.0     |
| sheet-rise        | 320 ms ease               | pass 309.0     | pass 320.5     | pass 319.0     | pass 319.5     | pass 319.5     | –              | –              | **fail** 286.5 |
| sheet-scrim       | 200 ms ease               | **fail** 233.0 | pass 189.0     | pass 188.5     | pass 191.0     | pass 189.0     | –              | –              | **fail** 154.0 |
| sheet-close-scrim | 140 ms ease               | pass 131.5     | –              | –              | –              | pass 132.5     | –              | –              | pass 131.5     |
| sheet-release     | 192 ms ease-drawer        | pass 191.8     | –              | –              | –              | pass 191.8     | –              | –              | pass 191.8     |
| tab-out           | 140 ms ease               | pass 132.5     | –              | –              | –              | pass 133.0     | –              | –              | pass 137.0     |
| tab-in            | 200 ms ease               | pass 189.0     | –              | –              | –              | pass 189.0     | –              | –              | pass 189.0     |
| tab-in-rise       | 200 ms ease               | pass 185.0     | –              | –              | –              | pass 185.0     | –              | –              | pass 185.0     |
| segment           | 200 ms ease-in-out-strong | pass 205.0     | –              | –              | –              | pass 205.5     | –              | –              | pass 205.0     |
| switch            | 120 ms ease               | pass 121.0     | –              | –              | –              | **fail** 86.0  | –              | –              | pass 119.0     |
| toast-rise        | 320 ms ease               | pass 321.0     | –              | –              | –              | pass 340.5     | –              | –              | **fail** 310.0 |
| toast-fade        | 320 ms ease               | pass 300.0     | –              | –              | –              | pass 313.0     | –              | –              | pass 332.5     |
| toast-fuse        | 1500 ms linear            | pass 1482.5    | –              | –              | –              | pass 1483.5    | –              | –              | pass 1483.5    |
| dialog            | 200 ms ease               | **fail** 131.0 | **fail** 136.0 | pass 183.5     | pass 183.0     | **fail** 104.5 | pass 192.0     | **fail** 161.0 | pass 191.5     |
| menu              | 200 ms ease               | **fail** 154.5 | **fail** 167.0 | **fail** 178.0 | **fail** 182.0 | **fail** 180.5 | **fail** 167.0 | **fail** 113.0 | **fail** 166.5 |
| row-fold          | 200 ms ease               | pass 200.0     | –              | –              | –              | pass 199.5     | –              | –              | pass 199.5     |
| row-close-gap     | 200 ms ease               | pass 200.5     | –              | –              | –              | pass 200.0     | –              | –              | pass 203.0     |
| reorder-lift      | 120 ms ease               | **fail** 77.5  | **fail** 80.5  | **fail** 77.5  | **fail** 77.5  | **fail** 46.5  | –              | **fail** 62.5  | **fail** 72.0  |
| reorder-neighbour | 200 ms ease-in-out-strong | pass 199.0     | pass 199.0     | pass 199.0     | pass 199.0     | pass 199.0     | –              | pass 199.0     | pass 199.0     |
| title-collapse    | 200 ms ease               | pass 193.5     | –              | –              | –              | **fail** 152.0 | –              | –              | pass 188.5     |
| page-hero         | 320 ms ease-drawer        | pass 317.5     | –              | –              | –              | pass 319.5     | –              | –              | pass 317.0     |

### What the failures are

- **press-in (measured 168–195 ms, token 120)** fails in 8 of 9 runs and passed once solo (115 ms). The button's
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
