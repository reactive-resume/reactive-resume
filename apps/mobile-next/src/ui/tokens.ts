// Reactive Resume mobile tokens, final storyboard (v4, 9 Nov 2026). Generated from the design system (oklch converted to sRGB).
// Units: React Native points/dp (1 CSS px on the boards = 1 dp). Font sizes in sp/pt.
// Token names in design/layout/*.json and design/COMPONENTS.md are the kebab-case CSS names (ink-3, line-2,
// control-border, st-saved...). cssName() converts these camelCase keys to them.
// dangerFill (filled danger buttons, swipe actions; white text) and warnMark (indicator dots) are the v3 contrast tokens.
// Pure data, no imports: reference/motion.tsx turns the curves into Reanimated and React Navigation easings.

export type ThemeName = "light" | "dark";

const lightColors = {
	bg: "#F8F7F3",
	surface: "#FEFDFC",
	raised: "#FFFFFF",
	sunken: "#F0EFEB",
	line: "#DFDEDA",
	line2: "#C5C4BE",
	controlBorder: "#888680",
	ink: "#1C1B15",
	ink2: "#4F4D47",
	ink3: "#6D6C65",
	accent: "#337344",
	accentHover: "#206133",
	onAccent: "#F7FEF8",
	accentSoft: "#DCF2DF",
	accentText: "#195C2E",
	danger: "#BA3630",
	dangerSoft: "#FFE7E4",
	dangerText: "#A92321",
	warn: "#D29922",
	warnSoft: "#FCEDCD",
	warnText: "#81520A",
	warnInk: "#22190A",
	infoSoft: "#E0F1FF",
	infoText: "#1D5B92",
	hover: "rgba(28, 27, 21, 0.05)",
	press: "rgba(28, 27, 21, 0.09)",
	scrim: "rgba(23, 22, 17, 0.32)",
	scrimSheet: "rgba(23, 22, 17, 0.18)",
	paper: "#FFFFFF",
	stSaved: "#908C7F",
	stApplied: "#5590CC",
	stScreening: "#00A0A6",
	stInterview: "#AF8433",
	stOffer: "#579F68",
	stClosed: "#C67067",
	dangerFill: "#BA3630",
	warnMark: "#B46E00",
} as const;

const darkColors = {
	bg: "#100F0C",
	surface: "#171613",
	raised: "#1F1E1A",
	sunken: "#0B0A08",
	line: "#2C2B27",
	line2: "#494843",
	controlBorder: "#73726C",
	ink: "#EFEEEB",
	ink2: "#BCBAB5",
	ink3: "#979590",
	accent: "#6FC082",
	accentHover: "#83D494",
	onAccent: "#07150A",
	accentSoft: "#1A3520",
	accentText: "#8FD89E",
	danger: "#D9544B",
	dangerSoft: "#47211D",
	dangerText: "#FDA297",
	warn: "#E4B750",
	warnSoft: "#3E2D10",
	warnText: "#EFCC83",
	warnInk: "#22190A",
	infoSoft: "#192F46",
	infoText: "#9DC9F7",
	hover: "rgba(255, 255, 255, 0.06)",
	press: "rgba(255, 255, 255, 0.1)",
	scrim: "rgba(0, 0, 0, 0.5)",
	scrimSheet: "rgba(0, 0, 0, 0.5)",
	paper: "#FFFFFF",
	stSaved: "#908C7F",
	stApplied: "#5590CC",
	stScreening: "#00A0A6",
	stInterview: "#AF8433",
	stOffer: "#579F68",
	stClosed: "#C67067",
	dangerFill: "#C53732",
	warnMark: "#E4B750",
} as const;

export const colors = { light: lightColors, dark: darkColors };
export type ColorToken = keyof typeof lightColors;

/** camelCase key → the CSS token name used in the layout dumps ("ink3" → "ink-3", "stSaved" → "st-saved"). */
export const cssName = (key: string) =>
	key
		.replace(/([A-Z])/g, "-$1")
		.replace(/([a-z])(\d)/g, "$1-$2")
		.toLowerCase();

/** CSS box-shadow strings for React Native's `boxShadow` style (New Architecture, RN 0.76+). */
export const shadows = {
	light: {
		sh1: "0px 1px 2px 0px rgba(23, 22, 17, 0.071)",
		sh2: "0px 1px 2px 0px rgba(23, 22, 17, 0.059), 0px 10px 28px -8px rgba(23, 22, 17, 0.18)",
		sh3: "0px 2px 6px 0px rgba(23, 22, 17, 0.078), 0px 28px 64px -16px rgba(23, 22, 17, 0.298)",
		shp: "0px 1px 2px 0px rgba(23, 22, 17, 0.078), 0px 12px 36px -12px rgba(23, 22, 17, 0.251)",
	},
	dark: {
		sh1: "0px 1px 2px 0px rgba(0, 0, 0, 0.4)",
		sh2: "0px 1px 2px 0px rgba(0, 0, 0, 0.4), 0px 12px 32px -8px rgba(0, 0, 0, 0.549)",
		sh3: "0px 2px 6px 0px rgba(0, 0, 0, 0.4), 0px 28px 64px -12px rgba(0, 0, 0, 0.698)",
		shp: "0px 1px 2px 0px rgba(0, 0, 0, 0.4), 0px 12px 36px -12px rgba(0, 0, 0, 0.6)",
	},
} as const;

/** Font family names as registered with expo-font (one family per static weight). Adjust to the app's names. */
export const fonts = {
	ui400: "Figtree-Regular",
	ui500: "Figtree-Medium",
	ui600: "Figtree-SemiBold",
	ui700: "Figtree-Bold",
	display: "InstrumentSerif-Regular",
	mono: "GeistMono-Regular", // the boards use mono at 500; only Regular ships, so Regular it is
} as const;

type TextToken = { fontFamily: string; fontSize: number; lineHeight: number; letterSpacing?: number };
const ui = (w: 400 | 500 | 600 | 700, size: number, lh: number): TextToken => ({
	fontFamily: fonts[`ui${w}` as const],
	fontSize: size,
	lineHeight: lh,
});
const serif = (size: number, lh: number, ls = 0): TextToken => ({
	fontFamily: fonts.display,
	fontSize: size,
	lineHeight: lh,
	letterSpacing: ls,
});
const mono = (size: number, lh: number): TextToken => ({ fontFamily: fonts.mono, fontSize: size, lineHeight: lh });

/**
 * Text styles. Design-system names match design/COMPONENTS.md §1. The primitive Text component must also apply
 * textDefaults so line boxes match the boards' CSS line boxes (text centred in its line height, no font padding).
 */
export const type = {
	// design system
	display: serif(44, 48, -0.44),
	title: serif(30, 36),
	sheetTitle: serif(22, 28),
	heading: ui(600, 20, 28),
	sectionHeading: ui(600, 17, 24),
	label: ui(600, 15, 22),
	body: ui(400, 15, 24),
	ui: ui(400, 14, 20),
	small: ui(400, 13, 18),
	caption: ui(500, 12, 16),
	fieldLabel: ui(500, 12, 16),
	eyebrow: ui(600, 12, 16),
	mono: mono(12, 16),
	input: ui(400, 16, 22),
	// mobile storyboard
	rootTitle: serif(34, 40, -0.17),
	pageTitle: serif(28, 34),
	bigNumber: serif(40, 44, -0.4), // every 40/44 serif number in the dumps: A1, B9, B10, B13, W1
	statNumber: serif(36, 40),
	rowTitle: ui(500, 16, 24),
	formLabel: ui(500, 13, 18),
	prose: ui(400, 16, 26),
	dockLabel: ui(500, 12, 16),
	topBarTitle: ui(600, 15, 20),
	buttonSm: ui(500, 13, 18),
	buttonMd: ui(500, 14, 20),
	buttonLg: ui(500, 15, 20),
	segment: ui(500, 14, 18),
	keyLine: ui(500, 13, 18),
	textLink: ui(500, 15, 20),
	linkSmall: ui(500, 14, 20),
	bubble: ui(400, 15, 22),
	chip: ui(500, 13, 18),
	monoUi: mono(14, 20),
} as const;
export type TypeToken = keyof typeof type;

/** Apply to every Text: Android drops font padding and centres in the line box; iOS needs no extra padding. */
export const textDefaults = { includeFontPadding: false, textAlignVertical: "center" as const };

export const space = { s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s12: 48, s16: 64 } as const;

/** "Soft corners". Replaces the design system's 2-4 dp radii for the app only. */
export const radius = {
	xs: 6, // badges, Used chips, issue markers, checkboxes, number tags
	sm: 8, // chips, small buttons, colour swatches, avatars
	md: 10, // fields, buttons, icon buttons, icon tiles, monograms, segment thumbs, send button
	lg: 12, // large buttons, segmented tracks, menus, toasts, list groups, week-strip day
	xl: 16, // cards, hero cards, composer, bubbles, 56 dp avatars, board cards, B5 photo
	dialog: 20, // dialogs, record button
	sheetTop: 20,
	paper: 2, // pages and page thumbnails stay square paper (document thumbnails 3)
	full: 999, // switches, dots, radios, dock badges
} as const;

export const layout = {
	frameWidth: 390,
	frameHeight: 844,
	safeTop: 47, // storyboard frame; on device use real safe-area insets
	safeBottom: 34,
	screenMargin: 24,
	topBar: 56,
	dock: 64,
	listRowMin: 64,
	iconTile: 40,
	listThumbWidth: 36,
	listThumbHeight: 50,
	sectionGapTop: 32,
	sectionGapTopFirst: 20,
	heroPadding: 24,
	rootTitleCollapseAfter: 40,
	dockLargeText: 80, // the dock past 150% text size (Reach board)
} as const;

/**
 * Hit areas (Reach board, COMPONENTS.md §0.1). Every control answers to at least this square; a smaller drawing
 * extends its hit area evenly (hitSlop) and never overlaps a neighbour's. Use hit() rather than these numbers.
 */
export const hitTarget = { ios: 44, android: 48 } as const;

/** Motion tokens (boards/Motion.png, design/MOTION.md). Durations in ms; exits take 70% of the entry. */
export const motion = {
	d1: 120,
	d2: 200,
	d3: 320,
	/** Tab fade-through: outgoing content fades out over this, then the incoming fades up over d2. */
	fadeThroughOut: 140,
	exitFactor: 0.7,
	curves: {
		ease: [0.2, 0.8, 0.2, 1],
		easeInOutStrong: [0.77, 0, 0.175, 1],
		easeOutStrong: [0.23, 1, 0.32, 1],
		easeDrawer: [0.32, 0.72, 0, 1],
	},
	pressScale: 0.97,
	popupStartScale: 0.98,
	popupStartOffset: 4,
	liftScale: 1.02, // rows and sections lifted to reorder
	liftScaleCard: 1.02, // J2 board cards: also rotate −2° and gain sh3 + a 2 dp accent ring (as drawn)
	liftRotateCard: -2,
	fadeUp: 6, // content and results fading up
	fadeUpFirstRun: 8, // T2 first appearance, toasts
	pushParallax: 0.3, // the covered screen shifts 30% of the width
	sheetDismissFraction: 0.25,
	sheetDismissVelocity: 1000, // dp/s downward
	swipeCommitFraction: 0.4,
	workingLabelStep: 2200,
	toastPlain: 5000, // paused while touched or focused; screen readers and longer system timeouts extend it
	toastWithAction: 8000,
	shake: { distance: 4, cycles: 2 }, // A2 failure; A3 uses one cycle
	stagger: { welcome: 80, firstRun: 60, checklist: 60, insightBars: 40 },
	pinch: { min: 0.6, max: 3, doubleTap: 2 },
	autoScrollEdge: 0.08, // reorder auto-scroll only from the outer 8% of a list
	spinnerRevolution: 1000,
} as const;
export const exit = (ms: number) => Math.round(ms * motion.exitFactor);

/**
 * Haptic vocabulary (boards/Motion.png). iOS: expo-haptics selection/impact/notification. Android:
 * Haptics.performAndroidHapticsAsync(AndroidHaptics.<name>) (the haptic engine, no VIBRATE permission), never
 * impactAsync (that one is a Vibrator simulation on Android). `minApi` is the Android API level the constant needs;
 * below it use `fallback`. Implemented in reference/motion.tsx → the app's src/ui/motion.tsx.
 */
export const haptics = {
	selection: { ios: "selection", android: "Segment_Tick", minApi: 34, fallback: "Clock_Tick" },
	toggleOn: { ios: "impactLight", android: "Toggle_On", minApi: 34, fallback: "Context_Click" },
	toggleOff: { ios: "impactLight", android: "Toggle_Off", minApi: 34, fallback: "Context_Click" },
	light: { ios: "impactLight", android: "Context_Click", minApi: 23, fallback: "Context_Click" },
	medium: { ios: "impactMedium", android: "Drag_Start", minApi: 34, fallback: "Long_Press" },
	rigid: { ios: "impactRigid", android: "Gesture_End", minApi: 30, fallback: "Virtual_Key" },
	soft: { ios: "impactSoft", android: "Gesture_Start", minApi: 30, fallback: "Keyboard_Tap" },
	success: { ios: "notifySuccess", android: "Confirm", minApi: 30, fallback: "Virtual_Key" },
	warning: { ios: "notifyWarning", android: "Long_Press", minApi: 23, fallback: "Long_Press" },
	error: { ios: "notifyError", android: "Reject", minApi: 30, fallback: "Long_Press" },
} as const;
export type HapticToken = keyof typeof haptics;
