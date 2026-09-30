---
version: 6.0.0
name: Reactive Resume · Desk & Paper
description: A warm, quiet interface around bright paper. Moss green marks primary actions, selection, and progress. Light and dark themes keep document paper white.
colors:
  light:
    bg: "#F8F7F3"
    surface: "#FEFDFC"
    raised: "#FFFFFF"
    sunken: "#F0EFEB"
    line: "#DFDEDA"
    line-2: "#C5C4BE"
    ink: "#1C1B15"
    ink-2: "#4F4D47"
    ink-3: "#6D6C65"
    accent: "#337344"
    accent-hover: "#206133"
    on-accent: "#F7FEF8"
    accent-soft: "#DCF2DF"
    accent-text: "#195C2E"
    danger: "#BA3630"
    danger-soft: "#FFE7E4"
    danger-text: "#A92321"
    warn: "#D29922"
    warn-soft: "#FCEDCD"
    warn-text: "#81520A"
    info-soft: "#E0F1FF"
    info-text: "#1D5B92"
  dark:
    bg: "#100F0C"
    surface: "#171613"
    raised: "#1F1E1A"
    sunken: "#0B0A08"
    line: "#2C2B27"
    line-2: "#494843"
    ink: "#EFEEEB"
    ink-2: "#BCBAB5"
    ink-3: "#979590"
    accent: "#6FC082"
    accent-hover: "#83D494"
    on-accent: "#07150A"
    accent-soft: "#1A3520"
    accent-text: "#8FD89E"
    danger: "#D9544B"
    danger-soft: "#47211D"
    danger-text: "#FDA297"
    warn: "#E4B750"
    warn-soft: "#3E2D10"
    warn-text: "#EFCC83"
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
  display: { fontFamily: Newsreader, fontSize: 44px, lineHeight: 48px, fontWeight: 500, letterSpacing: -0.01em }
  title: { fontFamily: Newsreader, fontSize: 30px, lineHeight: 36px, fontWeight: 500 }
  sheet-title: { fontFamily: Newsreader, fontSize: 22px, lineHeight: 28px, fontWeight: 500 }
  heading: { fontFamily: Hanken Grotesk, fontSize: 20px, lineHeight: 28px, fontWeight: 600 }
  section-heading: { fontFamily: Hanken Grotesk, fontSize: 17px, lineHeight: 24px, fontWeight: 600 }
  label: { fontFamily: Hanken Grotesk, fontSize: 15px, lineHeight: 22px, fontWeight: 600 }
  field-label: { fontFamily: Hanken Grotesk, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
  body: { fontFamily: Hanken Grotesk, fontSize: 15px, lineHeight: 24px, fontWeight: 400 }
  ui: { fontFamily: Hanken Grotesk, fontSize: 14px, lineHeight: 20px, fontWeight: 400 }
  small: { fontFamily: Hanken Grotesk, fontSize: 13px, lineHeight: 18px, fontWeight: 400 }
  caption: { fontFamily: Hanken Grotesk, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
  mono: { fontFamily: JetBrains Mono, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
rounded:
  sm: 6px
  md: 8px
  lg: 10px
  xl: 12px
  2xl: 16px
  3xl: 18px
  4xl: 24px
  full: 999px
spacing: [4, 8, 12, 16, 24, 32, 48, 64]
motion:
  quick: 120ms
  standard: 200ms
  emphasized: 320ms
  easing: cubic-bezier(0.2, 0.8, 0.2, 1)
  exit: 70% of the entering duration
  movement-easing: cubic-bezier(0.77, 0, 0.175, 1)
marketing:
  typography:
    display: { fontFamily: Anybody, fontWeight: "300–400", fontStretch: "86%–112%" }
    write-title: { fontFamily: Anybody, fontSize: "clamp(72px, 9vw, 160px)", lineHeight: 0.9, fontWeight: 300 }
    numeral: { fontFamily: Anybody, fontSize: "clamp(56px, 7.5vw, 136px)", fontWeight: 300, fontVariantNumeric: tabular-nums }
    body: { fontFamily: Newsreader, fontSize: "16–21px", lineHeight: "1.45–1.5", fontWeight: 400 }
    accent: { fontFamily: Newsreader, fontStyle: italic, color: accent-text }
    label: { fontFamily: Martian Mono, fontSize: 11px, fontWeight: 500, letterSpacing: 0.08em, textTransform: uppercase }
    wordmark: { fontFamily: Anybody, fontSize: 17.5cqw, lineHeight: 0.84, fontWeight: 800, fontStretch: 78% }
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
  doodles: { opacity: { light: 0.72, dark: 0.42 }, darkFilter: "invert(1) brightness(1.1)" }
---

## Overview

Reactive Resume uses “Desk & Paper”: a warm, quiet interface around a bright resume or letter. Low-contrast surfaces, thin rules, and a moss-green accent keep attention on the document.

This reference covers the current app and homepage. Implementation details live in the source files named below; [REDESIGN_PLAN.md](REDESIGN_PLAN.md) records the redesign milestones and deviations from the original handoff.

Five principles guide decisions:

1. **The page is the interface.** Keep the live document visible while editing. Selecting a supported block opens its fields.
2. **One obvious next step.** Each app view has one primary action. Reserve accent fills for that action, selection, and progress.
3. **Nothing is lost.** Edits autosave, reversible changes offer undo, and confirmations are reserved for irreversible actions.
4. **Detail on demand.** Make defaults useful; put advanced controls one disclosure deeper.
5. **AI proposes, you decide.** Show AI edits as reviewable proposals before applying them.

Resume templates retain their Pokémon names, fonts, and palettes. App typography and control styling do not dictate template appearance.

## Tokens

`packages/ui/src/styles/globals.css` defines light tokens on `:root` and dark overrides on `.dark`. OKLCH values are authoritative; the front matter lists approximate sRGB equivalents. Tailwind exposes semantic utilities such as `bg-bg`, `bg-surface`, `border-line`, `text-ink`, and `bg-accent`.

- **Surfaces:** `bg` for the app desk; `surface` for panels and cards; `raised` for menus, dialogs, and inputs; `sunken` for wells, tracks, and the page canvas.
- **Text:** `ink` for primary text, `ink-2` for secondary text, and `ink-3` for metadata and placeholders. Use no lighter text token, and check contrast on tinted backgrounds.
- **Signals:** `danger` for errors and irreversible actions; `warn` for issues to review; `info-soft` and `info-text` for neutral guidance. Success uses `accent-soft` and `accent-text`.
- **Overlays:** `hover` and `press` are translucent interaction states; `scrim` and `scrim-sheet` dim the background behind layers.
- **Paper:** `--paper` remains white in both themes. Switching the app theme must not invert documents.
- **Stages:** `stage-saved`, `stage-applied`, `stage-screening`, `stage-interview`, `stage-offer`, and `stage-closed` identify application stages. Use small dots or stepper bars beside stage names.

Use semantic tokens in app code. Legacy names such as `background`, `foreground`, `primary`, `muted`, and `sidebar-*` are no longer defined.

## Typography

The front matter records the app type scale. Field labels use the separate `field-label` size.

- **Newsreader:** page, dialog, and sheet titles; empty-state headlines; large statistics. Use `font-display`.
- **Hanken Grotesk:** functional UI and body text. Use `font-sans` or `font-ui`.
- **JetBrains Mono:** shortcuts, URLs, slugs, filenames, counts, and section eyebrows. Use `font-mono`.
- Field labels are 12px, medium weight, in `ink-2`, with a 6px gap above the control. Group eyebrows are 12px, semibold, uppercase, in `ink-3`, with 0.02em tracking.
- Touch inputs use at least 16px text to prevent iOS zoom.
- Fonts are self-hosted through `@fontsource-variable`.

## Iconography

App icons use **Material Symbols Rounded**, weight 300, through `Icon` from `@reactive-resume/ui/components/icon`. The self-hosted subset is defined in `packages/ui/src/icons/names.ts`.

To add a glyph:

1. Add its name to `names.ts`.
2. Run `pnpm icons:build` to validate names and rebuild the subset and manifest.

Use 20px icons on desktop and 24px on touch interfaces. Outline is the default; reserve filled app icons for selected navigation. Marketing illustrations may use filled symbols, such as the GitHub star.

Pair icons with text. Back, close, more, undo/redo, history, assistant, and zoom controls may use `IconButton`, which requires an accessible label and supplies a tooltip with an optional shortcut. `Icon` is decorative (`aria-hidden`, `translate="no"`); CSS draws its glyph from `data-icon`, keeping the name out of text content. Directional arrows, chevrons, undo, and redo mirror in RTL layouts.

Icons inside resumes use Phosphor names stored in resume data; they remain separate from app icons.

## Space, shape, and elevation

- **Spacing:** use the 4px scale in the front matter. Cards typically have 16px padding, panels 16–24px, mobile pages 16px margins, and desktop pages 32–40px margins.
- **Radius:** 6px for chips and small buttons; 8px for inputs and controls; 10px for list items; 12px for cards and menus; 16px for dialogs; 18px for mobile sheets. Use `rounded-full` for pills; `rounded-4xl` is 24px where needed.
- **Elevation:** `shadow-e1` for cards; `shadow-e2` for menus and popovers; `shadow-e3` for dialogs, sheets, and toasts; `shadow-page` for editor paper.
- **Controls:** button heights are 28px (`sm`), 36px (`default`), and 44px (`lg`). Icon button sizes range from 28px to 44px. Inputs grow from 36px to 44px on touch devices; `touch-target` expands smaller controls' hit areas to at least 44×44px.
- **Layout variables:** `--editor-bar: 56px`, `--editor-panel: 400px`, `--app-sidebar: 240px`, `--sheet-share: 440px`, `--sheet-detail: 480px`, and `--assistant: 400px`.

## Motion

| Token | Duration | Use |
| --- | --- | --- |
| `duration-quick` | 120ms | Hover, press, toggles, checkboxes, and focus |
| `duration-standard` | 200ms | Menus, popovers, expansion, content swaps, and dialogs |
| `duration-emphasized` | 320ms | Sheets, toasts, and the assistant column |

- Entering and changing state use `ease-enter` (`cubic-bezier(0.2, 0.8, 0.2, 1)`). Exits take 70% of the entry duration.
- Sliding indicators, reordering, and settling use `ease-in-out-strong` (`cubic-bezier(0.77, 0, 0.175, 1)`). Swipe-dismissed bottom sheets use `ease-drawer`.
- Keep app motion brief and purposeful. Small entrance fades, status transitions, and the mobile tab indicator's spring are supported. Loading placeholders stay still; document reflow is never animated. Keyboard mode switches are instant.
- Reduced motion sets duration tokens to 1ms and collapses CSS transitions and animations. Status spinners continue turning.
- `apps/web/src/libs/motion.ts` mirrors CSS timings. `MotionConfig reducedMotion="user"` and `followReducedMotion()` make Motion animations respect the preference.

The homepage has separate motion rules below.

## Components

Generic primitives live in `packages/ui/src/components`, using Base UI and cmdk for the command palette. Feature-specific UI belongs in its owning `apps/web` feature.

- **Buttons:** `primary`, `secondary`, `ghost`, `danger`, and `link`. `loading` adds a spinner, sets `aria-busy`, and blocks activation. Use a progress label such as “Preparing…”.
- **Inputs:** `raised` background and `line-2` border; focus adds an accent border and a 3px `accent-soft` ring. Invalid fields use danger styling. Show errors after blur or submission, with an icon and a specific remedy.
- **Switches:** prefer `SwitchRow` so the label is part of the target. Checkboxes are 18px with a 5px radius; radios are 18px with an 8px accent dot.
- **Segments and tabs:** use `SegmentedControl` for 2–4 options in a radio group. Use `Tabs` to switch panels; set `TabsList variant="line"` for underline tabs.
- **Menus:** 12px radius and 36px items. Size popups for their content and trigger; put destructive items last, after a separator.
- **Layers:** menus and popovers provide lightweight choices; sheets hold tasks beside the document and use the bottom variant on mobile; dialogs hold decisions. Use `AlertDialog` for destructive confirmation and name what cancel keeps.
- **Toasts:** one visible at a time, bottom center, with `bg-ink` and `text-bg`. The default timeout is six seconds; `timeout: 0` keeps a toast visible. Undo is an optional underlined action.
- **Alerts:** `info`, `success`, `warn`, and `error`; only the error variant adds `role="alert"` by default.
- **Empty states:** a 22px Newsreader headline, concise 14px body text, and a primary action. Add a secondary action only when useful.

## Accessibility

Target WCAG 2.2 AA:

- Show a 2px accent focus outline with a 2px gap on `:focus-visible`. Inputs use their border and soft ring instead.
- Provide at least 24px pointer targets and 44px touch targets. Every drag operation needs keyboard and menu alternatives.
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

## Marketing site

The public homepage in `apps/web/src/features/homepage` shares app colors and themes but has its own typography, illustrations, and motion. `landing.css` defines its fonts, graphite color, paper shadows, and ambient animations. Other illustration colors in the front matter are scene values, not global app tokens.

### Brand and type

- **Header:** a 30px logomark from `apps/web/public/icon/{light,dark}.svg`. Keep “Reactive Resume” as visually hidden text inside the home link.
- **Footer:** a 140px logo from `apps/web/public/logo/{light,dark}.svg`, followed by community and MIT license copy.
- **Wordmark:** Anybody 800, at 17.5cqw and 78% width, with “Reactive” in `ink` and “Resume” in `accent-text`. A 23cqw container crops it through a gradient mask. It rises from 60% translation as the footer enters and is decorative (`aria-hidden`).
- **Anybody:** hero and closing headlines, selected scene titles, large numerals, and the wordmark. Use weights 300–400 for main display text; reserve 800 for the wordmark.
- **Newsreader:** body copy, italic accents, and serif title treatments in the Design scene. The app's `font-display` still maps to Newsreader; use `font-anybody` explicitly.
- **Martian Mono:** 11px uppercase labels at weight 500, with 0.08em tracking. Use `font-martian`.
- **Hanken Grotesk:** buttons and mock app UI. All four families are self-hosted.

### Controls

- Repeat the same primary CTA, “Build your resume,” in the header, hero, and closing section. Buttons are pills in Hanken Grotesk 600, at 38px, 54px, and 56px respectively.
- Scene navigation appears from 1240px. Martian Mono labels use `ink` when active and `ink-3` when inactive; a 6px accent dot marks the active scene. The Share night scene uses its own light inks.
- The GitHub link appears from 1024px, with the GitHub mark, a filled gold star, and a live compact count in Martian Mono. Format counts with the locale's `Intl.NumberFormat`; include the full count in the accessible name.
- The homepage theme control is a fixed 30px pull-cord button at the top end corner. Its height is 92px at rest, 112px on hover, and 124px during a pull. It uses a 450ms spring curve, toggles the shared theme after 170ms, and sways every seven seconds until first activated. The bulb glows in dark mode.

### Motion

Pinned scenes contain a sticky `100svh` stage. Scroll progress is `p = clamp(0, −top / max(1, height − viewportHeight), 1)`; `scroll.ts` writes it to `--p` through one animation-frame-throttled scroll listener. CSS derives continuous motion from progress; React receives only coarse scene and step changes.

| Scene | Below 900px | From 900px |
| --- | --- | --- |
| Hero | 190vh | 260vh |
| Write | 280vh | 330vh |
| Design | 380vh | 440vh |
| Check | 260vh | 320vh |
| Tailor | 280vh | 330vh |
| Share | 240vh | 300vh |

Light mode combines breathing window light (16 seconds), a drifting mullion shadow (90 seconds), and 18 dust motes. Dark mode adds a neutral 620px cursor glow at 6% opacity. These are decorative and must not obscure text.

Reduced motion fixes scenes at their end state and collapses pinned sections to `100svh`. Disable scroll scrubbing, parallax, ambient movement, cord sway, and count animations. The Languages word rotation has a pause control and stays still with reduced motion.

### Illustration

- Ten graphite doodles live in `apps/web/public/doodles/` as WebP: pencil, paperclip, eraser, curve, magnifier, scissors, plane, globe, jar, and note.
- Doodles appear through a 110° mask wipe with subtle parallax. Default opacity is 0.72 in light mode and 0.42 in dark, with inversion and a slight brightness increase. The Share plane uses a brighter treatment against the night sky.
- Most doodles hide below 900px; pencil and plane remain. Keep them decorative, noninteractive, and clear of readable text.
- Construction guides use `graphite` lines with an SVG turbulence filter for a pencil effect.

### Content and delivery

- Prerender the homepage and public ATS checker per locale at build time through `prerender.tsx` and `apps/web/vite.config.ts`. The app is a client-rendered SPA; `apps/server/src/static/web.ts` serves the generated HTML and adds canonical, Open Graph, `hreflang`, and structured data. Keep headings and body copy in the initial HTML.
- Include title and description metadata and `SoftwareApplication` structured data with a zero-price offer.
- Use one `h1`, section headings, landmarks, and a skip link. Animated character treatments expose the complete string once to assistive technology. Nothing relies on hover alone.
- Translate copy, accessible labels, and demo resume text through Lingui. Names and addresses may stay literal; the Languages display intentionally preserves native words and language names. Allow text expansion and RTL layouts.

## Do and don't

- **Do** make the primary action obvious and reserve accent for actions and state.
- **Do** keep text readable and pair color signals with words.
- **Do** provide empty, loading, error, and success states; keep loading placeholders at their final size.
- **Don't** introduce arbitrary app colors or palette classes such as `amber-600`; use semantic tokens.
- **Don't** use Newsreader for small functional app text. Homepage prose follows its separate type rules.
- **Don't** confirm reversible actions; offer undo.
- **Don't** omit `data-slot` on UI primitives; styles and tests rely on it.
