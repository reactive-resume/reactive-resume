---
version: alpha
name: Reactive Resume
description: A monochrome, content-first design system for a free and open-source resume builder. Dark-by-default with light mode support.
colors:
  primary: "#343434"
  primary-foreground: "#FBFBFB"
  secondary: "#F7F7F7"
  secondary-foreground: "#343434"
  background: "#FFFFFF"
  foreground: "#252525"
  muted: "#F7F7F7"
  muted-foreground: "#8E8E8E"
  card: "#FFFFFF"
  card-foreground: "#252525"
  border: "#EBEBEB"
  input: "#EBEBEB"
  ring: "#B5B5B5"
  destructive: "#DC2626"
  on-destructive: "#FFFFFF"
typography:
  heading:
    fontFamily: IBM Plex Sans Variable
    fontSize: 1rem
    fontWeight: 500
  body:
    fontFamily: IBM Plex Sans Variable
    fontSize: 0.875rem
    fontWeight: 400
  body-sm:
    fontFamily: IBM Plex Sans Variable
    fontSize: 0.75rem
    fontWeight: 400
  label:
    fontFamily: IBM Plex Sans Variable
    fontSize: 0.8rem
    fontWeight: 500
  hero-heading:
    fontFamily: IBM Plex Sans Variable
    fontSize: 3.75rem
    fontWeight: 700
    letterSpacing: -0.025em
rounded:
  sm: 0.18rem
  md: 0.24rem
  lg: 0.3rem
  xl: 0.42rem
  2xl: 0.54rem
  3xl: 0.66rem
  4xl: 0.78rem
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
components:
  button-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: 10px
    height: 36px
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 10px
    height: 36px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    padding: 10px
    height: 36px
  button-ghost:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    padding: 10px
    height: 36px
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.on-destructive}"
    rounded: "{rounded.lg}"
    padding: 10px
    height: 36px
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
    padding: 16px
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 10px
  input-focus:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 10px
  badge:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: 4px
  popover:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: 4px
  sidebar:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    padding: 8px
  sidebar-item:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.muted-foreground}"
    rounded: "{rounded.lg}"
    padding: 8px
  sidebar-item-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    padding: 8px
  tooltip:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: 6px
  separator:
    backgroundColor: "{colors.border}"
    height: 1px
  dialog:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.xl}"
    padding: 24px
  input-invalid:
    backgroundColor: "{colors.background}"
    textColor: "{colors.destructive}"
    rounded: "{rounded.lg}"
    height: 36px
    padding: 10px
---

## Overview

Reactive Resume is a monochrome, content-first design system built for a resume builder used by tens of thousands of people worldwide. The visual identity prioritizes readability and unobtrusiveness — the user's resume content is always the hero, never the chrome around it.

The system defaults to dark mode with a warm near-black backdrop that makes the resume preview "float" as the visual anchor. Light mode is supported as a full alternative. The authenticated app shell (dashboard, builder, settings) uses an entirely achromatic grayscale palette — the sole chromatic exception is destructive red for dangerous actions. The landing page introduces subtle chromatic accents: blue-tinted spotlight gradients on the hero, a multicolor text-mask animation on hover, and social auth provider brand colors (Google blue, LinkedIn blue) on the login page.

The overall aesthetic is a professional tool UI: clean grid lines, subtle borders, generous whitespace, and typography that steps back to let the content shine. Think "VS Code meets Figma" — a productivity workspace, not a marketing site.

One deliberate counterpoint to the serious UI: all resume templates are named after Pokemon (Azurill, Bronzor, Chikorita, Ditgar, Gengar, Pikachu, etc.). This is an intentional brand choice — playful naming for templates injects personality into an otherwise utilitarian interface, making templates feel collectible and memorable rather than generic ("Template 1", "Modern", "Classic").

## Colors

The palette is rooted in achromatic OKLch values (chroma = 0), producing a pure grayscale scale without warm or cool casts. Colors are defined as CSS custom properties using `oklch()` and consumed through Tailwind CSS 4 theme tokens. Always prefer CSS variables (e.g., `var(--primary)`) or Tailwind tokens (e.g., `bg-primary`) over raw color values. The hex values in this document's YAML front matter are agent-friendly approximations of the canonical OKLch definitions in `packages/ui/src/styles/globals.css` — use hex only where OKLch is unavailable.

- **Primary (#343434 light / #EBEBEB dark):** Used for high-emphasis interactive surfaces — default buttons, selected states, and text selection. In dark mode this inverts to near-white so buttons remain prominent.
- **Foreground (#252525 light / #FBFBFB dark):** Body text and headings. High contrast against the background in both themes.
- **Background (#FFFFFF light / #252525 dark):** The canvas. Pure white in light mode, warm near-black in dark mode.
- **Card (#FFFFFF light / #343434 dark):** Elevated surface for cards, panels, and the builder sidebar. In dark mode, one step lighter than the background to create subtle depth.
- **Muted (#F7F7F7 light / #454545 dark):** De-emphasized backgrounds for secondary UI regions, hover states, and inactive tabs.
- **Muted Foreground (#8E8E8E light / #B5B5B5 dark):** Captions, helper text, timestamps, and metadata. Deliberately low-contrast against the background to recede visually.
- **Border (#EBEBEB light / white at 10% opacity dark):** Thin separator lines. In dark mode, uses transparent white rather than a solid gray to blend naturally with any underlying surface color.
- **Input (#EBEBEB light / white at 15% opacity dark):** Form field borders, slightly more prominent than general borders to make input areas discoverable.
- **Destructive (#DC2626 light / #EF4444 dark):** The only chromatic color in the palette. Reserved exclusively for delete actions, error states, and danger-zone operations. Used at 10% opacity as a background tint with full saturation for text, creating a soft but unmistakable warning.
- **Ring (#B5B5B5 light / #8E8E8E dark):** Focus ring indicator at 50% opacity, surrounding focused interactive elements.
- **Sidebar Primary (dark only, #6366F1):** An indigo value inherited from the shadcn/ui defaults. Not actively used in the current UI — sidebar active states use the standard grayscale primary token instead. Retained in the CSS custom properties for potential future customization.

Resume templates have their own independent color system — users pick primary, text, and background colors per resume through a color picker in the builder's Design panel. These template colors are completely separate from the app shell palette.

## Typography

The entire application uses a single typeface: **IBM Plex Sans Variable**. This is a humanist sans-serif with an extensive weight range (100–900) and excellent readability at small sizes, both on screen and in PDFs.

- **Hero heading (responsive: 2.25rem mobile / 3rem tablet / 3.75rem desktop, weight 700, tracking-tight):** Landing page headline only. Large, bold, and commanding. Scales across three breakpoints.
- **Section heading (1rem / 16px, weight 500):** Used for section titles in the builder sidebar, settings panels, and dashboard cards. Medium weight provides hierarchy without shouting.
- **Body (0.875rem / 14px, weight 400):** The workhorse. All form labels, descriptions, card content, and general UI text.
- **Small body (0.75rem / 12px, weight 400):** Captions, helper text, timestamps, and metadata.
- **Label (0.8rem / ~13px, weight 500):** Button text, badge labels, and form field labels. Slightly heavier than body to denote interactivity.

The resume content itself uses a separate font system — users choose from 1,000+ Google Fonts for their resume headings and body text, with category-aware fallback stacks including CJK support (Noto Sans SC, PingFang SC, Hiragino Sans GB for sans-serif; Noto Serif SC, Songti SC for serif). Standard PDF fonts (Helvetica, Courier, Times-Roman) are available as offline fallbacks.

Font rendering uses `antialiased` (grayscale AA) and `proportional-nums` across the board for clean rendering and properly spaced numerals in dates and phone numbers.

## Layout

### Builder (Three-Panel Workspace)

The core builder uses a resizable three-panel layout powered by `react-resizable-panels`:

- **Left sidebar (default 22%):** Resume section forms — personal info, experience, education, skills, and custom sections. Scrollable with collapsible section groups.
- **Center artboard (default 56%):** Live resume preview rendered via PDF.js canvas. Supports zoom, pan, and pinch gestures via `react-zoom-pan-pinch`. The preview maintains A4 aspect ratio (210:297) with a subtle shadow to simulate a physical page.
- **Right sidebar (default 22%):** Design controls — template picker, font selection, color picker, layout manager (page assignments, section ordering via drag-and-drop).

Panel sizes persist in cookies. On mobile (< 768px), sidebars collapse to 0% width and become toggleable overlays (max 95% width when open). The desktop minimum collapsed width is 48px (icon rail).

### Dashboard

Standard sidebar navigation layout using the `Sidebar` component system. The sidebar contains: logo, resume list link, agent link, settings subnavigation (profile, preferences, authentication, API keys, integrations, danger zone), and a footer with user avatar. Content area shows a responsive grid of resume cards.

### Landing Page

Full-width single-column marketing layout:
1. **Floating builder preview** — A non-interactive screenshot of the builder as a hero visual, creating an immediate "this is what you get" impression.
2. **Hero** — Centered headline, subheadline, and two CTAs (primary "Get Started" with arrow, ghost "Learn More" with icon).
3. **Features grid** — 4-column responsive grid with icon + title + description cards, separated by thin border lines.
4. **Template carousel** — Horizontally scrolling row of template preview thumbnails with Pokemon-themed names.
5. **Testimonials** — Tiled user quotes in a masonry-style grid.
6. **Support / FAQ / Footer** — Accordion FAQ, community section, and a 4-column footer with logo, resource links, community links, and license info.

### Responsive Breakpoints

Mobile detection uses a 768px threshold via `MediaQueryList`. The layout is optimized for workspace productivity on larger screens, with responsive mobile support that adapts the multi-panel builder into a streamlined single-panel experience. Both desktop and mobile are supported experiences — the builder's three-panel layout leverages desktop space, while mobile surfaces the same editing capabilities through collapsible overlays.

### Page Aspect Ratio

A custom Tailwind token `--aspect-page: 210 / 297` enforces A4 paper proportions wherever resume pages are rendered (builder preview, public view, PDF export).

## Animation

Motion exists to explain a change, confirm an action, or soften a jump. This is a tool people use for hours, so it stays crisp: short, precise, rarely decorative.

**Frequency decides first.** Keyboard-initiated actions (the command palette, ⌘B sidebar toggle, zoom shortcuts, keyboard-opened menus via Base UI's `data-instant`) do not animate. Things hit tens of times a day (list rows, tooltips after the first, context menus) get opacity-only or no motion. Dialogs, sheets and toasts get a standard transition. Only rare moments (marketing pages, first load) get more.

**Tokens.** Never hand-type a curve.
- CSS: `ease-out-strong` / `var(--ease-out-strong)` (`cubic-bezier(0.23, 1, 0.32, 1)`) for anything entering, exiting or responding; `ease-in-out-strong` for on-screen movement nobody is waiting on (ambient loops, carousels); `ease-drawer` for sheets. Never `ease-in`.
- Motion (JS): `EASE_OUT_STRONG` from `apps/web/src/libs/motion.ts`.

**Durations.** Press feedback 100–160ms, tooltips/popovers/menus 150ms in and 100ms out, dialogs 200ms in and 150ms out, sheets 300ms. App UI stays under 300ms; marketing reveals may run 0.5–0.9s. Exits are faster than entrances.

**Mechanics.**
- Popups use interruptible CSS transitions on Base UI's `data-starting-style` / `data-ending-style`, scale from `0.95` (never `0`) and grow from `origin-(--transform-origin)`. Modals stay centred.
- Animate `transform`/`translate`/`scale` and `opacity` only. No `transition-all`, no permanent `will-change` (Motion promotes layers while it animates).
- Presses use `active:scale-[0.97]`. `Button` already has it; don't wrap it in Motion hover/tap wrappers.
- Lists use `AnimatePresence initial={false}` so items animate when added or removed, not every time the list mounts.
- Continuous loops (marquees, drifting spotlights) are CSS keyframes, so they run off the main thread.

**Reduced motion:** `MotionConfig reducedMotion="user"` disables Motion transforms, and CSS transitions and animations collapse to `0.01ms` — except `animate-spin`, which keeps spinning so loading never looks frozen. Values driven by `useSpring`/`useMotionValue` bypass `MotionConfig`, so check `useReducedMotion()` there.

## Elevation & Depth

Elevation is handled through background color layering rather than drop shadows:

- **Level 0 — Background:** The base canvas (`--background`).
- **Level 1 — Card:** One step lighter in dark mode (`--card`), used for sidebars, panels, and cards.
- **Level 2 — Popover:** Same as card, but appears above the content layer in popovers, dropdowns, and command palette.
- **Level 3 — Overlay:** Backdrop blur (`backdrop-blur-xs` at 0.5px or `backdrop-blur-2xl` at 40px) with `backdrop-saturate-150` for modal overlays, creating a frosted-glass effect over the workspace.

The resume preview page uses a subtle drop shadow to simulate a physical sheet of paper floating above the dark artboard — one of the few places actual shadows appear.

## Shapes

Border radius follows a multiplicative scale from a single `--radius` base of `0.3rem`:

| Token | Value | Usage |
|:------|:------|:------|
| `sm` | 0.18rem (≈3px) | Small badges, inline chips |
| `md` | 0.24rem (≈4px) | XS/SM buttons, compact elements |
| `lg` | 0.3rem (≈5px) | Default buttons, cards, inputs |
| `xl` | 0.42rem (≈7px) | Larger cards, modal corners |
| `2xl` | 0.54rem (≈9px) | Dialog containers |
| `3xl` | 0.66rem (≈11px) | Large panels |
| `4xl` | 0.78rem (≈12px) | Full-page modals |

The radius scale is deliberately tight — the largest value (0.78rem) is still quite subtle. This avoids the "rounded everything" aesthetic and keeps the UI feeling precise and tool-like. Interactive elements consistently use `rounded-lg` as the default.

## Components

### Buttons

Six variants, all sharing `rounded-lg` corners, `font-medium`, `text-sm`, and a 1px `translate-y` on active press (except when the button opens a popup):

- **Default:** Solid primary background. The highest-emphasis action on any screen.
- **Outline:** Transparent with a border. For secondary actions that need clear boundaries.
- **Secondary:** Muted background. For paired actions alongside a primary button.
- **Ghost:** No background or border. For toolbar actions and inline controls where chrome would be noise.
- **Destructive:** Red at 10% opacity background with red text. Visually alarming without being garish.
- **Link:** Underline-on-hover text. For inline navigation within prose.

Size scale: `xs` (28px), `sm` (32px), `default` (36px), `lg` (40px), plus `icon` variants at each size for square icon-only buttons.

### Cards

White/dark surface with foreground text. Composed of `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`, and `CardAction` slots. Default vertical padding is `py-4` (compact: `py-3`).

### Forms

Built on TanStack Form with Zod validation. Composed of `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, and `FormDescription`. Validation errors only appear after field touch. Invalid fields get a red destructive border with a ring.

### Dialogs

Centralized dialog manager with 40+ dialog types, all rendered via pattern matching (`ts-pattern`). Dialogs support before-close validation, form blocking for unsaved changes, and confirmation prompts. Used for all CRUD operations on resume sections, settings changes, and import/export flows.

### Command Palette

Triggered by `Cmd+K` / `Ctrl+K`. Built on `cmdk` with fuzzy search via `Fuse.js`. Multi-page navigation (resumes, settings, preferences) with back navigation via Backspace. Screen-reader accessible with `sr-only` headings.

### Toast Notifications

Powered by Sonner, positioned bottom-right with rich colors. Used for auto-save feedback, form submission status, error reporting, and donation prompts. Loading toasts are used during async operations (PDF generation, resume creation) with dismiss-on-complete.

### Drag and Drop

Powered by `@dnd-kit` with `PointerSensor` and `KeyboardSensor`. Used in chip inputs (skill tags, URL lists) and page layout management (section ordering across resume pages). Smooth animations via Motion library.

## Internationalization

The app supports 40+ locales including RTL languages (Arabic, Hebrew, Persian, Urdu, Uyghur, Yiddish). i18n is not an afterthought — it shapes layout decisions:

**Direction:** The `<html>` element receives `dir="rtl"` or `dir="ltr"` based on the active locale, detected via `isRTL()` which checks the language prefix against a known RTL set. All layout mirroring flows from this single attribute.

**Logical properties:** Use CSS logical properties (`ps-`, `pe-`, `ms-`, `me-`, `inline-start`, `inline-end`, `inset-s-`, `inset-e-`) instead of physical (`pl-`, `pr-`, `ml-`, `mr-`, `left`, `right`). Button components already use `has-data-[icon=inline-start]:ps-2` and `has-data-[icon=inline-end]:pe-2` patterns. This ensures correct spacing in both LTR and RTL layouts without separate stylesheets.

**Variable-length text:** Translations can be 30–50% longer than English (German, Finnish) or significantly shorter (CJK). UI elements should accommodate variable text length — avoid fixed widths on buttons and labels. Use `whitespace-nowrap` only where truncation is acceptable, and prefer `min-w-0` with `truncate` over fixed-width containers.

**Icons:** Directional icons (arrows, chevrons, progress indicators) should mirror in RTL contexts. Phosphor Icons provides mirrored variants for directional icons. Non-directional icons (settings gear, checkmark, delete) do not mirror.

**Strings:** All user-facing strings use Lingui macros (`t`, `msg`, `<Trans>`) — never hardcode English text in components. Translation files are `.po` format under `/locale/`.

## Do's and Don'ts

### Do

- **Use the grayscale palette for all app chrome.** The absence of color is the brand. The resume content is the only thing that should be colorful.
- **Default to dark mode.** The dark workspace makes resume previews pop and reduces eye strain during extended editing sessions.
- **Use `text-sm` (14px) as the base text size.** The UI is information-dense — form fields, section labels, metadata — and needs to be scannable without feeling cramped.
- **Keep border radius tight.** Use `rounded-lg` (0.3rem) as the default. The tool should feel precise, not playful.
- **Respect reduced motion preferences.** All animations collapse to 0.01ms when `prefers-reduced-motion: reduce` is active.
- **Use Phosphor Icons consistently.** Regular weight, `size-4` (16px) default. Icons should be functional labels, not decorative.
- **Maintain the three-panel builder proportions.** The center artboard should always dominate. Sidebars are support panels, not equal peers.
- **Use transparent-white borders in dark mode.** `oklch(1 0 0 / 10%)` blends naturally with any surface rather than introducing a distinct gray band.

### Don't

- **Don't introduce accent colors into the app shell.** No blues, greens, or purples for primary actions. The only chromatic color is destructive red. The inherited indigo sidebar-primary token exists in CSS custom properties but is not actively used.
- **Don't use drop shadows for elevation.** Rely on background color layering and border separation. The one exception is the resume page preview shadow.
- **Don't make the UI compete with the resume content.** If a new feature draws more visual attention than the resume preview, it needs to be toned down.
- **Don't use large border radii.** Nothing above `rounded-xl` on standard components. Large pills and full-round shapes conflict with the precision-tool aesthetic.
- **Don't hardcode colors outside the token system.** All colors flow through CSS custom properties so that dark/light mode switching works automatically.
- **Don't use multiple typefaces in the app shell.** IBM Plex Sans Variable is the only UI font. Resume templates have their own font system, but the chrome stays single-family.
- **Don't skip the `data-slot` attribute on components.** It's used for styling hooks and accessibility selectors throughout the component library.
- **Don't forget RTL.** The app supports 40+ locales including Arabic, Hebrew, Persian, and Urdu. Use logical properties (`ps`, `pe`, `ms`, `me`) instead of physical (`pl`, `pr`, `ml`, `mr`).
