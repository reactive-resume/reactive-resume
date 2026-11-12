---
version: 7.0.0
name: Reactive Resume · Calm
description: A quiet desk around a bright page, drawn with soft corners, flat lists, serif titles and one obvious next step per view. Moss green marks the one primary action, selection and progress. Light and dark themes keep document paper white.
colors:
  light:
    bg: "#F8F7F3"
    surface: "#FEFDFC"
    raised: "#FFFFFF"
    sunken: "#F0EFEB"
    line: "#DFDEDA"
    line-2: "#C5C4BE"
    control-border: "#888680"
    ink: "#1C1B15"
    ink-2: "#4F4D47"
    ink-3: "#6D6C65"
    accent: "#337344"
    accent-hover: "#206133"
    on-accent: "#F7FEF8"
    accent-soft: "#DCF2DF"
    accent-text: "#195C2E"
    danger: "#BA3630"
    danger-fill: "#BA3630"
    danger-soft: "#FFE7E4"
    danger-text: "#A92321"
    warn: "#D29922"
    warn-mark: "#B37A1A"
    warn-soft: "#FCEDCD"
    warn-text: "#81520A"
    warn-ink: "#22190A"
    info-soft: "#E0F1FF"
    info-text: "#1D5B92"
  dark:
    bg: "#100F0C"
    surface: "#171613"
    raised: "#1F1E1A"
    sunken: "#0B0A08"
    line: "#2C2B27"
    line-2: "#494843"
    control-border: "#73726C"
    ink: "#EFEEEB"
    ink-2: "#BCBAB5"
    ink-3: "#979590"
    accent: "#6FC082"
    accent-hover: "#83D494"
    on-accent: "#07150A"
    accent-soft: "#1A3520"
    accent-text: "#8FD89E"
    danger: "#D9544B"
    danger-fill: "#C23F38"
    danger-soft: "#47211D"
    danger-text: "#FDA297"
    warn: "#E4B750"
    warn-mark: "#E4B750"
    warn-soft: "#3E2D10"
    warn-text: "#EFCC83"
    warn-ink: "#22190A"
    info-soft: "#192F46"
    info-text: "#9DC9F7"
  paper: "#FFFFFF"
  stages:
    saved: "#908C7F"
    applied: "#5590CC"
    screening: "#00A0A6"
    interview: "#AF8433"
    offer: "#579F68"
    closed: "#C67067"
typography:
  display: { fontFamily: Instrument Serif, fontSize: 44px, lineHeight: 48px, fontWeight: 400, letterSpacing: -0.01em }
  big-number: { fontFamily: Instrument Serif, fontSize: 40px, lineHeight: 44px, fontWeight: 400 }
  root-title:
    { fontFamily: Instrument Serif, fontSize: 34px, lineHeight: 40px, fontWeight: 400, letterSpacing: -0.005em }
  page-title: { fontFamily: Instrument Serif, fontSize: 28px, lineHeight: 34px, fontWeight: 400 }
  section-title: { fontFamily: Instrument Serif, fontSize: 22px, lineHeight: 28px, fontWeight: 400 }
  heading: { fontFamily: Figtree, fontSize: 20px, lineHeight: 28px, fontWeight: 600 }
  section-heading: { fontFamily: Figtree, fontSize: 17px, lineHeight: 24px, fontWeight: 600 }
  label: { fontFamily: Figtree, fontSize: 15px, lineHeight: 22px, fontWeight: 600 }
  row-title: { fontFamily: Figtree, fontSize: 15px, lineHeight: 22px, fontWeight: 500 }
  body: { fontFamily: Figtree, fontSize: 15px, lineHeight: 24px, fontWeight: 400 }
  ui: { fontFamily: Figtree, fontSize: 14px, lineHeight: 20px, fontWeight: 400 }
  small: { fontFamily: Figtree, fontSize: 13px, lineHeight: 18px, fontWeight: 400 }
  field-label: { fontFamily: Figtree, fontSize: 13px, lineHeight: 18px, fontWeight: 500 }
  caption: { fontFamily: Figtree, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
  eyebrow: { fontFamily: Figtree, fontSize: 12px, lineHeight: 16px, fontWeight: 600 }
  mono: { fontFamily: Geist Mono, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
rounded:
  xs: 6px
  sm: 8px
  md: 10px
  lg: 12px
  xl: 16px
  2xl: 20px
  3xl: 20px
  4xl: 20px
  paper: 2px
  full: 999px
spacing: [4, 8, 12, 16, 20, 24, 32, 40, 48, 64]
layout:
  app-sidebar: 248px
  content-max: 1040px
  row: 56px
  editor-bar: 56px
  editor-panel: 400px
  sheet: 440px
  sheet-detail: 480px
  dialog: 480px
motion:
  quick: 120ms
  standard: 200ms
  emphasized: 320ms
  easing: cubic-bezier(0.2, 0.8, 0.2, 1)
  exit: 70% of the entering duration
  movement-easing: cubic-bezier(0.77, 0, 0.175, 1)
marketing:
  typography:
    display: { fontFamily: Instrument Serif, fontWeight: 400 }
    write-title: { fontFamily: Instrument Serif, fontSize: "clamp(72px, 9vw, 160px)", lineHeight: 0.9, fontWeight: 300 }
    numeral:
      {
        fontFamily: Instrument Serif,
        fontSize: "clamp(56px, 7.5vw, 136px)",
        fontWeight: 300,
        fontVariantNumeric: tabular-nums,
      }
    body: { fontFamily: Instrument Serif, fontSize: "16–21px", lineHeight: "1.45–1.5", fontWeight: 400 }
    accent: { fontFamily: Instrument Serif, fontStyle: italic, color: accent-text }
    label: { fontFamily: Figtree, fontSize: 13px, fontWeight: 500 }
  colors:
    graphite: { light: "oklch(0.38 0.01 95 / .3)", dark: "oklch(0.9 0.01 95 / .18)" }
    night-1: "oklch(0.24 0.03 265)"
    night-2: "oklch(0.15 0.02 265)"
    night-accent: "oklch(0.8 0.13 150)"
    star: "oklch(0.72 0.14 80)"
    receipt: "#FDFCF8"
    bulb-glass: "oklch(0.95 0.11 92)"
    bulb-filament: "oklch(0.7 0.16 60)"
  shadow:
    paper:
      light: "0 1px 2px oklch(0.2 0.01 95 / 0.12), 0 40px 80px -30px oklch(0.2 0.01 95 / 0.5), 0 0 0 1px oklch(0.2 0.01 95 / 0.04)"
      dark: "0 1px 2px oklch(0 0 0 / 0.5), 0 40px 80px -30px oklch(0 0 0 / 0.8)"
  motion:
    pull-easing: cubic-bezier(0.3, 1.7, 0.5, 1)
  doodles: { opacity: { light: 0.92, dark: 0.8 }, darkFilter: "brightness(0.92)" }
---

## Overview

Reactive Resume uses “Calm”: a quiet desk around a bright page, drawn with soft corners, flat lists and one obvious next step per view. It keeps the colours, type families, shadows, motion and voice of Desk & Paper (version 6) and replaces its shape, spacing, hierarchy and layout rules.

This reference covers the app, its AI features and the homepage. The homepage keeps the Desk & Paper corners (see Marketing site). Implementation details live in the source files named below.

Nine principles guide decisions:

1. **One obvious next step.** One `accent` button per view. Root pages lead with a hero card when one thing matters most.
2. **Serif carries hierarchy.** Instrument Serif titles order the page, so sections need no boxes and no eyebrow labels.
3. **Flat lists, not boxes.** Content is rows on the page, split by hairlines: a title, one quiet line, one thing at the end.
4. **Room to breathe.** 40px page margins, 56px rows, 32px above each section title.
5. **The page is the interface.** The document stays visible and full size while you edit; panels take turns beside it and never cover it.
6. **Nothing is lost.** Edits save as you type. Reversible actions happen at once with Undo; only permanent deletes ask.
7. **Words over colour.** A stage is a dot plus its name; a status is a badge with a word.
8. **AI proposes, you decide.** AI edits arrive as numbered proposals. A screen without AI shows what works without it and one “Set up AI” action.
9. **Reachable by everyone.** Every control works by keyboard, shows its focus, and every drag has a menu alternative.

Resume templates retain their Pokémon names, fonts, and palettes. App typography and control styling do not dictate template appearance.

## Content

- Sentence case everywhere. No all caps, no emoji, no exclamation marks.
- Plain and specific: say what happened, then what to do next (“Couldn't export the PDF. Your changes are saved. Try again.”).
- Second person. The product never says “we”; only the assistant and coach say “I” in their own replies.
- Fixed vocabulary: Save a job · Move to Trash (reversible) · Delete permanently · Open · Write, Design, Check, Share · Set up AI. `GLOSSARY.md` wins where it disagrees.

## Tokens

`packages/ui/src/styles/globals.css` defines light tokens on `:root` and dark overrides on `.dark`. OKLCH values are authoritative; the front matter lists approximate sRGB equivalents. Tailwind exposes semantic utilities such as `bg-bg`, `bg-surface`, `border-line`, `text-ink`, and `bg-accent`.

- **Surfaces:** `bg` for the app desk; `surface` for panels and cards; `raised` for menus, dialogs, and inputs; `sunken` for wells, tracks, and the page canvas.
- **Borders:** `line` for dividers and every element's default border; `line-2` for decorative rules and quiet outlines (secondary buttons, outline badges, dashed empty states, chips); `control-border` for the edges people must find: inputs, checkboxes, radios, code boxes, the chat composer, and the off switch and slider tracks. `control-border` holds 3:1 on every surface in both themes; `line-2` does not, so it is never a control's only edge.
- **Text:** `ink` for primary text, `ink-2` for secondary text, and `ink-3` for metadata and placeholders. Use no lighter text token, and check contrast on tinted backgrounds.
- **Signals:** `danger` for errors and irreversible actions; `danger-fill` fills the permanent-delete button; `warn-mark` is for warning marks that must hold 3:1 on `bg`; `warn` for issues to review; `warn-ink` for text on a solid `warn` fill, such as issue-marker numbers; `info-soft` and `info-text` for neutral guidance. Success uses `accent-soft` and `accent-text`.
- **Overlays:** `hover` and `press` are translucent interaction states; `scrim` and `scrim-sheet` dim the background behind layers.
- **Paper:** `--paper` remains white in both themes. Switching the app theme must not invert documents.
- **Accent is scarce:** `accent` fills the one primary button of a view, checked controls and the focus ring. Selection uses `accent-soft` with `accent-text`, never the fill. On `accent-soft`, move `ink-3` up to `ink-2`.
- **Stages:** `stage-saved`, `stage-applied`, `stage-screening`, `stage-interview`, `stage-offer`, and `stage-closed` identify application stages. They appear only as a dot (or the stepper's bar) beside the stage name.

Use semantic tokens in app code. Legacy names such as `background`, `foreground`, `primary`, `muted`, and `sidebar-*` are no longer defined.

## Typography

The front matter records the app type scale. Each style is one utility in `globals.css`: `t-display`, `t-big-number`, `t-root-title`, `t-page-title`, `t-section-title`, `t-heading`, `t-section-heading`, `t-label`, `t-row-title`, `t-body`, `t-ui`, `t-small`, `t-caption`, `t-eyebrow`, `t-mono`.

- **Instrument Serif** carries the hierarchy: `root-title` (34) on the five top-level pages (Today, Documents, Applications, Career, Settings), `page-title` (28) on a page reached from a list, `section-title` (22) for sections, dialog and sheet titles and empty states, `big-number` and `display` for statistics. It has one weight (400 and italic): never set it semibold or bold, which the browser would fake.
- **Figtree:** everything functional. `ui` (14/20) by default, `body` (15/24) for reading, `row-title` and `label` (15) in rows and bars, `heading` (20) in the hero, `section-heading` (17) inside panels, `small` (13) for second lines, `caption` (12) for badges.
- **Geist Mono:** shortcuts, URLs, slugs, filenames and counts. Use `font-mono`.
- No all-caps labels or title caps. No eyebrow labels on pages: `eyebrow` survives only as a group label inside menus and the command palette.
- Field labels are 13px, medium weight, in `ink-2`, with a 6px gap above the 40px control.
- Rendered rich text (assistant and coach replies, the rich-text editor) uses shadcn Typeset: `packages/ui/src/styles/typeset.css`, an owned copy reading the app tokens. Wrap content in `typeset` plus a preset: `typeset-chat` or `typeset-field`. It styles only the elements those surfaces render (no images, `kbd`, `details`, definition lists or math). Opt a component out with `not-typeset`. Always add a preset: both set headings in Figtree, while the bare class would set them in Instrument Serif at 600, a weight the browser fakes. In both presets each block keeps the direction of its first letter.
- Touch inputs use at least 16px text to prevent iOS zoom.
- Fonts are self-hosted through `@fontsource-variable/figtree`, `@fontsource/instrument-serif` and `@fontsource-variable/geist-mono`.

## Iconography

App icons use **Phosphor** (regular weight) through `Icon` from `@reactive-resume/ui/components/icon`. `Icon` takes the glyph's Phosphor name (`x`, `gear-six`, `magnifying-glass`), the same names the [Phosphor catalog](https://phosphoricons.com) and resume icons use. To use another glyph, add it to the `icons` map in that file.

Use 20px icons on desktop and 24px on touch interfaces. Regular weight is the default; the filled weight appears only on the selected navigation item. `sparkle` marks AI and nothing else. Marketing illustrations may use filled icons, such as the GitHub star.

Pair icons with text. Back, close, more, undo/redo, history, assistant, and zoom controls may use `IconButton`, which requires an accessible label and supplies a tooltip with an optional shortcut. `Icon` is decorative (`aria-hidden`) and sized by its font size, so containers can resize it with `text-*`. Directional arrows, chevrons, undo, and redo mirror in RTL layouts.

Icons inside resumes use Phosphor names stored in resume data, drawn by the Phosphor web font; they remain separate from app icons.

## Space, shape, and elevation

- **Spacing:** the 4px scale in the front matter. 40px page margins (32px at 640–1023, 16px below 640), 32px above a section title, 48px between a page's main column and its aside.
- **Radius:** `rounded-xs` 6 badges, checkboxes and keys · `rounded-sm` 8 chips, small buttons, menu items and avatars · `rounded-md` 10 buttons, inputs, icon buttons and sidebar items · `rounded-lg` 12 large buttons, segmented controls, menus, toasts, callouts and board cards · `rounded-xl` 16 cards, the hero and the composer · `rounded-2xl` 20 dialogs, sheets and the command palette · `rounded-full` switches, radios and dots. **Paper stays square:** document pages and thumbnails use `rounded-paper` (2px).
- **A card is allowed in three places:** the hero, dialogs and sheets, and board cards. Everything else is rows.
- **Elevation:** `shadow-e1` for cards and the selected segment; `shadow-e2` for menus and popovers; `shadow-e3` for dialogs, sheets, and toasts; `shadow-page` for editor paper.
- **Controls:** button heights are 28px (`sm`), 36px (`default`), and 44px (`lg`). Icon buttons 36px (28px small). Inputs 40px, segmented 36px, tab strip 40px, menu item 36px, sidebar item 40px, list row at least 56px (`--row`), builder bar 56px. Inputs and default buttons grow to 44px on touch devices (a button that sets its own height keeps it; a control beside an input matches it); `touch-target` expands smaller controls' hit areas to at least 44×44px and needs a positioned host (`relative`), or its overlay covers the nearest positioned ancestor and steals taps. Keyboard-shortcut help entries hide on touch screens.
- **Layout variables:** `--app-sidebar: 248px`, `--content-max: 1040px`, `--row: 56px`, `--editor-bar: 56px`, `--editor-panel: 400px`, `--sheet: 440px`, `--sheet-detail: 480px`, `--dialog: 480px`, and `--assistant: 400px`.

## Layout

- **Dashboard:** the sidebar (248) plus a page with 40px margins. Reading content stops at `--content-max` (1040); tables and boards may run wider. The sidebar holds Search (⌘K), Today, Documents, Applications, Career, then Trash, Shortcuts (?) and the account row, which opens Settings. Each page owns its one primary action; there is no global New button.
- **Builder:** the bar (56) on top, one panel (400) at the side, the canvas on `sunken` with the paper centred. One panel at a time: choosing a section replaces the outline, an entry replaces the section; the assistant and version history take the panel's place, so the page never shrinks.
- **Design settings** live in seven named categories: Template, Layout, Entries, Typography, Colour, Page and Custom CSS. There is no “Advanced” bucket. Fonts are one searchable combobox, flat and A to Z.
- **Section rail:** 200px navigation inside a page (Settings, an application's workspace), with a neutral selection (`hover` ground, `ink`), never green.
- **Sheets** float 8px inside the window from the inline end; dialogs centre over `scrim` at 480px (560px with two fields to a row).
- **Widths:** four ranges, one rule each.

|                  | Under 640                                                                                            | 640 to 1023                                                                                  | 1024 to 1279                                  | 1280 and up                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| Navigation       | Tab bar, 64 tall: Today, Documents, Applications, Career. Search and the account in each page header | Rail, 64 wide: the same places as icons with tooltips, then Trash, Shortcuts and the account | Sidebar, 248                                  | Sidebar, 248                                                |
| Page             | 16 margins, one column                                                                               | 32 margins, one column                                                                       | 40 margins; the aside follows the main column | 40 margins, 1040 reading width, main column and a 360 aside |
| Lists and tables | Rows of 64; a table becomes rows                                                                     | The table keeps its three main columns                                                       | The whole table                               | The whole table                                             |
| Documents        | Rows with a thumbnail                                                                                | Grid, three to a row                                                                         | Grid, three to a row                          | Grid, four to a row                                         |
| Builder          | The bar, then one view at a time; modes in a bottom bar                                              | A 380 panel beside the page                                                                  | The 400 panel; Assistant is an icon           | The 400 panel; every label shows                            |
| Dialogs          | Bottom sheet, full width                                                                             | Centred, 480 or 560                                                                          | The same                                      | The same                                                    |
| Side sheets      | Bottom sheet                                                                                         | From the inline end, 440 (Details 480)                                                       | The same                                      | The same                                                    |
| Command palette  | Full screen                                                                                          | 600 wide, centred                                                                            | The same                                      | The same                                                    |

## States and confirmation

- **Empty** places say what they are for and offer one action; inside a list, one quiet line.
- **Loading** placeholders keep their final size and stay still.
- **Reversible** changes happen at once and offer Undo in a toast.
- **Permanent** deletes ask in an `AlertDialog` that names what is destroyed and what the other button keeps. The button that deletes is a plain `danger-fill` button.
- **One Trash** holds documents and applications under one rule: each stays 30 days, then is deleted permanently.
- **Errors** say what failed and what was kept, next to where it happened.
- **AI missing:** one “Set up AI” line as the first row under the title of the page, panel or tab. It says what needs AI and what works without it, and ends in one secondary “Set up AI” button that opens one dialog. AI-only buttons are left out, not greyed.

## Motion

| Token                 | Duration | Use                                                    |
| --------------------- | -------- | ------------------------------------------------------ |
| `duration-quick`      | 120ms    | Hover, press, toggles, checkboxes, and focus           |
| `duration-standard`   | 200ms    | Menus, popovers, expansion, content swaps, and dialogs |
| `duration-emphasized` | 320ms    | Sheets, toasts, and the assistant column               |

- Entering and changing state use `ease-enter` (`cubic-bezier(0.2, 0.8, 0.2, 1)`). Exits take 70% of the entry duration.
- Sliding indicators, reordering, and settling use `ease-in-out-strong` (`cubic-bezier(0.77, 0, 0.175, 1)`). Swipe-dismissed bottom sheets use `ease-drawer`.
- Keep app motion brief and purposeful. Small entrance fades, status transitions, and the mobile tab indicator's spring are supported. Loading placeholders stay still; document reflow is never animated. Keyboard mode switches are instant.
- Reduced motion removes spatial movement, stagger and decorative animation. Known layer/content state changes retain a short 120ms opacity fade; page snapshot transitions and explicit instant controls stay instant, and status spinners continue turning. Native custom fades follow the same policy; native system sheets keep their platform accessibility behavior.
- A pathname change fades through: the old page fades out over 140ms, then the new one fades up 6px over 200ms, so the two never show at once. The builder's own pending shell (its bar, panel placeholders and a blank page at the canvas's size) stands in while a resume loads; the logo loader covers only the app's first load.
- Dragging auto-scrolls a list only from its outer 8%, gently (`DRAG_AUTO_SCROLL`).
- `apps/web/src/libs/motion.ts` mirrors CSS timings. `MotionConfig reducedMotion="user"` removes transform/layout animations while preserving opacity. CSS keeps unknown effects instant and allows opacity alone on known layer/content transitions.

The homepage has separate motion rules below.

## Components

Generic primitives live in `packages/ui/src/components`, using Base UI and cmdk for the command palette. Shared Calm layout parts (Page, ListRow, SectionHeading, HeroCard, StageDot, StageStepper, SectionRail, Crumb, FilterBar, DataTable, SelectionBar, SetUpAiLine, DocumentThumb, CategoryStrip) live in `apps/web/src/components/calm`. Feature-specific UI belongs in its owning `apps/web` feature. The development-only `/kit` route lays every one of them out in both themes.

- **Rows:** `ListRow` is the unit of every list: at least 56px, a `line` hairline below, a title, one quiet line, one thing at the end. Row actions that appear on hover also appear on focus and in the row's menu.
- **Section headings:** `SectionHeading` is a 22px serif title with 32px above it and at most one text action.
- **Hero:** `HeroCard` holds the single most important next step on a page, with the view's one accent button.

- **Buttons:** `primary`, `secondary`, `ghost`, `danger`, and `link`. `loading` adds a spinner, sets `aria-busy`, and blocks activation. Use a progress label such as “Preparing…”. A button rendered as a link (`nativeButton={false}` with an `<a href>` or router `Link`) keeps `role="link"`, so screen readers list it with links.
- **Loading:** `Spinner` is a 14px `circle-notch` turning once a second in the text color. Pair it with words that say what is happening; mark it `decorative` when the control already says it is busy.
- **Inputs:** `raised` background and `control-border` border; focus adds an accent border and a 3px `accent-soft` ring. Invalid fields use danger styling. Show errors after blur or submission, with an icon and a specific remedy.
- **Switches:** prefer `SwitchRow` so the label is part of the target. The off track is `control-border`, the on track `accent`. Checkboxes are 18px with a 6px radius and a 1.5px `control-border` edge; radios are 18px with an 8px accent dot.
- **Codes:** `OTPField` boxes are 36px, 44px on phones; pass a translated `digitLabel` (“Digit 2 of 6”) so each box has a name.
- **Shortcuts:** write shortcuts with Mac glyphs (“⌘K”, “⇧⌘Z”). `Kbd` always reads left to right; `formatShortcut` shows them as “Ctrl+K” and “Ctrl+Shift+Z” off Apple devices (`IconButton` tooltips already do), and `ariaShortcut` gives the matching `aria-keyshortcuts` value.
- **Segments and tabs:** use `SegmentedControl` for 2–4 options in a radio group. Use `Tabs` to switch panels; set `TabsList variant="line"` for underline tabs.
- **Menus:** 12px radius and 36px items with 8px corners; past six items, groups get small labels. Size popups for their content and trigger; put destructive items last, after a separator.
- **Layers:** menus and popovers provide lightweight choices; sheets hold tasks beside the document and use the bottom variant on mobile; dialogs hold decisions. Use `AlertDialog` for destructive confirmation and name what cancel keeps. Dialog and sheet close buttons need a translated `closeLabel` whenever they show. `right` and `left` sheets open from the inline end and start, so they swap sides in RTL.
- **Creating things:** a short create form (up to about six fields, such as New document or Save a job) is a dialog. New document uses a bottom sheet on phones, matching the native creation form; its presentation stays fixed while open so a resize cannot discard work. A long form, or one that needs the page behind it, is a sheet (New schedule, Add offer on Offers). A form tied to one item already on screen opens in place beside it (Add fact, Add offer in a job's Offer stage).
- **Toasts:** one visible at a time, bottom center, with `bg-ink` and `text-bg`. The default timeout is six seconds; `timeout: 0` keeps a toast visible. Undo is an optional underlined action. Pressing an action closes its toast after the action's handler runs, and a second press while it leaves does nothing. A toast with an action burns a 2px fuse along its bottom edge for the time it has left; the fuse pauses while the toast is hovered or focused and is hidden under reduced motion. Pass translated `closeLabel` and `regionLabel` to `Toaster`; a view with floating bottom controls lifts toasts above them with `--toast-bottom`.
- **Chats:** the assistant and career coach transcripts use `MessageScroller` (shadcn, behaviour from `@shadcn/react`): it follows a streaming reply only while the reader is at the latest message, settles each question near the top, reopens a saved thread on its last question, and shows a “Latest” button after scrolling away. Agent steps are `Trace` lines: spinner and shimmer while running, check when done, danger when failed, dimmed dash when unfinished. Mobile mirrors both.
- **Alerts:** `info`, `success`, `warn`, and `error`; only the error variant adds `role="alert"` by default.
- **Empty states:** use `EmptyState`: a dashed `line-2` card with a 22px Instrument Serif headline, concise 14px body text (at most 340px wide) and one primary action; add a `secondary` action only when useful. Notices go in its children, above the actions. Inside a list, `variant="compact"` is a single 13px row instead of the card.

## AI features

AI is optional and runs on a provider the person connects. Every AI surface follows “AI proposes, you decide”: say what will be sent and where, show progress, return proposals to review, and keep the person's words when something fails. Shared parts live in `apps/web/src/features/assistant/chat-chrome.tsx` and `apps/web/src/features/career/shared.tsx`.

- **Mark:** `sparkle` is the AI glyph: 20px in `accent-text` beside the Assistant and Coach titles, and 16–18px before the label of a button that starts AI work (the button's spinner replaces it while the work runs). Don't use it for anything that makes no AI request.
- **Disclosure:** no standing disclaimers. Context chips show what goes and the connection menu shows where. `PrivacyLine` (12px `ink-3` with a 15px `lock`) appears only when a send is blocked or waits: a conversation whose connection was switched off, or Knowledge still loading or failed. The `cost` variant is a `warn-soft` callout with a `key` icon for billing reminders, and the connection-changed notice stays. Nothing leaves before the person presses send or approves.
- **Approvals:** a request the model makes on its own, such as a web search query or saving a story to Knowledge, waits in a `raised` card with a `line` border that shows the exact text and explicit verbs: “Search the web”, “Save story”, “Edit first”, “Skip” (`apps/web/src/features/assistant/tool-approvals.tsx`).
- **Composer:** `ChatComposer` is a `raised` box with a `control-border` edge and the input focus treatment. Enter sends, Shift+Enter adds a line, and Escape stops a reply; the send button becomes a filled stop button while a reply streams. Context chips are 26px: included context is `sunken` with an icon and a remove button; context left out stays as a dashed `line-2` outline in `ink-3`, and selecting it includes it again. A 12px `ink-3` line under the box appears only when sending is blocked. The connection menu in the header reads “Name · model” on a 28px `sunken` chip.
- **Starting points:** an empty conversation opens with a 22px Instrument Serif question, a 14px `ink-2` line and starter rows: 44px, `raised`, `line` border, a 20px `ink-2` icon, a 14px medium label and a 12px `ink-3` hint (“Suggests cuts, never deletes on its own”).
- **Progress:** agent steps are `Trace` lines. A 10–30 second task shows `Working`: its label moves through the task's steps every 2.2 seconds (“Reading the posting”, “Matching your facts”) and then rests on “Still working”, and the button keeps the width of its longest phrase. Stop stays available while work runs.
- **Questions:** when the assistant needs something the document doesn't say, it asks on an `info-soft` card in `info-text` (`apps/web/src/features/assistant/question-card.tsx`): the question in 14px medium, choices as small secondary buttons and an “Or in your own words…” field. Answered, passed-over and failed questions say so in 13px.
- **Proposed edits:** edits arrive as a numbered list to review (`apps/web/src/features/resume/editor/proposals/proposal-list.tsx`). The header sits on `bg` with the count, Reject all and Accept all; each edit is numbered on a 20px `accent` square; only the changed words are marked, removed words struck through in `ink-2` and added words on `accent-soft`; the reason follows in 12px `ink-2`. Tailoring adds “Posting asks for:”, the sources the model cites (“check they say this”), and a `warn-soft` box, “Nothing checked backs these. Confirm each before accepting:”, for figures and words the resume doesn't contain. An edit that adds a detail carries a `warn-soft` “New detail: check it's true” tag and is accepted on its own. Each edit offers Accept, Edit (rewrite the wording first) and Reject; A and R act on the focused edit, ↑ and ↓ move between edits. A decided edit folds to one line (“Applied” or “Rejected”, with Undo and Show); an edit whose passage has changed says it is out of date and offers “Suggest again”.
- **Improve:** on the line holding the caret, Improve offers presets (Stronger verb, Add a result, Make it shorter) and a free request. The original sits on `sunken` and the suggestion on `accent-soft`, with Replace, Keep mine and Try another.
- **Evidence:** status pills pair color, icon and words: Supported and Added by you on `accent-soft`, Partly supported on `warn-soft`, No evidence yet on `sunken`. A gap is missing evidence, never missing ability; the assistant leaves it open rather than invent experience.
- **Memory:** an offer to remember facts is an `info-soft` row with a `bookmark-simple` icon, the quoted fact (a checklist for several) and Remember / Not now.
- **What an answer used:** under a reply, “Used” chips (24px, `line-2` outline, 12px medium `ink-2`) open a popover listing the exact facts, stories or documents it relied on; web results list as “Sources” links in `accent-text`. A citation is a pointer to check, not proof.
- **Failures and stops:** a failed request is a `danger-soft` card with `role="alert"`: what failed, “Your message is kept.”, Retry (secondary) and, when the provider caused it, Switch model (ghost). A stopped reply says “Stopped. No edits were proposed.” with Continue. A conversation whose connection was switched off shows a `warn-soft` notice to choose the next one; a locked document shows an `info-soft` note that questions still work and edits wait for Unlock.
- **Usage:** a result that came from AI keeps a receipt in 12px `ink-3`: the request attempts, then the connection, provider and model (`apps/web/src/features/ai/usage.tsx`).
- **Voice:** the assistant and coach may say “I” in their own replies and notices; the app around them stays in the second person.

## Accessibility

Target WCAG 2.2 AA:

- Show a 2px accent focus outline with a 2px gap on `:focus-visible`, only while navigating by keyboard: after a tap or click `data-pointer` on `<html>` (`apps/web/src/libs/input-modality.ts`) hides rings on focus the app moves itself, and the first Tab, arrow or Escape brings them back. `focus-visible:` utilities follow the same rule. Inputs use their border and soft ring instead.
- On touch screens a long press on a document card or row selects it, as in the mobile app; selection checkboxes appear only once selecting starts, and the ⋯ menu keeps every action.
- Provide at least 24px pointer targets and 44px touch targets. Every drag operation needs keyboard and menu alternatives. Each `DndContext` takes `dndContextProps()` (`apps/web/src/libs/dnd.ts`): drags are announced in the UI language by the item's visible name and its page or column, never by an id.
- Pair color signals with text; add icons where they clarify status.
- Trap focus in modal sheets and dialogs. Escape closes the top layer; closing returns focus to its trigger.
- Announce save state and routine feedback politely. Reserve assertive announcements for errors that need immediate attention.

## Themes

The shared `theme` cookie stores `light`, `dark`, or `system` (the default). System mode follows `prefers-color-scheme` live. `ThemeProvider` manages the `.dark` class on `<html>`; an inline script in `apps/web/index.html` applies it before first paint. The homepage uses this same preference.

## Internationalization

- Translate user-facing text and accessible labels through Lingui (`t`, `msg`, or `<Trans>`). Catalogs live in `apps/web/locales`.
- UI primitives receive translated labels as props, such as `closeLabel`; they do not depend on Lingui.
- Supported locales come from `packages/utils/src/locale.ts`. The root route updates `<html lang>` and `<html dir>` and passes direction to Base UI's `DirectionProvider`.
- Prefer logical properties and utilities (`ps`, `pe`, `ms`, `me`, `start`, `end`, `inset-s`, `inset-e`).
- Allow 30–50% text expansion; avoid fixed widths for translated labels.
- What people type keeps its own direction: inputs, textareas and Typeset blocks use `unicode-bidi: plaintext`, so German stays left to right in the Arabic interface and Arabic right to left in an English one. Email, URL and phone inputs and `Kbd` always read left to right.

## Marketing site

The public homepage in `apps/web/src/features/homepage` shares app colors and themes but has its own typography, illustrations, and motion. `landing.css` defines its fonts, graphite color, paper shadows, and ambient animations. Other illustration colors in the front matter are scene values, not global app tokens.

### Brand and type

- **Header:** a 30px logomark from `apps/web/public/icon/{light,dark}.svg`. Keep “Reactive Resume” as visually hidden text inside the home link.
- **Footer:** a 140px logo from `apps/web/public/logo/{light,dark}.svg` above the hero's promise (its two highlighted phrases in `accent-text`), the link columns, then a line of community, MIT license and version copy.
- **Footer desk:** two drawings of the same writing desk in front of an open window, day (`apps/web/public/illustrations/footer-desk-light.webp`, moss and charcoal on white) and night (`footer-desk-dark.webp`, silver and amber on black). The light one multiplies and the dark one lightens into the page, so their white or black wall vanishes and the desk seems to stand on the footer; their far edges fade out. As the desk scrolls into view it paints itself in from the window down, just ahead of the fold, while it rises and settles from a 4% zoom; it completes exactly when the page ends (`--dp`, written by `scroll.ts`; 1 under reduced motion). In the light theme a soft morning glow rises behind the window with it. Its objects are links back into the story, each showing its scene number and name on hover or focus: the resume to Write, the glasses to Check, the letters to Share, the calendar to Prepare, the window to Remember. The lamp switches the theme, like the header's cord. Below 700px the desk crops to its middle and the hotspots hide (the columns carry the same links). Hotspot boxes are percentages of the drawing (`getDeskSpots` in `footer.tsx`): re-measure them if the drawing changes. The wall must be pure white in the day drawing and pure black in the night one: multiply and lighten only make those disappear, and any tint shows as a band. Flatten with `magick in.png -background white -alpha remove -alpha off flat.png` (black for the night one); if the wall came back tinted, lift it to white per channel (e.g. `-channel R -level 0,97% -channel G -level 0,96.6% -channel B -level 0,95% +channel` for a #F8F7F3 wall), then `cwebp -q 74 -m 6 -sharp_yuv flat.png -o out.webp`. The 3200px drawing also ships at 1600px and 2400px (`footer-desk-<theme>-1600.webp`, `-2400.webp`; `magick -filter Lanczos -resize 1600x`, same `cwebp` settings), listed in the images' `srcSet`.
- **Instrument Serif (`font-anybody`):** hero and closing headlines, selected scene titles, and large numerals. `font-anybody` is an alias of `font-display`.
- **Instrument Serif:** body copy, italic accents, and serif title treatments in the Design scene.
- **Labels (`font-martian`, an alias of `font-ui`):** Figtree 13px, weight 500, sentence case (`labelClass`).
- **Figtree:** buttons and mock app UI. The receipt keeps IBM Plex Mono (`public/fonts`).

### Controls

- Repeat the same primary CTA, “Build your resume,” in the header, hero, and closing section. Buttons have 2px corners, in Figtree 600, at 38px, 54px, and 56px respectively.
- Scene navigation appears from 1240px. Sentence-case labels use `ink` when active and `ink-3` when inactive; a 6px accent dot marks the active scene. The Share night scene uses its own light inks.
- The GitHub link appears from 1024px, with the GitHub mark and, when available, a filled gold star and live compact count. Format counts with the locale's `Intl.NumberFormat`; include the full count in the accessible name. Failed counts leave the GitHub link available without a star or number.
- Community totals need at least two eligible rows. Hide failed totals and values below 100; reserve loading placeholders and announcements for pending queries.
- The homepage theme control is a fixed 30px pull-cord button at the top end corner. Its height is 92px at rest, 112px on hover, and 124px during a pull. It uses a 450ms spring curve, toggles the shared theme after 170ms, and sways every seven seconds until first activated. The bulb glows in dark mode.

### Motion

Pinned scenes contain a sticky `100svh` stage. Scroll progress is `p = clamp(0, −top / max(1, height − viewportHeight), 1)`; `scroll.ts` writes it to `--p` through one animation-frame-throttled scroll listener. CSS derives continuous motion from progress; React receives only coarse scene and step changes.

| Scene   | Below 900px | From 900px |
| ------- | ----------- | ---------- |
| Hero    | 170vh       | 220vh      |
| Write   | 280vh       | 330vh      |
| Design  | 280vh       | 320vh      |
| Check   | 245vh       | 295vh      |
| Tailor  | 260vh       | 300vh      |
| Share   | 240vh       | 300vh      |
| Prepare | 310vh       | 330vh      |

Light mode combines breathing window light (16 seconds), a drifting mullion shadow (90 seconds), and 18 dust motes. Dark mode adds a neutral 620px cursor glow at 6% opacity. These are decorative and must not obscure text.

Scroll performance (Firefox and phones dropped frames here): the mullion shadow's softness is drawn into its gradients, never `filter: blur()`; backdrop blur uses the `blur-ok` variant (fine pointer, non-Gecko only) and falls back to the plain tinted backdrop; components that follow fast-changing scroll steps (Check's score, Prepare's clock and countdown) subscribe to `useLanding` on their own so the scene around them doesn't re-render.

Scene navigation scrolls smoothly within a scene or to the next one, since scrubbing through is the story. A longer jump cuts to the scene, fading through like a page change, instead of fast-forwarding through every scene between; reduced motion always cuts. Pinned scenes skip rendering offscreen (`content-visibility: auto`); the scroll engine renders a scene and decodes its images while it is within about two screens (`data-warm`) and lets it skip again once it is further away.

Reduced motion fixes scenes at their end state and collapses pinned sections to `100svh` at every width (one rule in `landing.css`). Disable scroll scrubbing, parallax, ambient movement, cord sway, and count animations. The Languages word rotation has a pause control and stays still with reduced motion.

### Illustration

- Ten watercolour doodles live in `apps/web/public/doodles/` as transparent WebP (up to 800px, plus a half-size `-small` and a quarter-size `-tiny`, each resized from the full file with `magick -filter Lanczos` and encoded with the same `cwebp` settings): pencil, paperclip, eraser, curve, magnifier, scissors, plane, globe, jar, and note. They share the footer desk's style: soft washes, thin blue-grey pen lines, cream, sage, moss, slate blue, terracotta and ochre. Prompts and references for regenerating them are kept outside the repo; each is trimmed to its content and its faint background alpha cleaned (`-channel A -level 4%,100%`) before encoding losslessly in alpha (`cwebp -q 82 -alpha_q 100 -exact`), and its size goes in `doodleSizes` (`ui.tsx`). The magnifier is not trimmed: its empty glass is the Check lens, so `check.tsx` positions it from the lens's measured centre and radius in the 1024px source.
- Doodles appear through a 110° mask wipe with subtle parallax. They keep their colours in both themes: opacity 0.92 in light mode, 0.8 and slightly dimmed (`brightness(0.92)`) in dark. No drop shadows: a hard shadow draws the image's box against the paper texture. The Share plane fades in with the night sky.
- Most doodles hide below 900px; pencil and plane remain. Keep them decorative, noninteractive, and clear of readable text.
- Construction guides use `graphite` lines with an SVG turbulence filter for a pencil effect.

### Content and delivery

- Prerender the homepage and public ATS checker per locale at build time through `prerender.tsx` and `apps/web/vite.config.ts`. The app is a client-rendered SPA; `apps/server/src/static/web.ts` serves the generated HTML and adds canonical, Open Graph, `hreflang`, and structured data. Keep headings and body copy in the initial HTML. Prerendered pages start the app's JavaScript only after the first contentful paint (the loader in `vite.config.ts`), so their first screen must not depend on it, and must not fade in on load: the largest paint would wait for the fade.
- Include title and description metadata and `SoftwareApplication` structured data with a zero-price offer.
- **Template previews** come from each template's sample PDF (`apps/web/public/templates/pdf/<id>.pdf`), never at print resolution: `templates/jpg/<id>.jpg` at 600×848 (builder and letter cards, the mobile picker and the README; old mobile builds load this URL, so it stays a JPEG), and `templates/thumb/<id>.webp` at 596×843 with a 300×424 `<id>-small.webp` (homepage and gallery). Regenerate them with the server's sharp:

  ```sh
  id=gengar
  pdftoppm -png -r 300 -singlefile "apps/web/public/templates/pdf/$id.pdf" "/tmp/$id"
  (cd apps/server && node --input-type=module -e '
  import sharp from "sharp";
  const id = process.argv[1], dir = "../web/public/templates";
  const page = (width) => sharp(`/tmp/${id}.png`).resize(width, Math.round((width * 3508) / 2481), { fit: "fill" });
  const webp = { quality: 75, effort: 6, smartSubsample: true };
  await page(600).jpeg({ mozjpeg: true, quality: 75 }).toFile(`${dir}/jpg/${id}.jpg`);
  await page(596).webp(webp).toFile(`${dir}/thumb/${id}.webp`);
  await page(300).webp(webp).toFile(`${dir}/thumb/${id}-small.webp`);
  ' "$id")
  ```

- Use one `h1`, section headings, landmarks, and a skip link. Animated character treatments expose the complete string once to assistive technology. Nothing relies on hover alone.
- Translate copy, accessible labels, and demo resume text through Lingui. Names and addresses may stay literal; the Languages display intentionally preserves native words and language names. Allow text expansion and RTL layouts.

## Do and don't

- **Do** give each view exactly one accent button; a second primary action is secondary or ghost.
- **Do** build lists from flat rows and order pages with serif titles.
- **Do** keep text readable and pair color signals with words.
- **Do** provide empty, loading, error, and success states; keep loading placeholders at their final size.
- **Don't** introduce arbitrary app colors or palette classes such as `amber-600`; use semantic tokens.
- **Don't** use Instrument Serif for small functional app text or at bold weights, set labels in all caps, box a list in a card, or round paper past 2px. Homepage prose follows its separate type rules.
- **Don't** confirm reversible actions; offer undo.
- **Don't** send anything to an AI provider without naming what goes where, or apply an AI edit the person hasn't accepted.
- **Don't** omit `data-slot` on UI primitives; styles and tests rely on it.
