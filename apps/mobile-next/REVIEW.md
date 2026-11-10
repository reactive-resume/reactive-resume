# Visual review: Pass 5, iOS

Reviewer: independent (wrote none of the UI). Sources: board `screens/<ID>-<theme>.png` against the Release iOS captures,
both at 390 × 844 pt. Fixed findings have been deleted; what is left is below. Coordinates are points from the top-left
of the screen.

## Pending: fixed on another agent's unmerged branch

- **B1-Overview, B6-Design and B11-Share** · dock, Check tab icon, x 241–260, y 757–770 · Board: amber notification
  dot at the icon's top right. App: no dot. · **should-fix**. Cause: only the B9 scenario puts the findings the boards
  assume (website "morgan.design", 1.1 line height) into the draft, so the other builder scenarios have no open
  findings. B11 has the same cause as B1 and B6, so it waits for that branch. The other half of this rule is fixed: the
  dot no longer shows on the selected Check tab (B9).
- **B17-Proposals** · inline diff in the first proposal, y 278–300 · Board: the struck-through old text, a gap of about
  6 pt, then the inserted words in a padded green chip. App: the insert chip touches the struck text with no gap, and
  its highlight box is taller and sits about 1 pt lower than the text line. · **should-fix**

## Needs the owner's decision

- **B7-Template** · colour swatches, y 612–704 · The fills differ from the board. Board compared with app, RGB: Forest
  (63,122,78) / (62,107,79); Teal (31,122,120) / (31,110,115); Plum (107,63,122) / (107,62,110); Rust (164,81,46) /
  (160,68,42); Wine (125,42,57) / (138,44,63); Ochre (154,107,22) / (122,90,18); Graphite (74,74,74) / (59,63,69). Ink
  blue matches. The code follows the web app's accent palette on purpose. · **should-fix** if the board wins.
- **B3-Entry** · below the Description card, x 24–120, y 717–737 · Board: empty space between the card and the footer
  actions. App: a "More fields" row with a caret-down icon. SCREENS.md puts rare fields under "More fields" at the end;
  the board does not draw the row. · **should-fix** if the board wins.

## Open: needs a native change

- **A2-SignIn** · password dots, x 36–130, y 302 · Board: ten small bullets about 3 pt wide (the browser's mask). App:
  UIKit's secure-entry mask, larger and wider spaced. The mask is drawn by `UITextField` itself; matching the board
  would mean drawing the password ourselves and losing the system secure field (screen-capture masking, password
  AutoFill). · **should-fix** as filed; recommended to accept the platform mask.
- **J5-SaveJob** · posting link field · Board: the URL is clipped mid-glyph at the field's right padding. App: an
  unfocused `UITextField` stops at the last whole break opportunity ("senior-"). React Native exposes no line-break mode
  for a text input. The value's baseline is fixed. · **nit**
- **X1-Notify** · top, y 0–40 · Board: no status bar over the caption. App: the status bar draws over it. Hiding it
  needs `UIViewControllerBasedStatusBarAppearance` set to NO in the iOS config (`expo-status-bar` has no effect with
  view-controller-based appearance), which changes status-bar handling for every screen. · **should-fix**
- **Kit** · AI composer · Board: the send button in full accent while the "Knowledge couldn't load" status line shows.
  App: the send button at 45% while sending is blocked (COMPONENTS.md §13: the line appears "while sending is
  blocked"). The Kit draws the same Composer as B16 and C2; decide which state the Kit sample should show. · **nit**
