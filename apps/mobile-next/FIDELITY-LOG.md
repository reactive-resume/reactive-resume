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
