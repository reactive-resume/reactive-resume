// Desk & Paper tokens for React Native.
// Screens use these and nothing else; add a missing token here rather than hard-coding a value.
import { Easing } from "react-native";

export type ColorScheme = "light" | "dark";

// §1 Colours and §1.1 named tints. Alpha is the last two hex digits (#RRGGBBAA).
const light = {
	bg: "#F8F7F3",
	surface: "#FEFDFC",
	raised: "#FFFFFF",
	sunken: "#F0EFEB",
	line: "#DFDEDA",
	line2: "#C5C4BE",
	lineStrong: "#888680",
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
	infoSoft: "#E0F1FF",
	infoText: "#1D5B92",
	hover: "#1C1B150D",
	press: "#1C1B1517",
	scrim: "#17161152",
	scrimSheet: "#1716112E",
	paper: "#FFFFFF",
	paperInk: "#1C1B15",
	paperLine: "#DFDEDA",
	paperAccent: "#337344",
	paperWarn: "#D29922",
	paperWarnSoft: "#FCEDCD",
	stageSaved: "#908C7F",
	stageApplied: "#5590CC",
	stageScreen: "#00A0A6",
	stageInterv: "#AF8433",
	stageOffer: "#579F68",
	stageClosed: "#C67067",
	pageSelectFill: "#3373441F",
	pageSelectLine: "#337344",
	pageIssueFill: "#D2992238",
	pageProposalFill: "#3373441F",
	selectedFill: "#DCF2DF",
};

export type ColorToken = keyof typeof light;
export type Colors = Record<ColorToken, string>;

const dark: Colors = {
	bg: "#100F0C",
	surface: "#171613",
	raised: "#1F1E1A",
	sunken: "#0B0A08",
	line: "#2C2B27",
	line2: "#494843",
	lineStrong: "#73726C",
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
	infoSoft: "#192F46",
	infoText: "#9DC9F7",
	hover: "#FFFFFF0F",
	press: "#FFFFFF1A",
	scrim: "#00000080",
	scrimSheet: "#00000080",
	paper: "#FFFFFF",
	paperInk: "#1C1B15",
	paperLine: "#DFDEDA",
	paperAccent: "#337344",
	paperWarn: "#D29922",
	paperWarnSoft: "#FCEDCD",
	stageSaved: "#908C7F",
	stageApplied: "#5590CC",
	stageScreen: "#00A0A6",
	stageInterv: "#AF8433",
	stageOffer: "#579F68",
	stageClosed: "#C67067",
	pageSelectFill: "#3373441F",
	pageSelectLine: "#337344",
	pageIssueFill: "#D2992238",
	pageProposalFill: "#3373441F",
	selectedFill: "#1A3520",
};

export const colors: Record<ColorScheme, Colors> = { light, dark };

// §2 Type. Custom fonts select weight by family name (Android ignores fontWeight for them), so each weight is its
// own family, loaded under these names in src/ui/fonts.ts.
export const fonts = {
	ui: {
		400: "Figtree-Regular",
		500: "Figtree-Medium",
		600: "Figtree-SemiBold",
		700: "Figtree-Bold",
	},
	/** Instrument Serif ships one weight (no bold); never pair it with fontWeight. */
	display: {
		400: "InstrumentSerif-Regular",
	},
	mono: {
		400: "GeistMono-Regular",
	},
} as const;

type TextStyleToken = {
	fontFamily: string;
	fontSize: number;
	lineHeight: number;
	letterSpacing: number;
	maxFontSizeMultiplier?: number;
};

export const type = {
	largeIOS: { fontFamily: fonts.display[400], fontSize: 34, lineHeight: 41, letterSpacing: -0.3 },
	largeAnd: { fontFamily: fonts.display[400], fontSize: 28, lineHeight: 34, letterSpacing: 0 },
	display: { fontFamily: fonts.display[400], fontSize: 28, lineHeight: 34, letterSpacing: -0.2 },
	heading: { fontFamily: fonts.display[400], fontSize: 22, lineHeight: 28, letterSpacing: 0 },
	title: { fontFamily: fonts.ui[600], fontSize: 17, lineHeight: 22, letterSpacing: 0 },
	bodyLarge: { fontFamily: fonts.ui[400], fontSize: 16, lineHeight: 22, letterSpacing: 0 },
	body: { fontFamily: fonts.ui[400], fontSize: 15, lineHeight: 21, letterSpacing: 0 },
	label: { fontFamily: fonts.ui[600], fontSize: 15, lineHeight: 20, letterSpacing: 0 },
	callout: { fontFamily: fonts.ui[400], fontSize: 13, lineHeight: 18, letterSpacing: 0 },
	caption: { fontFamily: fonts.ui[500], fontSize: 12, lineHeight: 16, letterSpacing: 0 },
	micro: { fontFamily: fonts.ui[600], fontSize: 11, lineHeight: 13, letterSpacing: 0.1, maxFontSizeMultiplier: 1.6 },
	mono: { fontFamily: fonts.mono[400], fontSize: 13, lineHeight: 18, letterSpacing: 0 },
	/** Section labels and eyebrows, in sentence case. */
	eyebrow: {
		fontFamily: fonts.ui[600],
		fontSize: 12,
		lineHeight: 16,
		letterSpacing: 0,
		maxFontSizeMultiplier: 1.6,
	},
} satisfies Record<string, TextStyleToken>;

/** `pageThumb`: Instrument Serif 400 that scales with the letter card, 3.3% of its width. */
export const pageThumb = { fontFamily: fonts.display[400], widthRatio: 0.033 } as const;

// §3 Spacing, 4 pt grid.
export const space = { s0: 2, s1: 4, s2: 8, s3: 12, s4: 16, s5: 20, s6: 24, s8: 32, s10: 40, s12: 48 } as const;

// §3.1 Sizes.
export const size = {
	hit: 44,
	row: 52,
	input: 46,
	button: 48,
	chip: 32,
	tabBar: 52,
	topBar: 44,
	editorBar: 56,
	newPill: { width: 34, height: 26 },
	grabber: { width: 36, height: 5 },
	sidebar: 240,
	panel: 400,
	formSheet: 540,
	sheetShare: 440,
	sheetDetail: 480,
	/** Phosphor sizes: inline meta 16, list rows 20, toolbars 22, tab bar and nav bar 24. */
	icon: { meta: 16, row: 20, toolbar: 22, bar: 24 },
} as const;

// §4 Radii.
export const radius = {
	rSm: 2,
	rMd: 3,
	/** Every larger shape (cards, sheets, former pills): corners stay square-ish everywhere. */
	rLg: 4,
} as const;

// §5 Shadows. `boxShadow` first; `ios` and `elevation` are the legacy fallback for Android below API 28.
type ShadowToken = {
	boxShadow: string;
	ios: {
		shadowColor: string;
		shadowOffset: { width: number; height: number };
		shadowOpacity: number;
		shadowRadius: number;
	};
	elevation: number;
};

export const shadows: Record<ColorScheme, Record<"e1" | "e2" | "e3" | "ePage", ShadowToken>> = {
	light: {
		e1: {
			boxShadow: "0 1px 2px #17161112",
			ios: { shadowColor: "#171611", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 1 },
			elevation: 1,
		},
		e2: {
			boxShadow: "0 1px 2px #1716110F, 0 10px 28px -8px #1716112E",
			ios: { shadowColor: "#171611", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.14, shadowRadius: 12 },
			elevation: 4,
		},
		e3: {
			boxShadow: "0 2px 6px #17161114, 0 28px 64px -16px #1716114D",
			ios: { shadowColor: "#171611", shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.22, shadowRadius: 28 },
			elevation: 12,
		},
		ePage: {
			boxShadow: "0 1px 2px #17161114, 0 12px 36px -12px #17161140",
			ios: { shadowColor: "#171611", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 14 },
			elevation: 3,
		},
	},
	dark: {
		e1: {
			boxShadow: "0 1px 2px #00000066",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.4, shadowRadius: 1 },
			elevation: 1,
		},
		e2: {
			boxShadow: "0 1px 2px #00000066, 0 12px 32px -8px #0000008C",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12 },
			elevation: 4,
		},
		e3: {
			boxShadow: "0 2px 6px #00000066, 0 28px 64px -12px #000000B3",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.6, shadowRadius: 28 },
			elevation: 12,
		},
		ePage: {
			boxShadow: "0 1px 2px #00000066, 0 12px 36px -12px #00000099",
			ios: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 14 },
			elevation: 3,
		},
	},
};

// §6 Motion. With reduced motion on, d1–d3 become 0 for movement (see tokens.md §6).
export const motion = {
	d1: 120,
	d2: 200,
	d3: 320,
	ease: Easing.bezier(0.2, 0.8, 0.2, 1),
	easeMove: Easing.bezier(0.77, 0, 0.175, 1),
	easeDrawer: Easing.bezier(0.32, 0.72, 0, 1),
} as const;
