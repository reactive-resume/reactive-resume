import type { PipelineStep } from "./insights";
import type { ReactNode } from "react";
import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useRef, useState } from "react";
import { RefreshControl, I18nManager, ScrollView, View } from "react-native";
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop, Text as SvgText } from "react-native-svg";
import { weekStartsOn } from "./calendar";
import { computeOutcomes, computePipeline, computeTimeline, countSources } from "./insights";
import { useApplicationSearch } from "./search";
import { ApplicationsViewFrame } from "./views";
import { useDocuments, useNow, useUserTime } from "@/features/application-detail/hooks";
import { applicationError } from "@/features/applications/error";
import { filterApplications } from "@/features/applications/list";
import { useApplications } from "@/features/applications/queries";
import { getStageColor, getStageLabel } from "@/features/applications/stages";
import { useIsTablet } from "@/shell/use-is-tablet";
import { Banner, Button, Card, Skeleton, Text, showToast, useTheme } from "@/ui";
import { usePullRefresh } from "@/ui/use-pull-refresh";

const BAR_HEIGHT = 18;
const WEEK_CHART_HEIGHT = 112;

export function InsightsScreen() {
	return (
		<ApplicationsViewFrame current="insights">
			<ApplicationInsights />
		</ApplicationsViewFrame>
	);
}

/** How far applications get, replies, tailored resumes, sending pace and sources (web Insights view). */
function ApplicationInsights() {
	const { t, i18n } = useLingui();
	const { colors, space } = useTheme();
	const tablet = useIsTablet();
	const query = useApplications();
	const pull = usePullRefresh(query.refetch);
	const { search } = useApplicationSearch();
	const documents = useDocuments();
	const { timeZone } = useUserTime();
	const now = useNow();

	if (query.isError) {
		return (
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Banner tone="warn" message={applicationError(query.error)} />
				<Button label={t`Retry loading applications`} onPress={() => void query.refetch()} />
			</View>
		);
	}
	if (query.isPending) {
		return (
			<View style={{ padding: space.s4, gap: space.s3 }}>
				<Skeleton height={space.s12 * 4} />
				<Skeleton height={space.s12 * 2} />
			</View>
		);
	}

	const applications = filterApplications(query.data, { search, tag: "", showClosed: true });
	// A resume is tailored for an application when it was made for it (Copy for a job).
	const madeFor = new Map(
		(documents.data ?? []).flatMap((document) =>
			document.application ? [[document.id, document.application.id]] : [],
		),
	);
	const outcomes = computeOutcomes(applications, (application) =>
		Boolean(application.resumeId && madeFor.get(application.resumeId) === application.id),
	);
	const timeline = computeTimeline(applications, { now, timeZone, weekStartsOn: weekStartsOn(i18n.locale) });
	const sources = countSources(applications);
	const pipeline = computePipeline(applications);
	const widest = Math.max(1, ...outcomes.funnel.map((row) => row.reached));
	const maxWeek = Math.max(1, ...timeline.map((bucket) => bucket.count));
	const maxSource = Math.max(1, ...sources.map((row) => row.count));
	const weekLabel = new Intl.DateTimeFormat(i18n.locale, { timeZone: "UTC", month: "numeric", day: "numeric" });
	const half = tablet ? { flexBasis: 0, flexGrow: 1 } : null;

	if (outcomes.sent === 0) {
		return (
			<Text color="ink2" align="center" style={{ padding: space.s8 }}>
				{t`Once you've sent a few applications, this shows how far they get and how quickly people reply.`}
			</Text>
		);
	}

	return (
		<>
			<ScrollView
				alwaysBounceVertical
				refreshControl={<RefreshControl {...pull} tintColor={colors.accent} colors={[colors.accent]} />}
				contentContainerStyle={{ padding: space.s4, gap: space.s4 }}
			>
				<Section
					title={t`How far applications get`}
					note={t`Counts every application that reached each stage, including ones now closed.`}
				>
					{outcomes.funnel.map((row) => (
						<HorizontalBar
							key={row.status}
							label={getStageLabel(row.status)}
							value={row.reached}
							fraction={row.reached / widest}
							colorOf={(colors) => getStageColor(row.status, colors)}
							dot
						/>
					))}
				</Section>

				<View style={{ flexDirection: tablet ? "row" : "column", gap: space.s4 }}>
					<Card style={half}>
						<Text variant="display">{`${Math.round((outcomes.heardBack / outcomes.sent) * 100)}%`}</Text>
						<Text color="ink2">{t`heard back`}</Text>
					</Card>
					<Card style={half}>
						<Text variant="display">
							{outcomes.medianDaysToReply === null
								? "—"
								: plural(outcomes.medianDaysToReply, { one: "# day", other: "# days" })}
						</Text>
						<Text color="ink2">{t`median to first reply`}</Text>
					</Card>
				</View>

				{outcomes.tailored.sent + outcomes.base.sent > 0 ? (
					<Section title={t`Tailored vs. base resume`}>
						<Text color="ink2">
							{t`${outcomes.tailored.replied} of ${outcomes.tailored.sent} tailored applications got a reply; ${outcomes.base.replied} of ${outcomes.base.sent} sent with another resume.`}
						</Text>
						{outcomes.tailored.sent + outcomes.base.sent < 10 ? (
							<Text variant="callout" color="ink3">{t`Small numbers, but worth noticing.`}</Text>
						) : null}
					</Section>
				) : null}

				<View style={{ flexDirection: tablet ? "row" : "column", gap: space.s4 }}>
					<Section title={t`Applications over time`} note={t`Applications sent per week (last 8 weeks)`} style={half}>
						<WeekBars
							counts={timeline.map((bucket) => bucket.count)}
							labels={timeline.map((bucket) => weekLabel.format(new Date(`${bucket.start}T00:00:00Z`)))}
							max={maxWeek}
						/>
					</Section>
					<Section title={t`Where applications come from`} note={t`Count by source`} style={half}>
						{sources.length === 0 ? (
							<Text color="ink3">{t`No source data yet.`}</Text>
						) : (
							sources.map((row) => (
								<HorizontalBar
									key={row.source}
									label={row.source}
									value={row.count}
									fraction={Math.max(row.count / maxSource, 0.03)}
									colorOf={(colors) => colors.ink2}
								/>
							))
						)}
					</Section>
				</View>

				<PipelineFlow active={pipeline.active} closed={pipeline.closed} steps={pipeline.steps} />
			</ScrollView>
		</>
	);
}

type SectionProps = { title: string; note?: string | undefined; children: ReactNode; style?: object | null };

function Section({ title, note, children, style }: SectionProps) {
	const { space } = useTheme();
	return (
		<Card style={[{ gap: space.s3 }, style]}>
			<View style={{ gap: space.s0 }}>
				<Text variant="title" accessibilityRole="header">
					{title}
				</Text>
				{note ? (
					<Text variant="callout" color="ink3">
						{note}
					</Text>
				) : null}
			</View>
			{children}
		</Card>
	);
}

type Theme = ReturnType<typeof useTheme>;

type HorizontalBarProps = {
	label: string;
	value: number;
	/** 0–1 of the track. */
	fraction: number;
	colorOf: (colors: Theme["colors"]) => string;
	/** A stage dot before the label. */
	dot?: boolean;
};

/** Label, a bar drawn in SVG (from the start edge, so it mirrors in RTL) and the count. */
function HorizontalBar({ label, value, fraction, colorOf, dot }: HorizontalBarProps) {
	const { colors, radius, space } = useTheme();
	const percent = Math.round(Math.min(1, fraction) * 100);
	return (
		<View
			accessible
			accessibilityLabel={`${label}: ${value}`}
			style={{ flexDirection: "row", alignItems: "center", gap: space.s2 }}
		>
			<View style={{ width: space.s12 * 2, flexDirection: "row", alignItems: "center", gap: space.s1 }}>
				{dot ? (
					<View
						style={{ width: space.s2, height: space.s2, borderRadius: radius.rLg, backgroundColor: colorOf(colors) }}
					/>
				) : null}
				<Text variant="callout" color="ink2" numberOfLines={1} style={{ flexShrink: 1 }}>
					{label}
				</Text>
			</View>
			<Svg height={BAR_HEIGHT} style={{ flex: 1 }}>
				<Rect width="100%" height={BAR_HEIGHT} rx={radius.rSm} fill={colors.sunken} />
				<Rect
					x={I18nManager.isRTL ? `${100 - percent}%` : 0}
					width={`${percent}%`}
					height={BAR_HEIGHT}
					rx={radius.rSm}
					fill={colorOf(colors)}
				/>
			</Svg>
			<Text variant="label" align="right" style={{ minWidth: space.s6 }}>
				{value}
			</Text>
		</View>
	);
}

type WeekBarsProps = { counts: number[]; labels: string[]; max: number };

/** One column per week; counts above, week starts below (RN text, so they scale with Dynamic Type). */
function WeekBars({ counts, labels, max }: WeekBarsProps) {
	const { colors, space } = useTheme();
	const slot = 10;
	return (
		<View
			accessible
			accessibilityLabel={counts.map((count, i) => `${labels[i]}: ${count}`).join(", ")}
			style={{ gap: space.s1 }}
		>
			<View style={{ flexDirection: "row" }}>
				{counts.map((count, i) => (
					<Text key={labels[i]} variant="micro" color="ink3" align="center" style={{ flex: 1 }}>
						{count || ""}
					</Text>
				))}
			</View>
			<Svg
				width="100%"
				height={WEEK_CHART_HEIGHT}
				viewBox={`0 0 ${counts.length * slot} 100`}
				preserveAspectRatio="none"
				style={I18nManager.isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
			>
				{counts.map((count, i) => {
					const height = count ? Math.max((count / max) * 100, 8) : 0;
					return (
						<Rect
							key={labels[i]}
							x={i * slot + 2}
							y={100 - height}
							width={slot - 4}
							height={height}
							fill={colors.accent}
						/>
					);
				})}
			</Svg>
			<View style={{ flexDirection: "row" }}>
				{labels.map((label) => (
					<Text key={label} variant="micro" color="ink3" align="center" style={{ flex: 1 }}>
						{label}
					</Text>
				))}
			</View>
		</View>
	);
}

type PipelineFlowProps = { active: number; closed: number; steps: PipelineStep[] };

// The flow chart's drawing units (web PipelineFlow): bars on a mid line, bands joining them.
const FLOW = { width: 800, height: 340, padX: 40, midY: 190, maxBar: 150, bar: 34 } as const;

/**
 * Where active applications went, as a shareable picture (web "Pipeline flow"), with the stage totals as text for
 * screen readers. Share PNG renders the SVG to an image and opens the system share sheet.
 */
function PipelineFlow({ active, closed, steps }: PipelineFlowProps) {
	const { t } = useLingui();
	const { colors, fonts, space } = useTheme();
	const svg = useRef<Svg>(null);
	const [sharing, setSharing] = useState(false);
	const slot = (FLOW.width - FLOW.padX * 2) / steps.length;
	const maxReached = Math.max(1, ...steps.map((step) => step.reached));
	const bars = steps.map((step, i) => {
		const height = Math.max((step.reached / maxReached) * FLOW.maxBar, 4);
		const x = FLOW.padX + slot * i + slot / 2 - FLOW.bar / 2;
		return {
			...step,
			x,
			top: FLOW.midY - height / 2,
			height,
			cx: x + FLOW.bar / 2,
			color: getStageColor(step.status, colors),
		};
	});
	const transitions = steps.slice(1).map((step, i) => {
		const from = steps[i];
		return from
			? t`${getStageLabel(from.status)} → ${getStageLabel(step.status)}: ${step.reached}${step.conversion === null ? "" : ` (${step.conversion}%)`}`
			: "";
	});

	const share = () => {
		if (sharing || !svg.current) return;
		setSharing(true);
		svg.current.toDataURL(
			(base64) => {
				void sharePng(base64)
					.catch(() => showToast({ message: t`Couldn't share the picture. Try again.` }))
					.finally(() => setSharing(false));
			},
			{ width: FLOW.width * 2, height: FLOW.height * 2 },
		);
	};

	return (
		<Card style={{ gap: space.s3 }}>
			<View style={{ flexDirection: "row", alignItems: "center", gap: space.s3 }}>
				<Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
					{t`Where your applications went`}
				</Text>
				<Button
					variant="secondary"
					size="sm"
					icon="share-network"
					label={t`Share PNG`}
					loading={sharing}
					onPress={share}
				/>
			</View>
			<View accessible accessibilityRole="image" accessibilityLabel={t`Pipeline flow`}>
				<Svg
					ref={svg}
					width="100%"
					viewBox={`0 0 ${FLOW.width} ${FLOW.height}`}
					style={{ aspectRatio: FLOW.width / FLOW.height }}
				>
					<Defs>
						{bars.slice(0, -1).map((bar, i) => (
							<LinearGradient key={bar.status} id={`flow-${i}`} x1="0" y1="0" x2="1" y2="0">
								<Stop offset="0" stopColor={bar.color} />
								<Stop offset="1" stopColor={bars[i + 1]?.color ?? bar.color} />
							</LinearGradient>
						))}
					</Defs>
					<Rect width={FLOW.width} height={FLOW.height} rx={16} fill={colors.surface} />
					<SvgText x={FLOW.padX} y={40} fontSize={17} fontFamily={fonts.ui[700]} fill={colors.ink}>
						{t`Job search pipeline`}
					</SvgText>
					<SvgText x={FLOW.padX} y={60} fontSize={12} fontFamily={fonts.ui[400]} fill={colors.ink3}>
						{plural(active, { one: "# active application", other: "# active applications" })}
					</SvgText>
					{closed > 0 ? (
						<>
							<Circle cx={FLOW.width - FLOW.padX - 96} cy={54} r={4} fill={colors.stageClosed} />
							<SvgText
								x={FLOW.width - FLOW.padX - 86}
								y={58}
								fontSize={12}
								fontFamily={fonts.ui[400]}
								fill={colors.ink2}
							>
								{t`${closed} closed`}
							</SvgText>
						</>
					) : null}
					{/* Bands run centre to centre behind the bars, so the flow has no seam at each stage. */}
					{bars.slice(0, -1).map((bar, i) => {
						const next = bars[i + 1];
						if (!next) return null;
						const mid = (bar.cx + next.cx) / 2;
						return (
							<Path
								key={bar.status}
								d={`M${bar.cx},${bar.top} C${mid},${bar.top} ${mid},${next.top} ${next.cx},${next.top} L${next.cx},${next.top + next.height} C${mid},${next.top + next.height} ${mid},${bar.top + bar.height} ${bar.cx},${bar.top + bar.height} Z`}
								fill={`url(#flow-${i})`}
								opacity={0.32}
							/>
						);
					})}
					{bars.map((bar, i) => (
						<G key={bar.status}>
							<Rect x={bar.x} y={bar.top} width={FLOW.bar} height={bar.height} rx={6} fill={bar.color} />
							<SvgText
								x={bar.cx}
								y={bar.top - 10}
								textAnchor="middle"
								fontSize={15}
								fontFamily={fonts.ui[700]}
								fill={colors.ink}
							>
								{bar.reached}
							</SvgText>
							<SvgText
								x={bar.cx}
								y={FLOW.height - 42}
								textAnchor="middle"
								fontSize={12}
								fontFamily={fonts.ui[500]}
								fill={colors.ink2}
							>
								{getStageLabel(bar.status)}
							</SvgText>
							{i > 0 && bar.conversion !== null ? (
								<SvgText
									x={bar.cx}
									y={FLOW.height - 26}
									textAnchor="middle"
									fontSize={11}
									fontFamily={fonts.ui[400]}
									fill={colors.ink3}
								>
									{`${bar.conversion}%`}
								</SvgText>
							) : null}
						</G>
					))}
				</Svg>
			</View>
			<View style={{ gap: space.s1 }}>
				{transitions.map((line) => (
					<Text key={line} variant="callout" color="ink2">
						{line}
					</Text>
				))}
				{closed > 0 ? (
					<Text variant="callout" color="ink2">
						{t`Closed: ${closed}`}
					</Text>
				) : null}
			</View>
		</Card>
	);
}

/** Recipients can read the file once shareAsync resolves; the previous picture is swept on the next share. */
async function sharePng(base64: string) {
	for (const entry of Paths.cache.list()) {
		if (entry instanceof File && /^pipeline-flow-\d+\.png$/.test(entry.name)) entry.delete();
	}
	if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
	const file = new File(Paths.cache, `pipeline-flow-${Date.now()}.png`);
	file.write(base64, { encoding: "base64" });
	await Sharing.shareAsync(file.uri, { mimeType: "image/png", UTI: "public.png" });
}
