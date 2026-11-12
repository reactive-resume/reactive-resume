import type { ApplicationSummary } from "../types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
import type { ReactNode } from "react";
import { i18n } from "@lingui/core";
import { plural, t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Skeleton } from "@reactive-resume/ui/components/skeleton";
import { toast } from "@reactive-resume/ui/components/toast";
import { fitLabel } from "@reactive-resume/utils/string";
import { cn } from "@reactive-resume/utils/style";
import { resolveExportTokens } from "../flow-tokens";
import { computeOutcomes, computeTimeline, countSources } from "../insights";
import { getCategoryLane, getLaneLabel, laneDotColor } from "../lanes";
import { getStageColor } from "../stages";
import { useApplicationLanes } from "../use-application-lanes";
import { List, ListRow } from "@/components/calm/list-row";
import { Columns } from "@/components/calm/page";
import { SectionHeading } from "@/components/calm/section-heading";
import { StageDot } from "@/components/calm/stage-dot";
import { useNow } from "@/features/career/shared";
import { stagger } from "@/libs/motion";
import { orpc } from "@/libs/orpc/client";

// Charts need a few applications to say anything.
const CHARTS_FROM = 3;

/** The page's shape while applications load: the three figures, then the charts. */
export function InsightsSkeleton() {
	return (
		<div className="flex flex-col gap-8 pt-6">
			<Skeleton className="h-[58px] max-w-2xl" />
			<Skeleton className="h-56" />
		</div>
	);
}

type FunnelRow = { status: ApplicationStatus; label: string; color: string | undefined; reached: number };

type ApplicationInsightsProps = {
	/** Every application: the charts never follow the list's filters. */
	applications: ApplicationSummary[];
};

/**
 * How the search is going, in real numbers: three figures, one funnel of the stages applications reached (closed
 * ones included), applications sent per week, where they came from, and whether tailored resumes got more replies.
 * Under three sent applications only the figures show, with a line saying when the charts appear.
 */
export function ApplicationInsights({ applications }: ApplicationInsightsProps) {
	const { data: documents } = useQuery(orpc.documents.list.queryOptions({ input: { trashed: false } }));
	const { lanes } = useApplicationLanes();
	const now = useNow();

	// A resume is tailored for an application when it was made for it (Copy for a job).
	const madeFor = new Map(
		(documents ?? []).flatMap((document) => (document.application ? [[document.id, document.application.id]] : [])),
	);
	const outcomes = computeOutcomes(applications, (application) =>
		Boolean(application.resumeId && madeFor.get(application.resumeId) === application.id),
	);
	const active = applications.filter((application) => application.status !== "closed").length;
	const closed = applications.length - active;

	// Every application was saved first; the rest of the funnel is what each one ever reached.
	const funnel: FunnelRow[] = [{ status: "saved" as const, reached: applications.length }, ...outcomes.funnel].map(
		(row) => {
			const lane = getCategoryLane(lanes, row.status);
			return { ...row, label: getLaneLabel(lane), color: laneDotColor(lane) };
		},
	);
	// Sending history includes applications that later closed, and excludes jobs never sent.
	const timeline = computeTimeline(applications, i18n.locale, 8, now);
	const maxWeek = Math.max(1, ...timeline.map((bucket) => bucket.count));
	const sources = countSources(applications);
	const compared = outcomes.tailored.sent >= CHARTS_FROM && outcomes.base.sent >= CHARTS_FROM;
	const flowRef = useRef<SVGSVGElement>(null);

	return (
		<div>
			<dl className="grid gap-x-12 gap-y-6 pt-6 sm:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_360px]">
				<Stat value={i18n.number(active)}>
					<Plural value={active} one="active application" other="active applications" />
				</Stat>
				<Stat
					value={
						outcomes.sent > 0 ? (
							<Trans>
								{i18n.number(outcomes.heardBack)} of {i18n.number(outcomes.sent)}
							</Trans>
						) : (
							i18n.number(0)
						)
					}
				>
					<Trans>heard back</Trans>
				</Stat>
				<Stat
					value={
						outcomes.medianDaysToReply === null ? (
							<Trans>No replies yet</Trans>
						) : (
							<Plural value={outcomes.medianDaysToReply} one="# day" other="# days" />
						)
					}
				>
					<Trans>median to first reply</Trans>
				</Stat>
			</dl>

			{outcomes.sent < CHARTS_FROM ? (
				<p className="pt-8 text-[13px]/[18px] text-ink-3">
					<Trans>Charts appear here once you've sent 3 applications.</Trans>
				</p>
			) : (
				<Columns
					aside={
						<>
							<SectionHeading>
								<Trans>Where they come from</Trans>
							</SectionHeading>
							{sources.length === 0 ? (
								<p className="text-[13px]/[18px] text-ink-3">
									<Trans>No source data yet.</Trans>
								</p>
							) : (
								<Meters
									nameWidth="140px"
									rows={sources.map((row) => ({ key: row.source, name: row.source, count: row.count }))}
								/>
							)}

							<List cap className="mt-8">
								<ListRow
									title={<Trans>Tailored vs base resume</Trans>}
									subtitle={compared ? undefined : <Trans>Not enough to compare yet: this needs 3 of each.</Trans>}
									className={cn(compared && "flex-wrap")}
								>
									{compared && (
										<div className="grid w-full gap-y-2 pb-1">
											<dl className="grid grid-cols-2 gap-6">
												<Stat
													value={
														<Trans>
															{i18n.number(outcomes.tailored.replied)} of {i18n.number(outcomes.tailored.sent)}
														</Trans>
													}
												>
													<Trans>tailored applications got a reply</Trans>
												</Stat>
												<Stat
													value={
														<Trans>
															{i18n.number(outcomes.base.replied)} of {i18n.number(outcomes.base.sent)}
														</Trans>
													}
												>
													<Trans>sent with another resume did</Trans>
												</Stat>
											</dl>
											{outcomes.tailored.sent + outcomes.base.sent < 10 && (
												<p className="text-[13px]/[18px] text-ink-3">
													<Trans>Small numbers, but worth noticing.</Trans>
												</p>
											)}
										</div>
									)}
								</ListRow>
							</List>
						</>
					}
				>
					<SectionHeading
						action={
							<Button
								size="sm"
								variant="ghost"
								className="self-center"
								onClick={() => void exportFlow(flowRef.current)}
							>
								<Icon name="download-simple" />
								<Trans>Export as image</Trans>
							</Button>
						}
					>
						<Trans>How far applications get</Trans>
					</SectionHeading>
					<Meters
						nameWidth="120px"
						label={t`Applications that reached each stage`}
						rows={funnel.map((row) => ({
							key: row.status,
							dot: (
								<StageDot status={row.status} color={row.color}>
									{null}
								</StageDot>
							),
							name: row.label,
							count: row.reached,
						}))}
					/>
					<p className="pt-2.5 text-[13px]/[18px] text-ink-3">
						{closed > 0 ? (
							<Plural
								value={closed}
								one="Counts every application that reached each stage, including the # now closed."
								other="Counts every application that reached each stage, including the # now closed."
							/>
						) : (
							<Trans>Counts every application that reached each stage.</Trans>
						)}
					</p>

					<SectionHeading note={<Trans>per week, last 8 weeks</Trans>}>
						<Trans>Applications sent</Trans>
					</SectionHeading>
					<div
						role="img"
						aria-label={t`Applications sent per week for the last 8 weeks: ${timeline
							.map((bucket) => `${bucket.label} ${i18n.number(bucket.count)}`)
							.join(", ")}`}
						className="mt-[22px] flex h-[72px] items-end gap-[47px] border-b border-line px-[23.5px]"
					>
						{timeline.map((bucket, index) =>
							bucket.count ? (
								<i
									key={bucket.label}
									className="relative block flex-1 origin-bottom rounded-t-[3px] bg-ink-3 transition-[scale] delay-(--stagger) duration-emphasized ease-enter motion-reduce:delay-0 starting:scale-y-0"
									style={{ ...stagger(index), height: `${(bucket.count / maxWeek) * 100}%` }}
								>
									<span className="absolute inset-x-0 -top-5 text-center font-mono text-xs/4 font-medium text-ink not-italic">
										{i18n.number(bucket.count)}
									</span>
								</i>
							) : (
								<i key={bucket.label} className="block h-0.5 flex-1 rounded-[1px] bg-line-2" />
							),
						)}
					</div>
					<div aria-hidden="true" className="flex pt-1.5">
						{timeline.map((bucket) => (
							<span
								key={bucket.label}
								className="min-w-0 flex-1 text-center font-mono text-xs/4 font-medium text-ink-3"
							>
								{bucket.label}
							</span>
						))}
					</div>

					<PipelineFlow ref={flowRef} funnel={funnel} active={active} closed={closed} />
				</Columns>
			)}
		</div>
	);
}

/** One figure of the stats row: a serif number over what it counts. */
function Stat({ value, children }: { value: ReactNode; children: ReactNode }) {
	return (
		<div className="flex flex-col-reverse">
			<dt className="text-[13px]/[18px] text-ink-3">
				<span>{children}</span>
			</dt>
			<dd className="font-display text-[34px]/10 text-ink">{value}</dd>
		</div>
	);
}

type MetersProps = {
	rows: { key: string; dot?: ReactNode; name: string; count: number }[];
	nameWidth: string;
	label?: string;
};

/** Flat rows of a name, a bar and a count. The bar is ink, never the stage colour: the name and the count say it. */
function Meters({ rows, nameWidth, label }: MetersProps) {
	const widest = Math.max(1, ...rows.map((row) => row.count));
	return (
		<ul aria-label={label}>
			{rows.map((row, index) => (
				<li
					key={row.key}
					className="grid h-10 items-center gap-4 border-b border-line text-sm last:border-b-0"
					style={{ gridTemplateColumns: `${nameWidth} minmax(0,1fr) 24px` }}
				>
					<span title={row.name} className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
						{row.dot}
						{row.name}
					</span>
					<span aria-hidden="true" className="flex h-2.5 overflow-hidden rounded-full bg-sunken">
						<i
							className="block origin-left rounded-full bg-ink-3 transition-[scale] delay-(--stagger) duration-emphasized ease-enter motion-reduce:delay-0 rtl:origin-right starting:scale-x-0"
							style={{ ...stagger(index), width: `${(row.count / widest) * 100}%` }}
						/>
					</span>
					<span className="text-end font-mono text-[13px]/4 font-medium">{i18n.number(row.count)}</span>
				</li>
			))}
		</ul>
	);
}

const FLOW_FONT = "var(--font-ui)";
// RxR mark ~18px wide in the 256-unit icon viewBox (the mark's glyphs span y ≈ 36–220).
const ICON_SCALE = 18 / 256;
const FLOW_LABEL_MAX = 18;

function toBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

// A rasterized SVG (loaded as an <img>) can't reach the page's webfonts, so the exported PNG falls
// back to a system font unless the font is inlined. Find the UI woff2 the app already
// loaded (basic-latin subset covers the chart's English labels), base64 it, and return an
// @font-face the export SVG can embed. Returns null on any failure so export still proceeds.
async function uiFontFace(): Promise<string | null> {
	const uiFamily = getComputedStyle(document.documentElement)
		.getPropertyValue("--font-ui")
		.split(",")[0]
		?.trim()
		.replace(/["']/g, "");
	if (!uiFamily) return null;
	for (const sheet of Array.from(document.styleSheets)) {
		let rules: CSSRuleList | undefined;
		try {
			rules = sheet.cssRules;
		} catch {
			continue; // cross-origin stylesheet — not readable
		}
		for (const rule of Array.from(rules ?? [])) {
			if (!(rule instanceof CSSFontFaceRule)) continue;
			const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "");
			if (family !== uiFamily) continue;
			if ((rule.style.getPropertyValue("font-style") || "normal") !== "normal") continue;
			// Keep only the basic-latin subset (covers the chart's English labels). CSSOM normalizes
			// its range to "U+0-FF" — i.e. "U+" then all-zero start — so match that, not "U+0000".
			const range = rule.style.getPropertyValue("unicode-range");
			if (range && !/U\+0{1,4}-/i.test(range)) continue;
			const url = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+\.woff2)["']?\)/)?.[1];
			if (!url) continue;
			try {
				const res = await fetch(url);
				if (!res.ok) return null;
				const buffer = await res.arrayBuffer();
				return `@font-face{font-family:"${family}";font-style:normal;font-weight:${rule.style.getPropertyValue("font-weight")};src:url(data:font/woff2;base64,${toBase64(buffer)}) format("woff2");}`;
			} catch {
				return null;
			}
		}
	}
	return null;
}

const FLOW_W = 800;
const FLOW_H = 340;

/** Saves the hidden pipeline picture as a PNG, with the "Tracked using Reactive Resume" mark. */
async function exportFlow(svg: SVGSVGElement | null) {
	if (!svg) return;
	// Reveal the export-only watermark on a clone so the page's own copy stays as it is.
	const clone = svg.cloneNode(true) as SVGSVGElement;
	clone.style.fontFamily = getComputedStyle(svg).fontFamily;
	for (const el of clone.querySelectorAll<SVGElement>("[data-export-only]")) el.style.display = "";
	// The clone is rasterized outside the document, so its tokens need concrete values.
	resolveExportTokens(clone);
	// Inline the UI font so the rasterized PNG uses the same type as the app.
	const fontFace = await uiFontFace();
	if (fontFace) {
		const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
		styleEl.textContent = fontFace;
		clone.prepend(styleEl);
	}
	const xml = new XMLSerializer().serializeToString(clone);
	const svg64 = `data:image/svg+xml;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(xml)))}`;
	const image = new Image();
	image.onload = () => {
		const scale = 3; // high-resolution output
		const canvas = document.createElement("canvas");
		canvas.width = FLOW_W * scale;
		canvas.height = FLOW_H * scale;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;
		ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
		const link = document.createElement("a");
		link.download = "pipeline-flow.png";
		link.href = canvas.toDataURL("image/png");
		link.click();
		toast.add({ type: "success", description: t`Exported pipeline-flow.png` });
	};
	image.src = svg64;
}

type PipelineFlowProps = { ref: React.Ref<SVGSVGElement>; funnel: FunnelRow[]; active: number; closed: number };

// The picture "Export as image" saves: the same funnel as the page, drawn as a flow on the theme surface. It is never
// shown on the page (the rows above say the same), so it stays out of the layout and of assistive technology.
function PipelineFlow({ ref, funnel, active, closed }: PipelineFlowProps) {
	const W = FLOW_W;
	const H = FLOW_H;
	const padX = 40;
	const midY = 190;
	const maxBarH = 150;
	const barW = 34;
	const slotW = (W - padX * 2) / funnel.length;
	const maxReached = Math.max(1, ...funnel.map((row) => row.reached));

	const bars = funnel.map((row, i) => {
		const h = Math.max((row.reached / maxReached) * maxBarH, 4);
		const x = padX + slotW * i + slotW / 2 - barW / 2;
		return { ...row, color: row.color ?? getStageColor(row.status), x, yTop: midY - h / 2, h, cx: x + barW / 2 };
	});

	return (
		<svg
			ref={ref}
			viewBox={`0 0 ${W} ${H}`}
			width={W}
			height={H}
			aria-hidden="true"
			className="hidden"
			style={{ fontFamily: FLOW_FONT }}
		>
			<rect x={0} y={0} width={W} height={H} rx={6} fill="var(--surface)" />

			<text x={padX} y={40} fontSize={17} fontWeight={700} fill="var(--ink)">
				{t`Job search pipeline`}
			</text>
			<text x={padX} y={60} fontSize={12} fill="var(--ink-3)">
				{plural(active, { one: "# active application", other: "# active applications" })}
			</text>
			{closed > 0 && (
				<g>
					<circle cx={W - padX - 96} cy={54} r={4} fill={getStageColor("closed")} />
					<text x={W - padX - 86} y={58} fontSize={12} fill="var(--ink-2)">
						{t`${i18n.number(closed)} closed`}
					</text>
				</g>
			)}

			{/* connecting bands — drawn center-to-center so they pass *behind* the bars (rendered next, on top),
			    leaving a single continuous flow with no seam at each stage. */}
			{bars.slice(0, -1).map((bar, i) => {
				const next = bars[i + 1];
				if (!next) return null;
				const x1 = bar.cx;
				const x2 = next.cx;
				const cxa = (x1 + x2) / 2;
				return (
					<path
						key={`band-${bar.status}`}
						d={`M${x1},${bar.yTop} C${cxa},${bar.yTop} ${cxa},${next.yTop} ${x2},${next.yTop} L${x2},${next.yTop + next.h} C${cxa},${next.yTop + next.h} ${cxa},${bar.yTop + bar.h} ${x1},${bar.yTop + bar.h} Z`}
						fill="var(--sunken)"
					/>
				);
			})}

			{bars.map((bar) => (
				<g key={`bar-${bar.status}`}>
					<rect x={bar.x} y={bar.yTop} width={barW} height={bar.h} rx={6} fill={bar.color} />
					<text x={bar.cx} y={bar.yTop - 10} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--ink)">
						{i18n.number(bar.reached)}
					</text>
					<text x={bar.cx} y={H - 34} textAnchor="middle" fontSize={12} fontWeight={500} fill="var(--ink-2)">
						{fitLabel(bar.label, FLOW_LABEL_MAX)}
					</text>
				</g>
			))}

			{/* export-only watermark: the Reactive Resume mark, bottom-right, 8px from each edge, in the theme's ink
			    so it reads on the light and dark surface alike. Paths are apps/web/public/icon/dark.svg verbatim. */}
			<g
				data-export-only
				style={{ display: "none" }}
				transform={`translate(${W - 8 - 256 * ICON_SCALE}, ${H - 8 - 220 * ICON_SCALE}) scale(${ICON_SCALE})`}
				fill="var(--ink)"
				fillRule="evenodd"
				clipRule="evenodd"
			>
				<path d="M173.611 166.311L132.877 219.804H173.524L193.973 191.813L213.183 219.804H256L215.673 165.707L215.15 165.046L207.461 155.332L195.329 140.004L195.258 139.915L193.813 138.089L193.923 138.001L176.286 112.861H134.061L173.611 166.311ZM199.89 133.554L214.959 112.861H254.619L219.874 158.8L199.89 133.554Z" />
				<path d="M0 36.1959V174.314H39.0678V137.614H60.3938L60.4323 137.671C60.8436 137.653 61.2517 137.634 61.6567 137.614C75.0665 136.968 85.1471 135.549 96.385 131.385C96.7596 131.246 97.1355 131.104 97.5128 130.959L97.4591 130.881C105.816 126.86 112.331 121.344 117.006 114.331C122.005 106.702 124.504 97.6915 124.504 87.2997C124.504 76.7764 122.005 67.7 117.006 60.0706C112.007 52.3097 104.904 46.3903 95.6964 42.3125C86.62 38.2347 75.7679 36.1959 63.1399 36.1959H0ZM102.156 137.725L64.8705 144.175L85.4361 174.314H127.266L102.156 137.725ZM39.0678 107.426H60.7721C68.9277 107.426 74.9786 105.65 78.9248 102.098C83.0026 98.5465 85.0415 93.6137 85.0415 87.2997C85.0415 80.8542 83.0026 75.8556 78.9248 72.304C74.9786 68.7523 68.9277 66.9765 60.7721 66.9765H39.0678V107.426Z" />
			</g>
		</svg>
	);
}
