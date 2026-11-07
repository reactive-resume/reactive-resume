// Design tokens, copied from the handoff reference (reference/Tokens.kt, generated from the Reactive Resume design
// system). Colours: oklch converted to sRGB. Type: CSS px = sp; spacing and radii: CSS px = dp. Paper never inverts.
package me.rxresu.core.designsystem

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

@Immutable
data class RrColors(
    val bg: Color, // The app desk: page background behind panels and the document.
    val surface: Color, // Panels, cards, secondary buttons.
    val raised: Color, // Menus, dialogs, popovers, inputs; the selected segment of a segmented control.
    val sunken: Color, // Wells, tracks, skeletons, the page canvas, neutral badges and alerts, disabled fills.
    val line: Color, // Default border and divider on every element; separators, tab strips.
    val line2: Color, // Decorative rules and quiet outlines: secondary buttons, outline badges, dashed empty-state
    val controlBorder: Color, // The edge of a control people must find: inputs, input groups, checkboxes, radios, code box
    val ink: Color, // Primary text on bg, surface, raised and sunken. Also the toast and tooltip fill (with bg a
    val ink2: Color, // Secondary text and field labels on bg, surface, raised, sunken and accent-soft.
    val ink3: Color, // Metadata, placeholders, counts, eyebrows on bg, surface and raised. The lightest text allo
    val accent: Color, // Moss green. The one primary action per view, selection, progress, checked controls, the fo
    val accentHover: Color, // Hover fill of a primary button.
    val onAccent: Color, // Text and icons on accent and accent-hover fills. Dark in the dark theme, where accent ligh
    val accentSoft: Color, // Selected rows, success alerts, AI proposals, text selection, the 3px input focus ring.
    val accentText: Color, // Green text on accent-soft, bg and surface: links, success copy, accent badges.
    val danger: Color, // Danger button fill (white text) and invalid-field borders. Dark theme: white on danger is 
    val dangerSoft: Color, // Error alert and danger badge background; focus ring of an invalid input.
    val dangerText: Color, // Error copy on danger-soft, bg and raised; destructive menu items.
    val warn: Color, // Marks only, never text: Check issue underlines and markers, stale-edit dots, the score rin
    val warnSoft: Color, // Warning alert and badge background.
    val warnText: Color, // Warning copy on warn-soft.
    val warnInk: Color, // Text on a solid warn fill, such as Check issue-marker numbers: about 6.9:1 on warn in ligh
    val infoSoft: Color, // Neutral guidance and assistant questions: info alert and badge background.
    val infoText: Color, // Info copy on info-soft.
    val hover: Color, // Translucent hover wash for ghost buttons and highlighted menu items.
    val press: Color, // Translucent pressed wash for ghost and secondary buttons.
    val scrim: Color, // Backdrop behind dialogs.
    val scrimSheet: Color, // Lighter backdrop behind sheets, so the document stays readable beside them.
    val isDark: Boolean,
)

val LightRrColors = RrColors(
    bg = Color(0xFFF8F7F3), // oklch(0.975 0.005 95)
    surface = Color(0xFFFEFDFC), // oklch(0.995 0.002 95)
    raised = Color(0xFFFFFFFF), // oklch(1 0 0)
    sunken = Color(0xFFF0EFEB), // oklch(0.952 0.006 95)
    line = Color(0xFFDFDEDA), // oklch(0.9 0.006 95)
    line2 = Color(0xFFC5C4BE), // oklch(0.82 0.008 95)
    controlBorder = Color(0xFF888680), // #888680
    ink = Color(0xFF1C1B15), // oklch(0.22 0.01 95)
    ink2 = Color(0xFF4F4D47), // oklch(0.42 0.01 95)
    ink3 = Color(0xFF6D6C65), // oklch(0.53 0.01 95)
    accent = Color(0xFF337344), // oklch(0.5 0.1 150)
    accentHover = Color(0xFF206133), // oklch(0.44 0.1 150)
    onAccent = Color(0xFFF7FEF8), // oklch(0.99 0.01 150)
    accentSoft = Color(0xFFDCF2DF), // oklch(0.94 0.035 150)
    accentText = Color(0xFF195C2E), // oklch(0.42 0.1 150)
    danger = Color(0xFFBA3630), // oklch(0.53 0.17 27)
    dangerSoft = Color(0xFFFFE7E4), // oklch(0.95 0.03 27)
    dangerText = Color(0xFFA92321), // oklch(0.48 0.17 27)
    warn = Color(0xFFD29922), // oklch(0.72 0.14 80)
    warnSoft = Color(0xFFFCEDCD), // oklch(0.95 0.045 85)
    warnText = Color(0xFF81520A), // oklch(0.48 0.1 70)
    warnInk = Color(0xFF22190A), // oklch(0.22 0.03 80)
    infoSoft = Color(0xFFE0F1FF), // oklch(0.95 0.03 250)
    infoText = Color(0xFF1D5B92), // oklch(0.46 0.11 250)
    hover = Color(0x0D1C1B15), // oklch(0.22 0.01 95 / 0.05)
    press = Color(0x171C1B15), // oklch(0.22 0.01 95 / 0.09)
    scrim = Color(0x52171611), // oklch(0.2 0.01 95 / 0.32)
    scrimSheet = Color(0x2E171611), // oklch(0.2 0.01 95 / 0.18)
    isDark = false,
)

val DarkRrColors = RrColors(
    bg = Color(0xFF100F0C), // oklch(0.17 0.006 95)
    surface = Color(0xFF171613), // oklch(0.2 0.006 95)
    raised = Color(0xFF1F1E1A), // oklch(0.235 0.007 95)
    sunken = Color(0xFF0B0A08), // oklch(0.145 0.006 95)
    line = Color(0xFF2C2B27), // oklch(0.29 0.007 95)
    line2 = Color(0xFF494843), // oklch(0.4 0.008 95)
    controlBorder = Color(0xFF73726C), // #73726c
    ink = Color(0xFFEFEEEB), // oklch(0.95 0.005 95)
    ink2 = Color(0xFFBCBAB5), // oklch(0.79 0.008 95)
    ink3 = Color(0xFF979590), // oklch(0.67 0.008 95)
    accent = Color(0xFF6FC082), // oklch(0.74 0.12 150)
    accentHover = Color(0xFF83D494), // oklch(0.8 0.12 150)
    onAccent = Color(0xFF07150A), // oklch(0.18 0.03 150)
    accentSoft = Color(0xFF1A3520), // oklch(0.3 0.05 150)
    accentText = Color(0xFF8FD89E), // oklch(0.82 0.11 150)
    danger = Color(0xFFD9544B), // oklch(0.62 0.17 27)
    dangerSoft = Color(0xFF47211D), // oklch(0.3 0.06 27)
    dangerText = Color(0xFFFDA297), // oklch(0.8 0.11 27)
    warn = Color(0xFFE4B750), // oklch(0.8 0.13 85)
    warnSoft = Color(0xFF3E2D10), // oklch(0.31 0.05 80)
    warnText = Color(0xFFEFCC83), // oklch(0.86 0.1 85)
    warnInk = Color(0xFF22190A), // oklch(0.22 0.03 80)
    infoSoft = Color(0xFF192F46), // oklch(0.3 0.05 250)
    infoText = Color(0xFF9DC9F7), // oklch(0.82 0.08 250)
    hover = Color(0x0FFFFFFF), // oklch(1 0 0 / 0.06)
    press = Color(0x1AFFFFFF), // oklch(1 0 0 / 0.1)
    scrim = Color(0x80000000), // oklch(0 0 0 / 0.5)
    scrimSheet = Color(0x80000000), // oklch(0 0 0 / 0.5)
    isDark = true,
)

/** Paper and stage colours are the same in both themes. Stages appear only as a dot or stepper bar beside the stage name. */
object RrFixedColors {
    val paper = Color(0xFFFFFFFF)
    /** Text and icons on a solid danger fill (white in both themes, as the design system draws it). */
    val onDanger = Color(0xFFFFFFFF)
    val stageSaved = Color(0xFF908C7F)
    val stageApplied = Color(0xFF5590CC)
    val stageScreening = Color(0xFF00A0A6)
    val stageInterview = Color(0xFFAF8433)
    val stageOffer = Color(0xFF579F68)
    val stageClosed = Color(0xFFC67067)
    /** Ink of the sample page drawn on paper (both themes). */
    val paperInk = Color(0xFF1D1D1F)
    /** Abstract text lines on page thumbnails. */
    val thumbHeading = Color(0xFF1F2B3A)
    val thumbLine = Color(0xFFC8CCD2)
    val thumbLetterHeading = Color(0xFF444444)
    val thumbLetterLine = Color(0xFFD0D0D0)
    /** Lock mark on a thumbnail: dark glyph on 92% paper. */
    val thumbLockInk = Color(0xFF333333)
}


// Fonts: static TTFs already in the repo at apps/mobile/assets/fonts (copy to res/font with lowercase names).
val Figtree = FontFamily(
    Font(R.font.figtree_regular, FontWeight.Normal),
    Font(R.font.figtree_medium, FontWeight.Medium),
    Font(R.font.figtree_semibold, FontWeight.SemiBold),
    Font(R.font.figtree_bold, FontWeight.Bold),
)
/** One weight only (400). Never synthesize bold. */
val InstrumentSerif = FontFamily(Font(R.font.instrument_serif_regular, FontWeight.Normal))
/** Upright regular only, as in the app. Use for URLs, slugs, filenames, counts, times. */
val GeistMono = FontFamily(Font(R.font.geist_mono_regular, FontWeight.Normal))

/** Text centred in its line box with half-leading above and below, as CSS lays it out. */
private val CssLineHeight = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)

object RrType {
    /** Large statistics and hero headings inside the app. Instrument Serif has one weight: never set it sem */
    val display = TextStyle(fontFamily = InstrumentSerif, fontWeight = FontWeight.Normal, fontSize = 44.sp, lineHeight = 48.sp, lineHeightStyle = CssLineHeight, letterSpacing = (-0.01).em)
    /** Page titles (h1). */
    val title = TextStyle(fontFamily = InstrumentSerif, fontWeight = FontWeight.Normal, fontSize = 30.sp, lineHeight = 36.sp, lineHeightStyle = CssLineHeight)
    /** Dialog and sheet titles; empty-state headlines. */
    val sheetTitle = TextStyle(fontFamily = InstrumentSerif, fontWeight = FontWeight.Normal, fontSize = 22.sp, lineHeight = 28.sp, lineHeightStyle = CssLineHeight)
    /** Panel headings. */
    val heading = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 28.sp, lineHeightStyle = CssLineHeight)
    /** Section headings inside panels and settings. */
    val sectionHeading = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 24.sp, lineHeightStyle = CssLineHeight)
    /** List-item titles and emphasized labels. */
    val label = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, lineHeight = 22.sp, lineHeightStyle = CssLineHeight)
    /** Reading copy: descriptions, guide text. */
    val body = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 24.sp, lineHeightStyle = CssLineHeight)
    /** Default app text: buttons, menu items, inputs, table cells. */
    val ui = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp, lineHeightStyle = CssLineHeight)
    /** Alerts, small buttons, segment labels, switch descriptions. */
    val small = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp, lineHeightStyle = CssLineHeight)
    /** Badges, tooltips, avatar initials. */
    val caption = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, lineHeightStyle = CssLineHeight)
    /** Field labels in ink-2, 6px above their control. */
    val fieldLabel = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, lineHeightStyle = CssLineHeight)
    /** Group eyebrows and menu group labels: sentence case, normal tracking, in ink-3. No all-caps labels. */
    val eyebrow = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, lineHeight = 16.sp, lineHeightStyle = CssLineHeight)
    /** Geist Mono: shortcuts, URLs, slugs, filenames, counts after tab labels. */
    val mono = TextStyle(fontFamily = GeistMono, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp, lineHeightStyle = CssLineHeight)
    /** Text inputs on touch: 16sp. */
    val input = TextStyle(fontFamily = Figtree, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 22.sp, lineHeightStyle = CssLineHeight)
}

object RrSpace {
    val s1 = 4.dp
    val s2 = 8.dp
    val s3 = 12.dp
    val s4 = 16.dp
    val s6 = 24.dp
    val s8 = 32.dp
    val s12 = 48.dp
    val s16 = 64.dp
    val pageMargin = 16.dp
}

/** Nothing is rounder than 4dp. radius-full only for true circles (radio, spinner, score ring). */
object RrRadius {
    val xs = 2.dp // smallest marks
    val sm = 2.dp // chips, badges, tags, avatars, switches, stage dots
    val md = 3.dp // inputs, buttons, checkboxes, menu items
    val lg = 4.dp // list items, large buttons, alerts, toasts, segmented tracks
    val xl = 4.dp // cards, menus, popovers
    val dialog = 4.dp // radius-2xl
    val sheetTop = 4.dp // radius-3xl: bottom sheets, top corners only
    val largeSurface = 4.dp // radius-4xl
    val full = 999.dp // true circles only
}


/** Shapes built from [RrRadius]. Nothing is rounder than 4 dp; [full] only for true circles. */
object RrShape {
    val xs = RoundedCornerShape(RrRadius.xs)
    val sm = RoundedCornerShape(RrRadius.sm)
    val md = RoundedCornerShape(RrRadius.md)
    val lg = RoundedCornerShape(RrRadius.lg)
    val sheetTop = RoundedCornerShape(topStart = RrRadius.sheetTop, topEnd = RrRadius.sheetTop)
    val full = RoundedCornerShape(50)
}

/** Layout constants (dp). */
object RrLayout {
    val editorBar = 56.dp
    val editorPanel = 400.dp
    val appSidebar = 240.dp
    val sheetShare = 440.dp
    val sheetDetail = 480.dp
    val assistant = 400.dp
    val tabBar = 56.dp
    val topBar = 56.dp
    val minTouch = 44.dp
    const val PAGE_ASPECT = 210f / 297f
}
