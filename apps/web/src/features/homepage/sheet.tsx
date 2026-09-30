import type { MessageDescriptor } from "@lingui/core";
import type { CSSProperties, ReactNode } from "react";
import { msg, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";

/*
 * The demo resume page that every scene shows: Alex Morgan's resume, in one of five looks. Everything is sized in
 * cqw so a page reads the same at any width. The scenes steer it through inherited CSS variables:
 *   --chk        Check's scan progress; ticks each section heading as the scan passes it.
 *   --dw         Check's date warning; flags the second job's mixed date format.
 *   --kwa..--kwd Tailor's keyword matches; highlights each matched phrase and adds the new skill.
 */

const fonts = {
	sans: "var(--font-ui)",
	serif: "var(--font-display)",
	mono: "var(--font-mono)",
	display: "var(--font-display)",
};

export type SheetTemplate = {
	name: MessageDescriptor;
	root: CSSProperties;
	header: CSSProperties;
	/** How the header lines up: flex-start or center. */
	align: "flex-start" | "center";
	title: CSSProperties;
	subtitleColor: string;
	heading: CSSProperties;
	columns: string;
	main: CSSProperties;
	side: CSSProperties;
};

const bodyText = (family: string, size = "1.75cqw") => ({ fontFamily: family, fontSize: size });

export const sheetTemplates: SheetTemplate[] = [
	{
		name: msg`Classic`,
		root: { ...bodyText(fonts.sans), "--accent-ink": "oklch(0.48 0.1 150)" } as CSSProperties,
		header: { margin: "0 8cqw", padding: "8cqw 0 3.6cqw", borderBottom: "0.25cqw solid oklch(0.48 0.1 150)" },
		align: "flex-start",
		title: { fontFamily: fonts.serif, fontSize: "6.6cqw", fontWeight: 500, letterSpacing: "-.015em" },
		subtitleColor: "oklch(0.48 0.1 150)",
		heading: {
			fontFamily: fonts.sans,
			fontSize: "1.6cqw",
			fontWeight: 700,
			textTransform: "uppercase",
			letterSpacing: ".14em",
		},
		columns: "minmax(0,1fr)",
		main: { padding: "4.4cqw 8cqw 3.6cqw" },
		side: { order: 2, padding: "0 8cqw 6cqw", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" },
	},
	{
		name: msg`Sidebar`,
		root: { ...bodyText(fonts.sans), "--accent-ink": "oklch(0.45 0.1 250)" } as CSSProperties,
		header: { padding: "7.5cqw 7cqw 5cqw", background: "oklch(0.965 0.012 250)" },
		align: "flex-start",
		title: { fontFamily: fonts.sans, fontSize: "6cqw", fontWeight: 700, letterSpacing: "-.03em" },
		subtitleColor: "oklch(0.45 0.1 250)",
		heading: {
			fontFamily: fonts.sans,
			fontSize: "2.1cqw",
			fontWeight: 700,
			borderBottom: "0.2cqw solid oklch(0.45 0.1 250 / .25)",
			paddingBottom: "0.8cqw",
		},
		columns: "minmax(0,34fr) minmax(0,66fr)",
		main: { padding: "4.4cqw 7cqw 4cqw 5cqw" },
		side: {
			order: 0,
			padding: "1cqw 4.5cqw 6cqw 7cqw",
			background: "oklch(0.965 0.012 250)",
			gridTemplateColumns: "minmax(0,1fr)",
		},
	},
	{
		name: msg`Banner`,
		root: { ...bodyText(fonts.sans), "--accent-ink": "oklch(0.5 0.12 40)" } as CSSProperties,
		header: { padding: "8cqw 8cqw 6cqw", background: "oklch(0.5 0.12 40)", color: "#fff", textAlign: "center" },
		align: "center",
		title: {
			fontFamily: fonts.serif,
			fontSize: "7cqw",
			fontWeight: 400,
			fontStyle: "italic",
			letterSpacing: "-.015em",
		},
		subtitleColor: "oklch(0.95 0.03 60)",
		heading: { fontFamily: fonts.serif, fontSize: "2.7cqw", fontWeight: 500, fontStyle: "italic" },
		columns: "minmax(0,68fr) minmax(0,32fr)",
		main: { padding: "5cqw 4cqw 4cqw 7cqw" },
		side: {
			order: 2,
			padding: "5cqw 6cqw 6cqw 4cqw",
			borderInlineStart: "0.15cqw solid oklch(0.9 0.006 95)",
			gridTemplateColumns: "minmax(0,1fr)",
		},
	},
	{
		name: msg`Mono`,
		root: { ...bodyText(fonts.mono, "1.42cqw"), "--accent-ink": "oklch(0.25 0.01 95)" } as CSSProperties,
		header: { margin: "0 8cqw", padding: "8cqw 0 4cqw", borderBottom: "0.2cqw dashed oklch(0.3 0.01 95)" },
		align: "flex-start",
		title: {
			fontFamily: fonts.mono,
			fontSize: "4.6cqw",
			fontWeight: 600,
			textTransform: "uppercase",
			letterSpacing: ".02em",
		},
		subtitleColor: "oklch(0.45 0.01 95)",
		heading: {
			fontFamily: fonts.mono,
			fontSize: "1.6cqw",
			fontWeight: 700,
			textTransform: "uppercase",
			letterSpacing: ".12em",
		},
		columns: "minmax(0,1fr)",
		main: { padding: "4.4cqw 8cqw 3.6cqw" },
		side: { order: 2, padding: "0 8cqw 6cqw", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)" },
	},
	{
		name: msg`Editorial`,
		root: { ...bodyText(fonts.serif, "1.95cqw"), "--accent-ink": "oklch(0.22 0.01 95)" } as CSSProperties,
		header: { margin: "0 7cqw", padding: "7cqw 0 3cqw", borderBottom: "0.6cqw solid oklch(0.2 0.01 95)" },
		align: "flex-start",
		title: {
			fontFamily: fonts.display,
			fontSize: "10.5cqw",
			fontWeight: 800,
			fontStretch: "62%",
			textTransform: "uppercase",
			letterSpacing: "-.02em",
		},
		subtitleColor: "oklch(0.48 0.1 150)",
		heading: {
			fontFamily: fonts.display,
			fontSize: "2.4cqw",
			fontWeight: 800,
			fontStretch: "80%",
			textTransform: "uppercase",
		},
		columns: "minmax(0,64fr) minmax(0,36fr)",
		main: { padding: "4.4cqw 4cqw 4cqw 7cqw" },
		side: { order: 2, padding: "4.4cqw 7cqw 6cqw 2cqw", gridTemplateColumns: "minmax(0,1fr)" },
	},
];

type KeywordProps = { id: "a" | "b" | "c" | "d"; children: ReactNode };

/** A phrase Tailor matches against the job posting. The scene draws a thread to it by `data-keyword`. */
function Keyword({ id, children }: KeywordProps) {
	return (
		<span data-keyword={id} className="sheet-keyword" style={{ "--k": `var(--kw${id}, 0)` } as CSSProperties}>
			{children}
		</span>
	);
}

export function ProfileSummary() {
	return (
		<Trans>
			Product designer with nine years of experience building <Keyword id="a">design systems</Keyword> and research-led
			products for B2B teams.
		</Trans>
	);
}

export function ResearchBullet() {
	return (
		<Trans>
			Led <Keyword id="b">user research</Keyword> for the onboarding redesign; activation rose from 31% to 44%.
		</Trans>
	);
}

export function AccessibilityBullet() {
	return (
		<Trans>
			Shipped <Keyword id="c">accessible</Keyword> checkout flows for web and iOS, meeting WCAG 2.1 AA.
		</Trans>
	);
}

/** The rewritten line the assistant suggests in Write, and the line the page carries everywhere else. */
export const designSystemBullet = () =>
	t`Built a shared design system used by six product teams, cutting UI review time by 40%.`;

type HeadingProps = {
	template: SheetTemplate;
	children: ReactNode /** Where in Check's scan it gets ticked. */;
	tick: number;
};

function Heading({ template, children, tick }: HeadingProps) {
	return (
		<h3
			className="mb-[1.2cqw] flex items-center justify-between text-(--accent-ink) leading-[1.3]"
			style={template.heading}
		>
			{children}
			<Icon
				name="check_circle"
				filled
				className="text-[oklch(0.5_0.12_150)] opacity-[clamp(0,calc((var(--chk,0)-var(--tick))*12),1)]"
				style={{ fontSize: "2.5cqw", "--tick": tick } as CSSProperties}
			/>
		</h3>
	);
}

type SheetProps = { template?: SheetTemplate };

/** Alex Morgan's resume, as a page. Decorative: the scenes' own copy says what it shows. */
export function Sheet({ template = sheetTemplates[0] as SheetTemplate }: SheetProps) {
	return (
		<div
			aria-hidden="true"
			className="@container absolute inset-0 select-none overflow-hidden rounded-[2px] bg-paper text-start"
		>
			<div className="absolute inset-0 flex flex-col text-[oklch(0.3_0.01_95)] leading-normal" style={template.root}>
				<header
					className="flex flex-col gap-[.7cqw] text-[oklch(0.22_0.01_95)]"
					style={{ alignItems: template.align, ...template.header }}
				>
					<span className="leading-none" style={template.title}>
						{t`Alex Morgan`}
					</span>
					<span className="font-medium text-[2.3cqw]" style={{ color: template.subtitleColor }}>
						{t`Senior Product Designer`}
					</span>
					<span
						className="flex flex-wrap gap-x-[3cqw] gap-y-[.4cqw] text-[1.6cqw] opacity-78"
						style={{ justifyContent: template.align }}
					>
						<span>alex@morgan.design</span>
						<span>{t`Lisbon, Portugal`}</span>
						<span>morgan.design</span>
					</span>
				</header>

				<div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: template.columns }}>
					<div className="order-1 flex min-w-0 flex-col gap-[3.2cqw]" style={template.main}>
						<section>
							<Heading template={template} tick={0.1}>
								{t`Profile`}
							</Heading>
							<p>
								<ProfileSummary />
							</p>
						</section>

						<section>
							<Heading template={template} tick={0.28}>
								{t`Experience`}
							</Heading>
							<div className="flex flex-col gap-[1.8cqw]">
								<div>
									<div className="flex justify-between gap-[2cqw]">
										<b className="font-semibold">{t`Lead Product Designer`}</b>
										<span className="whitespace-nowrap opacity-70">{t`2021 – Present`}</span>
									</div>
									<div className="opacity-78">{t`Northwind Labs · Lisbon`}</div>
									<ul className="mt-[.6cqw] flex list-disc flex-col gap-[.4cqw] ps-[2.2cqw]">
										<li>{designSystemBullet()}</li>
										<li>
											<ResearchBullet />
										</li>
									</ul>
								</div>
								<div>
									<div className="flex justify-between gap-[2cqw]">
										<b className="font-semibold">{t`Product Designer`}</b>
										<span className="grid justify-items-end whitespace-nowrap">
											<span className="col-start-1 row-start-1 opacity-[calc(.7*(1-var(--dw,0)))]">{t`2017 – 2021`}</span>
											<span className="col-start-1 row-start-1 -mx-[.5cqw] rounded-[.4cqw] bg-[oklch(0.92_0.09_85)] px-[.5cqw] text-[oklch(0.4_0.09_70)] opacity-[var(--dw,0)] shadow-[0_0_0_.3cqw_oklch(0.75_0.13_80)]">
												{t`06/2017 – 2021`}
											</span>
										</span>
									</div>
									<div className="opacity-78">{t`Parcel & Co. · Porto`}</div>
									<ul className="mt-[.6cqw] list-disc ps-[2.2cqw]">
										<li>
											<AccessibilityBullet />
										</li>
									</ul>
								</div>
							</div>
						</section>

						<section>
							<Heading template={template} tick={0.5}>
								{t`Education`}
							</Heading>
							<div className="flex justify-between gap-[2cqw]">
								<b className="font-semibold">{t`BA, Communication Design`}</b>
								<span className="whitespace-nowrap opacity-70">{t`2013 – 2017`}</span>
							</div>
							<div className="opacity-78">{t`University of Porto`}</div>
						</section>
					</div>

					<div className="grid min-w-0 content-start gap-[3.2cqw]" style={template.side}>
						<section>
							<Heading template={template} tick={0.66}>
								{t`Skills`}
							</Heading>
							<div className="flex flex-col gap-[.3cqw]">
								<span>{t`Design systems`}</span>
								<span>{t`User research`}</span>
								<span>{t`Accessibility`}</span>
								<span>{t`Prototyping`}</span>
								<span>{t`Figma, HTML and CSS`}</span>
								<span className="block max-h-[calc(var(--kwd,0)*3em)] overflow-hidden opacity-[var(--kwd,0)]">
									<Keyword id="d">{t`Cross-functional leadership`}</Keyword>
								</span>
							</div>
						</section>
						<section>
							<Heading template={template} tick={0.8}>
								{t`Languages`}
							</Heading>
							<div className="flex flex-col gap-[.3cqw]">
								<span>{t`English (native)`}</span>
								<span>{t`Portuguese (native)`}</span>
								<span>{t`Spanish (B2)`}</span>
							</div>
						</section>
					</div>
				</div>
			</div>
		</div>
	);
}
