// Hero card, cards, question card, board card, chips, badges and small markers (COMPONENTS.md §7, §8, §12).
import type { StyleProp, ViewStyle } from "react-native";
import { type ReactNode, useState } from "react";
import { Platform, Text as RNText, View } from "react-native";
import { Box, Ring, Touch } from "./base";
import { Icon, type IconName } from "./Icon";
import { hitSlopFor } from "./motion";
import { type Stage, StageDot } from "./rows";
import { Text } from "./Text";
import { useTheme } from "./theme";
import { type ColorToken, fonts, layout, radius, textDefaults, type as typeScale } from "./tokens";
import { STORYBOARD, useDesignTag } from "@/dev/storyboard/harness";

/** The one hero card of a root tab: key line, title, paragraph, a Large primary button. */
export function HeroCard({
	keyLine,
	stage,
	keyIcon,
	keyIconSize = 18,
	title,
	body,
	onBodyPress,
	children,
	dashed = false,
	bg = "surface",
	style,
}: {
	keyLine?: string | undefined;
	stage?: Stage | undefined;
	keyIcon?: IconName | undefined;
	/** B4's suggestion card draws its sparkle at 16 dp. */
	keyIconSize?: number | undefined;
	/** B4's suggestion card sits on `raised` (the root-tab heroes on `surface`). */
	bg?: "surface" | "raised" | undefined;
	title?: string | undefined;
	body?: string | undefined;
	/** The body is a link (J6: an interview's meeting link opens in the browser); it looks the same. */
	onBodyPress?: (() => void) | undefined;
	/** The button (8 dp extra top margin is added) and an optional centred link under it. */
	children?: ReactNode | undefined;
	/** The dashed drop target (D4 empty, P2): no shadow, content centred. */
	dashed?: boolean | undefined;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors, shadows } = useTheme();
	return (
		<Box
			component="HeroCard"
			bg={bg}
			radius={radius.xl}
			style={[
				{ marginTop: 20, marginHorizontal: layout.screenMargin, padding: layout.heroPadding, gap: 12 },
				dashed
					? {
							borderWidth: 1,
							borderStyle: "dashed",
							borderColor: colors.line2,
							alignItems: "center",
							paddingVertical: 40,
						}
					: { borderWidth: 1, borderColor: colors.line, boxShadow: shadows.sh1 },
				style,
			]}
		>
			{keyLine ? (
				<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
					{stage ? (
						<StageDot stage={stage} />
					) : keyIcon ? (
						<Icon name={keyIcon} size={keyIconSize} color="accentText" />
					) : null}
					<Text variant="keyLine" color="ink3">
						{keyLine}
					</Text>
				</View>
			) : null}
			{title ? (
				<Text variant="heading" accessibilityRole="header" {...(dashed ? { align: "center" as const } : {})}>
					{title}
				</Text>
			) : null}
			{body ? (
				<Text
					variant="body"
					color="ink2"
					{...(dashed ? { align: "center" as const } : {})}
					{...(onBodyPress ? { onPress: onBodyPress, accessibilityRole: "link" as const } : {})}
				>
					{body}
				</Text>
			) : null}
			{children ? <View style={{ marginTop: 8, gap: 12, alignSelf: "stretch" }}>{children}</View> : null}
		</Box>
	);
}

/** A plain card: surface, 1 dp line, 16 dp corners, 20 dp padding, 10 dp gap. `focused` adds B17's 2 dp accent ring. */
export function Card({
	children,
	focused = false,
	padding = 20,
	gap = 10,
	tone = "surface",
	style,
}: {
	children: ReactNode;
	focused?: boolean | undefined;
	/** `infoSoft`: the question and remember cards (B16, C2): info-soft fill, the 1 dp border transparent. */
	tone?: "surface" | "infoSoft" | undefined;
	padding?: number | undefined;
	gap?: number | undefined;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	return (
		<Box
			component="Card"
			bg={tone}
			radius={radius.xl}
			style={[
				{ borderWidth: 1, borderColor: tone === "infoSoft" ? "transparent" : colors.line, padding, gap },
				focused ? { boxShadow: `0px 0px 0px 2px ${colors.accent}` } : null,
				style,
			]}
		>
			{children}
		</Box>
	);
}

/** B16 and C2's question card on info-soft, with its choice buttons. */
export function QuestionCard({
	question,
	children,
	padding = 20,
	gap = 12,
}: {
	question: string;
	children?: ReactNode | undefined;
	padding?: number | undefined;
	gap?: number | undefined;
}) {
	return (
		<Box component="Card" bg="infoSoft" radius={radius.xl} style={{ padding, gap }}>
			<Text variant="label" style={{ fontSize: 16, lineHeight: 24 }}>
				{question}
			</Text>
			{children}
		</Box>
	);
}

/** A 48 dp choice inside a question card. */
export function ChoiceButton({
	label,
	onPress,
	selected = false,
}: {
	label: string;
	onPress?: (() => void) | undefined;
	selected?: boolean | undefined;
}) {
	return (
		<Touch onPress={onPress} accessibilityLabel={label} accessibilityState={{ selected }}>
			<Box
				component="ChoiceButton"
				bg="raised"
				radius={radius.md}
				style={{ height: 48, paddingStart: 14, paddingEnd: 14, justifyContent: "center" }}
			>
				<Ring color={selected ? "accent" : "line2"} radius={radius.md} />
				<Text variant="textLink" weight={400} numberOfLines={1}>
					{label}
				</Text>
			</Box>
		</Touch>
	);
}

/** J2's board card: company, role and the next date. The lifted look belongs to ReorderList's drag state. */
export function BoardCard({
	company,
	role,
	next,
	onPress,
	onLongPress,
}: {
	company: string;
	role: string;
	next?: string | undefined;
	onPress?: (() => void) | undefined;
	onLongPress?: (() => void) | undefined;
}) {
	const { colors } = useTheme();
	return (
		<Touch
			onPress={onPress}
			{...(onLongPress ? { onLongPress, longPressHaptic: null } : {})}
			accessibilityLabel={`${company}, ${role}`}
		>
			<Box
				component="BoardCard"
				bg="surface"
				radius={radius.xl}
				style={{ borderWidth: 1, borderColor: colors.line, padding: 16, gap: 4 }}
			>
				<Text variant="rowTitle" weight={600} numberOfLines={1}>
					{company}
				</Text>
				<Text variant="ui" color="ink3" numberOfLines={1}>
					{role}
				</Text>
				{next ? (
					<View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
						<Icon name="calendar-blank" size={16} color="ink2" />
						<Text variant="keyLine" color="ink2">
							{next}
						</Text>
					</View>
				) : null}
			</Box>
		</Touch>
	);
}

/** Tag and suggestion chips: 32 dp, 1 dp line-2 ring; `dashed` for the add chip; `on` for a chosen suggestion. */
export function Chip({
	label,
	icon,
	trailingIcon,
	onPress,
	dashed = false,
	on = false,
	testID,
}: {
	label: string;
	icon?: IconName | undefined;
	/** A 16 dp icon after the label (D5's filter chips: `caret-down`). */
	trailingIcon?: IconName | undefined;
	onPress?: (() => void) | undefined;
	dashed?: boolean | undefined;
	on?: boolean | undefined;
	testID?: string | undefined;
}) {
	const fg: ColorToken = on ? "accentText" : dashed ? "ink3" : "ink2";
	return (
		<Touch
			onPress={onPress}
			accessibilityLabel={label}
			accessibilityState={{ selected: on }}
			hitSlop={hitSlopFor(48, 32)}
			{...(testID ? { testID } : {})}
		>
			<Box
				component="Chip"
				ownsText
				radius={radius.sm}
				{...(on ? { bg: "accentSoft" as const } : {})}
				style={{ height: 32, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 6 }}
			>
				{on ? null : <Ring color="line2" radius={radius.sm} dashed={dashed} />}
				{icon ? <Icon name={icon} size={16} color={fg} /> : null}
				<Text variant="chip" color={fg} numberOfLines={1}>
					{label}
				</Text>
				{trailingIcon ? <Icon name={trailingIcon} size={16} color={fg} /> : null}
			</Box>
		</Touch>
	);
}

/** A composer context chip: the whole chip removes it. */
export function ContextChip({
	label,
	icon,
	onRemove,
}: {
	label: string;
	icon?: IconName | undefined;
	onRemove?: (() => void) | undefined;
}) {
	return (
		<Touch onPress={onRemove} accessibilityLabel={`Remove ${label}`} hitSlop={hitSlopFor(48, 32)}>
			<Box
				component="Chip"
				bg="sunken"
				radius={radius.sm}
				style={{ height: 32, paddingStart: 10, paddingEnd: 6, flexDirection: "row", alignItems: "center", gap: 6 }}
			>
				{/* B16 and C2 dumps: tagged Chip, 16 dp icons, 12/18 text. */}
				{icon ? <Icon name={icon} size={16} color="ink2" /> : null}
				<Text variant="caption" color="ink2" numberOfLines={1} style={{ lineHeight: 18 }}>
					{label}
				</Text>
				<Icon name="x" size={16} color="ink2" />
			</Box>
		</Touch>
	);
}

/** "Used in 3 applications": 24 dp, 1 dp line-2 ring. */
export function UsedChip({ label, icon }: { label: string; icon?: IconName | undefined }) {
	return (
		<Box
			component="UsedChip"
			radius={radius.xs}
			style={{
				height: 24,
				paddingHorizontal: 8,
				flexDirection: "row",
				alignItems: "center",
				gap: 4,
				alignSelf: "flex-start",
			}}
		>
			<Ring color="line2" radius={radius.xs} />
			{icon ? <Icon name={icon} size={14} color="ink2" /> : null}
			<Text variant="caption" color="ink2">
				{label}
			</Text>
		</Box>
	);
}

export type BadgeTone = "accent" | "warn" | "info" | "danger" | "neutral" | "outline";
const badgeTones: Record<BadgeTone, { bg?: ColorToken | undefined; fg: ColorToken }> = {
	accent: { bg: "accentSoft", fg: "accentText" },
	warn: { bg: "warnSoft", fg: "warnText" },
	info: { bg: "infoSoft", fg: "infoText" },
	danger: { bg: "dangerSoft", fg: "dangerText" },
	neutral: { bg: "sunken", fg: "ink2" },
	outline: { fg: "ink2" },
};

export function Badge({
	label,
	tone = "neutral",
	icon,
	leading,
}: {
	label: string;
	tone?: BadgeTone;
	icon?: IconName | undefined;
	leading?: ReactNode | undefined;
}) {
	const t = badgeTones[tone];
	return (
		<Box
			component="Badge"
			radius={radius.xs}
			{...(t.bg ? { bg: t.bg } : {})}
			style={{
				height: 20,
				paddingHorizontal: 6,
				flexDirection: "row",
				alignItems: "center",
				gap: 4,
				alignSelf: "flex-start",
			}}
		>
			{tone === "outline" ? <Ring color="line2" radius={radius.xs} /> : null}
			{leading ?? (icon ? <Icon name={icon} size={14} color={t.fg} /> : null)}
			<Text variant="caption" color={t.fg} numberOfLines={1}>
				{label}
			</Text>
		</Box>
	);
}

/** B17's 20 × 20 number tag. */
export function NumberTag({ n, decided = false }: { n: number; decided?: boolean | undefined }) {
	return (
		<Box
			component="NumberTag"
			bg={decided ? "sunken" : "accent"}
			radius={radius.xs}
			style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
		>
			<Text
				variant="mono"
				color={decided ? "ink2" : "onAccent"}
				style={{ lineHeight: 20, fontFamily: fonts.mono, fontWeight: "600" }}
				maxFontSizeMultiplier={1.3}
			>
				{n}
			</Text>
		</Box>
	);
}

/** B9 and B18's 24 × 24 check marker; answers to 44 pt on iOS and 48 dp on Android. */
export function IssueMarker({
	n,
	onPress,
	label,
	numberTagged = true,
}: {
	n: number;
	onPress?: (() => void) | undefined;
	label?: string | undefined;
	/** False where the page's own text already reports the number (B18's storyboard page). */
	numberTagged?: boolean | undefined;
}) {
	const body = (
		<Box
			component="IssueMarker"
			bg="warn"
			radius={radius.xs}
			style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}
		>
			<Text
				variant="mono"
				color="warnInk"
				style={{ lineHeight: 24, fontWeight: "600" }}
				maxFontSizeMultiplier={1.3}
				tag={numberTagged}
			>
				{n}
			</Text>
		</Box>
	);
	if (!onPress) return body;
	return (
		<Touch onPress={onPress} accessibilityLabel={label ?? `Issue ${n}`} hitSlop={hitSlopFor(24, 24)}>
			{body}
		</Touch>
	);
}

/** Still placeholder at the final size (MOTION.md §8): sunken, no shimmer. */
export function Skeleton({
	width,
	height,
	radius: r = radius.xs,
	style,
}: {
	width?: number | `${number}%`;
	height: number;
	radius?: number | undefined;
	style?: StyleProp<ViewStyle>;
}) {
	const { colors } = useTheme();
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no"
			style={[{ width: width ?? "100%", height, borderRadius: r, backgroundColor: colors.sunken }, style]}
		/>
	);
}

/**
 * Proposal text: removed words struck through in ink-2, added words on accent-soft with 2 dp padding at each end
 * (`.add`, COMPONENTS.md §13). The layout dump lists the unchanged words as the paragraph's text and each removed or
 * added run as its own text, with the run's line box (one line: its glyphs; several: the full lines it covers).
 */
export function ProposalText({ parts }: { parts: ProposalPart[] }) {
	const plain = parts
		.filter((p) => !p.kind || p.kind === "same")
		.map((p) => p.text)
		.join("");
	const ref = useDesignTag({ kind: "text", text: plain, style: typeScale.body, color: "ink" });
	return (
		<View ref={ref} collapsable={false}>
			<Text variant="body" tag={false}>
				<Runs parts={parts} />
			</Text>
			{Platform.OS === "android"
				? parts.map((p, i) => (p.kind === "removed" ? <StrikeLines key={i} parts={parts} index={i} /> : null))
				: null}
			{STORYBOARD
				? parts.map((p, i) =>
						p.kind === "removed" || p.kind === "added" ? (
							<RunTag key={i} parts={parts} index={i} color={p.kind === "removed" ? "ink2" : "ink"} />
						) : null,
					)
				: null}
		</View>
	);
}

type ProposalPart = { text: string; kind?: "same" | "removed" | "added" };

/**
/**
 * 2 dp of inline padding (nested Text takes no padding). iOS: an invisible separator (U+2063, breaks like a letter) with
 * 2 dp letter spacing; a zero-width space let the line break after it, leaving an empty highlight at a line's end (B4).
 * Android gives such characters (not in Figtree, a default-ignorable fallback glyph) no advance and no spacing, so B4's
 * added runs drew 2 dp left: there it is a no-break space (0.247 em in Figtree) sized to advance exactly 2 dp.
 */
const pad =
	Platform.OS === "android" ? (
		<RNText style={{ fontSize: 2 / 0.247, letterSpacing: 0 }}>{"\u00A0"}</RNText>
	) : (
		<RNText style={{ letterSpacing: 2 }}>{"\u2063"}</RNText>
	);

/** Android draws the strike-through itself (`StrikeLines`). */
const strike = Platform.OS === "android" ? "none" : "line-through";

/** The parts as nested runs; `upto` stops before that part, `lead` adds the start of the next one. */
function Runs({ parts, upto, lead }: { parts: ProposalPart[]; upto?: number; lead?: string }) {
	const { colors } = useTheme();
	const shown = upto === undefined ? parts : parts.slice(0, upto);
	return (
		<>
			{shown.map((p, i) =>
				p.kind === "removed" ? (
					<RNText key={i} style={{ color: colors.ink2, textDecorationLine: strike }}>
						{p.text}
					</RNText>
				) : p.kind === "added" ? (
					<RNText key={i} style={{ backgroundColor: colors.accentSoft }}>
						{pad}
						{p.text}
						{pad}
					</RNText>
				) : (
					p.text
				),
			)}
			{lead}
		</>
	);
}

type LineEnd = { line: number; x: number };
type Line = { x: number; width: number };
const lastLine = (lines: Line[]): LineEnd => {
	const last = lines[lines.length - 1];
	return { line: Math.max(0, lines.length - 1), x: last ? last.x + last.width : 0 };
};

/**
 * Where a run's glyphs start and end inside its paragraph, from invisible probes of the paragraph's prefixes (they
 * break lines greedily, as Text does, so prefixes wrap like the whole). `lines` are the lines up to the run's end.
 */
function useRunExtent(parts: ProposalPart[], index: number) {
	const body = typeScale.body;
	const part = parts[index];
	const text = part?.text ?? "";
	const padded = part?.kind === "added";
	const [measured, setStart] = useState<LineEnd | null>(null);
	const [lines, setLines] = useState<Line[] | null>(null);
	const [wrapLine, setWrapLine] = useState(0);
	const start = measured && wrapLine > measured.line ? { line: wrapLine, x: padded ? 2 : 0 } : measured;
	const end = lines ? lastLine(lines) : null;
	const probe = [textDefaults, body, { position: "absolute" as const, left: 0, right: 0, top: 0, opacity: 0 }];
	const firstWord = text.split(/\s/)[0] ?? "";
	const lead = padded ? (Platform.OS === "android" ? "\u200B" : "\u2063") : "";
	const probes = (
		<>
			<RNText style={probe} textBreakStrategy="simple" onTextLayout={(e) => setStart(lastLine(e.nativeEvent.lines))}>
				<Runs parts={parts} upto={index} />
				{padded ? pad : null}
			</RNText>
			{/* With the run's first word: a run that wraps whole starts at the next line's edge. */}
			<RNText
				style={probe}
				textBreakStrategy="simple"
				onTextLayout={(e) => setWrapLine(lastLine(e.nativeEvent.lines).line)}
			>
				<Runs parts={parts} upto={index} lead={lead + firstWord} />
			</RNText>
			<RNText style={probe} textBreakStrategy="simple" onTextLayout={(e) => setLines(e.nativeEvent.lines)}>
				<Runs parts={parts} upto={index} />
				{padded ? pad : null}
				{text}
			</RNText>
		</>
	);
	return { start, end, lines, probes };
}

/** Storyboard only: tags a run's box (one line: its glyphs; several: the full lines it covers). */
function RunTag({ parts, index, color }: { parts: ProposalPart[]; index: number; color: ColorToken }) {
	const body = typeScale.body;
	const { start, end, probes } = useRunExtent(parts, index);
	const box =
		start && end
			? start.line === end.line
				? { left: start.x, top: start.line * body.lineHeight, width: end.x - start.x, height: body.lineHeight }
				: {
						left: 0,
						right: 0,
						top: start.line * body.lineHeight,
						height: (end.line - start.line + 1) * body.lineHeight,
					}
			: null;
	const ref = useDesignTag({ kind: "text", text: parts[index]?.text ?? "", style: body, color }, { hidden: !box });
	return (
		<>
			{probes}
			<View
				ref={ref}
				collapsable={false}
				pointerEvents="none"
				style={[{ position: "absolute" }, box ?? { width: 0 }]}
			/>
		</>
	);
}

/**
 * Android only: the removed run's strike-through, drawn as 1 dp ink-2 lines through the middle of each line it covers
 * (the boards' position). React Native 0.88 on Android drops a nested Text's line-through once its paragraph also holds
 * a background run (B17: struck and added runs together); the same paragraph without the added run draws it.
 */
function StrikeLines({ parts, index }: { parts: ProposalPart[]; index: number }) {
	const { colors } = useTheme();
	const { lineHeight } = typeScale.body;
	const { start, end, lines, probes } = useRunExtent(parts, index);
	const segments: { line: number; x1: number; x2: number }[] = [];
	if (start && end && lines)
		for (let line = start.line; line <= end.line; line++) {
			const l = lines[line];
			if (!l) continue;
			segments.push({
				line,
				x1: line === start.line ? start.x : l.x,
				x2: line === end.line ? end.x : l.x + l.width,
			});
		}
	return (
		<>
			{probes}
			{segments.map((g) => (
				<View
					key={g.line}
					pointerEvents="none"
					style={{
						position: "absolute",
						top: g.line * lineHeight + lineHeight / 2,
						left: g.x1,
						width: Math.max(0, g.x2 - g.x1),
						height: 1,
						backgroundColor: colors.ink2,
					}}
				/>
			))}
		</>
	);
}
