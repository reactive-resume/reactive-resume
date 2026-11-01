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
  display: { fontFamily: Instrument Serif, fontSize: 44px, lineHeight: 48px, fontWeight: 400, letterSpacing: -0.01em }
  title: { fontFamily: Instrument Serif, fontSize: 30px, lineHeight: 36px, fontWeight: 400 }
  sheet-title: { fontFamily: Instrument Serif, fontSize: 22px, lineHeight: 28px, fontWeight: 400 }
  heading: { fontFamily: Figtree, fontSize: 20px, lineHeight: 28px, fontWeight: 600 }
  section-heading: { fontFamily: Figtree, fontSize: 17px, lineHeight: 24px, fontWeight: 600 }
  label: { fontFamily: Figtree, fontSize: 15px, lineHeight: 22px, fontWeight: 600 }
  field-label: { fontFamily: Figtree, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
  body: { fontFamily: Figtree, fontSize: 15px, lineHeight: 24px, fontWeight: 400 }
  ui: { fontFamily: Figtree, fontSize: 14px, lineHeight: 20px, fontWeight: 400 }
  small: { fontFamily: Figtree, fontSize: 13px, lineHeight: 18px, fontWeight: 400 }
  caption: { fontFamily: Figtree, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
  mono: { fontFamily: Geist Mono, fontSize: 12px, lineHeight: 16px, fontWeight: 500 }
rounded:
  xs: 2px
  sm: 2px
  md: 3px
  lg: 4px
  xl: 4px
  2xl: 4px
  3xl: 4px
  4xl: 4px
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

- **Instrument Serif:** page, dialog, and sheet titles; empty-state headlines; large statistics. Use `font-display`. It has one weight (400 and italic): never set it semibold or bold, which the browser would fake.
- **Figtree:** functional UI and body text. Use `font-sans` or `font-ui`.
- **Geist Mono:** shortcuts, URLs, slugs, filenames and counts. Use `font-mono`.
- No all-caps labels or title caps: headings, eyebrows, group labels and buttons are sentence case at 12px or larger, with normal tracking.
- Field labels are 12px, medium weight, in `ink-2`, with a 6px gap above the control. Group eyebrows are 12px, semibold, in `ink-3`.
- Rendered rich text (assistant and coach replies, the rich-text editor) uses shadcn Typeset: `packages/ui/src/styles/typeset.css`, an owned copy reading the app tokens. Wrap content in `typeset` plus a preset: `typeset-chat` or `typeset-field`. It styles only the elements those surfaces render (no images, `kbd`, `details`, definition lists or math). Opt a component out with `not-typeset`.
- Touch inputs use at least 16px text to prevent iOS zoom.
- Fonts are self-hosted through `@fontsource-variable/figtree`, `@fontsource/instrument-serif` and `@fontsource-variable/geist-mono`.

## Iconography

App icons use **Phosphor** (regular weight) through `Icon` from `@reactive-resume/ui/components/icon`. `Icon` takes the glyph's Phosphor name (`x`, `gear-six`, `magnifying-glass`), the same names the [Phosphor catalog](https://phosphoricons.com) and resume icons use. To use another glyph, add it to the `icons` map in that file.

Use 20px icons on desktop and 24px on touch interfaces. Regular weight is the default; reserve filled app icons for selected navigation. Marketing illustrations may use filled icons, such as the GitHub star.

Pair icons with text. Back, close, more, undo/redo, history, assistant, and zoom controls may use `IconButton`, which requires an accessible label and supplies a tooltip with an optional shortcut. `Icon` is decorative (`aria-hidden`) and sized by its font size, so containers can resize it with `text-*`. Directional arrows, chevrons, undo, and redo mirror in RTL layouts.

Icons inside resumes use Phosphor names stored in resume data, drawn by the Phosphor web font; they remain separate from app icons.

## Space, shape, and elevation

- **Spacing:** use the 4px scale in the front matter. Cards typically have 16px padding, panels 16–24px, mobile pages 16px margins, and desktop pages 32–40px margins.
- **Radius:** 2px (`rounded-sm`) for chips, tags, avatars, switches and small marks; 3px (`rounded-md`) for inputs and controls; 4px (`rounded-lg` and up) for cards, menus, dialogs and sheets. Nothing is rounder than 4px; no pills. Only data-viz rings, radio buttons, spinners and landing illustrations stay circular.
- **Elevation:** `shadow-e1` for cards; `shadow-e2` for menus and popovers; `shadow-e3` for dialogs, sheets, and toasts; `shadow-page` for editor paper.
- **Controls:** button heights are 28px (`sm`), 36px (`default`), and 44px (`lg`). Icon button sizes range from 28px to 44px. Inputs grow from 36px to 44px on touch devices; `touch-target` expands smaller controls' hit areas to at least 44×44px.
- **Layout variables:** `--editor-bar: 56px`, `--editor-panel: 400px`, `--app-sidebar: 240px`, `--sheet-share: 440px`, `--sheet-detail: 480px`, and `--assistant: 400px`.

## Motion

| Token                 | Duration | Use                                                    |
| --------------------- | -------- | ------------------------------------------------------ |
| `duration-quick`      | 120ms    | Hover, press, toggles, checkboxes, and focus           |
| `duration-standard`   | 200ms    | Menus, popovers, expansion, content swaps, and dialogs |
| `duration-emphasized` | 320ms    | Sheets, toasts, and the assistant column               |

- Entering and changing state use `ease-enter` (`cubic-bezier(0.2, 0.8, 0.2, 1)`). Exits take 70% of the entry duration.
- Sliding indicators, reordering, and settling use `ease-in-out-strong` (`cubic-bezier(0.77, 0, 0.175, 1)`). Swipe-dismissed bottom sheets use `ease-drawer`.
- Keep app motion brief and purposeful. Small entrance fades, status transitions, and the mobile tab indicator's spring are supported. Loading placeholders stay still; document reflow is never animated. Keyboard mode switches are instant.
- Reduced motion sets duration tokens to 1ms and collapses CSS transitions and animations. Status spinners continue turning.
- A pathname change fades through: the old page fades out over 140ms, then the new one fades up 6px over 200ms, so the two never show at once. The builder's own pending shell (its bar, panel placeholders and a blank page at the canvas's size) stands in while a resume loads; the logo loader covers only the app's first load.
- Dragging auto-scrolls a list only from its outer 8%, gently (`DRAG_AUTO_SCROLL`).
- `apps/web/src/libs/motion.ts` mirrors CSS timings. `MotionConfig reducedMotion="user"` and `followReducedMotion()` make Motion animations respect the preference.

The homepage has separate motion rules below.

## Components

Generic primitives live in `packages/ui/src/components`, using Base UI and cmdk for the command palette. Feature-specific UI belongs in its owning `apps/web` feature.

- **Buttons:** `primary`, `secondary`, `ghost`, `danger`, and `link`. `loading` adds a spinner, sets `aria-busy`, and blocks activation. Use a progress label such as “Preparing…”.
- **Inputs:** `raised` background and `line-2` border; focus adds an accent border and a 3px `accent-soft` ring. Invalid fields use danger styling. Show errors after blur or submission, with an icon and a specific remedy.
- **Switches:** prefer `SwitchRow` so the label is part of the target. Checkboxes are 18px with a 3px radius; radios are 18px with an 8px accent dot.
- **Segments and tabs:** use `SegmentedControl` for 2–4 options in a radio group. Use `Tabs` to switch panels; set `TabsList variant="line"` for underline tabs.
- **Menus:** 4px radius and 36px items. Size popups for their content and trigger; put destructive items last, after a separator.
- **Layers:** menus and popovers provide lightweight choices; sheets hold tasks beside the document and use the bottom variant on mobile; dialogs hold decisions. Use `AlertDialog` for destructive confirmation and name what cancel keeps.
- **Toasts:** one visible at a time, bottom center, with `bg-ink` and `text-bg`. The default timeout is six seconds; `timeout: 0` keeps a toast visible. Undo is an optional underlined action. Pressing an action closes its toast after the action's handler runs, and a second press while it leaves does nothing.
- **Chats:** the assistant and career coach transcripts use `MessageScroller` (shadcn, behaviour from `@shadcn/react`): it follows a streaming reply only while the reader is at the latest message, settles each question near the top, reopens a saved thread on its last question, and shows a “Latest” button after scrolling away. Agent steps are `Trace` lines: spinner and shimmer while running, check when done, danger when failed, dimmed dash when unfinished. Mobile mirrors both.
- **Alerts:** `info`, `success`, `warn`, and `error`; only the error variant adds `role="alert"` by default.
- **Empty states:** a 22px Instrument Serif headline, concise 14px body text, and a primary action. Add a secondary action only when useful.

## Accessibility

Target WCAG 2.2 AA:

- Show a 2px accent focus outline with a 2px gap on `:focus-visible`. Inputs use their border and soft ring instead.
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
- The GitHub link appears from 1024px, with the GitHub mark, a filled gold star, and a live compact count. Format counts with the locale's `Intl.NumberFormat`; include the full count in the accessible name.
- The homepage theme control is a fixed 30px pull-cord button at the top end corner. Its height is 92px at rest, 112px on hover, and 124px during a pull. It uses a 450ms spring curve, toggles the shared theme after 170ms, and sways every seven seconds until first activated. The bulb glows in dark mode.

### Motion

Pinned scenes contain a sticky `100svh` stage. Scroll progress is `p = clamp(0, −top / max(1, height − viewportHeight), 1)`; `scroll.ts` writes it to `--p` through one animation-frame-throttled scroll listener. CSS derives continuous motion from progress; React receives only coarse scene and step changes.

| Scene   | Below 900px | From 900px |
| ------- | ----------- | ---------- |
| Hero    | 170vh       | 220vh      |
| Write   | 280vh       | 330vh      |
| Design  | 320vh       | 360vh      |
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

- **Do** make the primary action obvious and reserve accent for actions and state.
- **Do** keep text readable and pair color signals with words.
- **Do** provide empty, loading, error, and success states; keep loading placeholders at their final size.
- **Don't** introduce arbitrary app colors or palette classes such as `amber-600`; use semantic tokens.
- **Don't** use Instrument Serif for small functional app text or at bold weights, set labels in all caps, or round anything past 4px. Homepage prose follows its separate type rules.
- **Don't** confirm reversible actions; offer undo.
- **Don't** omit `data-slot` on UI primitives; styles and tests rely on it.
