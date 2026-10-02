import type { CSSProperties, ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { cn } from "@reactive-resume/utils/style";
import { SCENE, useLanding } from "./scroll";
import { Sheet } from "./sheet";
import { Doodle, labelClass, SceneCaption } from "./ui";

/** Job match as each of the posting's four keywords is matched. */
const MATCH = [62, 70, 78, 85, 91];
const KEYWORDS = ["a", "b", "c", "d"] as const;

type PostingKeywordProps = { id: (typeof KEYWORDS)[number]; children: ReactNode };

/** A phrase in the posting, highlighted as its thread reaches the resume. */
function PostingKeyword({ id, children }: PostingKeywordProps) {
	const step = KEYWORDS.indexOf(id) + 1;
	return (
		<mark data-posting-keyword={id} className="posting-keyword" style={{ "--k": `var(--t${step})` } as CSSProperties}>
			{children}
		</mark>
	);
}

/**
 * 04 Tailor. The verb is stitched together, then threads run from each keyword in a job posting to its match on the
 * resume, the match score climbs, a cover letter slides out and the role moves from Saved to Applied.
 */
export function Tailor() {
	const { i18n } = useLingui();
	const matched = useLanding((state) => state.keywordCount);
	const tailor = t`Tailor`;
	const stages = [
		{ label: t`Saved`, dot: "bg-stage-saved" },
		{ label: t`Applied`, dot: "bg-stage-applied" },
		{ label: t`Interview`, dot: "bg-stage-interview" },
		{ label: t`Offer`, dot: "bg-stage-offer" },
	];

	return (
		<section
			id="tailor"
			data-scene={SCENE.tailor}
			data-pin
			aria-labelledby="tailor-title"
			className="relative h-[280vh] motion-reduce:h-svh min-[900px]:h-[330vh]"
		>
			<div className="sticky top-0 h-svh overflow-hidden [--ap:clamp(0,(var(--p)-.8)/.1,1)] [--cv:clamp(0,(var(--p)-.64)/.12,1)] [--cvx:-60%] [--kwa:var(--t1)] [--kwb:var(--t2)] [--kwc:var(--t3)] [--kwd:var(--t4)] [--pw:38vw] [--sw:clamp(0,var(--p)/.14,1)] [--t1:clamp(0,(var(--p)-.14)/.1,1)] [--t2:clamp(0,(var(--p)-.26)/.1,1)] [--t3:clamp(0,(var(--p)-.38)/.1,1)] [--t4:clamp(0,(var(--p)-.5)/.1,1)] min-[900px]:[--cvx:-40%] min-[900px]:[--pw:min(23vw,46vh)]">
				<Doodle
					name="scissors"
					wipe="clamp(0, (var(--p) - .08) / .2, 1)"
					className="start-[41vw] top-[74vh] w-[12vw] translate-y-[calc(var(--p)*-40px)] rotate-[12deg] max-[900px]:hidden"
				/>

				<h2
					id="tailor-title"
					className="absolute start-(--gutter) top-[10vh] text-[14vw] leading-[.86] font-normal whitespace-nowrap text-ink min-[900px]:top-[11vh] min-[900px]:text-[clamp(64px,8vw,150px)]"
				>
					<span className="font-anybody block [transform:translateX(calc(var(--dir)*(1-var(--sw))*-3vw))] font-light tracking-[-.03em] [clip-path:inset(0_-5%_50%_-5%)]">
						{tailor}
						<span className="text-accent">.</span>
					</span>
					<span
						aria-hidden="true"
						data-text={tailor}
						className="font-anybody absolute start-0 top-0 block [transform:translateX(calc(var(--dir)*(1-var(--sw))*3vw))] font-light tracking-[-.03em] [clip-path:inset(50%_-5%_-10%_-5%)] before:content-[attr(data-text)] after:text-accent after:content-['.']"
					/>
					<span
						aria-hidden="true"
						className="absolute -inset-x-[1%] top-[calc(50%-1px)] h-0.5 bg-[repeating-linear-gradient(90deg,var(--accent)_0_10px,transparent_10px_17px)] [clip-path:inset(0_calc((1-var(--sw))*100%)_0_0)] rtl:[clip-path:inset(0_0_0_calc((1-var(--sw))*100%))]"
					/>
				</h2>

				<SceneCaption
					number="04"
					title={tailor}
					className="min-[900px]:short:hidden absolute end-(--gutter) top-[13vh] hidden w-[min(24em,30vw)] min-[900px]:flex"
				>
					{t`Paste 1 job posting once. It feeds a tailored copy of your resume, a match score, a cover letter draft and a place to track the role.`}
				</SceneCaption>

				<svg
					data-threads
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 z-3 size-full overflow-visible"
				>
					{KEYWORDS.map((key, index) => (
						<path
							key={key}
							data-thread={key}
							d="M0 0"
							pathLength={1}
							fill="none"
							stroke="oklch(0.55 0.12 150)"
							strokeWidth={1.6}
							strokeLinecap="round"
							strokeDasharray={1}
							style={{ strokeDashoffset: `calc(1 - var(--t${index + 1}))` }}
						/>
					))}
				</svg>

				<div className="absolute start-(--gutter) top-[calc(10vh+17vw)] z-2 flex w-[calc(100vw-2*var(--gutter))] flex-col gap-4 min-[900px]:top-[40vh] min-[900px]:w-[min(390px,30vw)]">
					<div className="flex rotate-[-1deg] flex-col gap-3 rounded-[14px] border border-line bg-raised p-[18px] font-ui text-sm leading-[1.55] text-ink shadow-e3">
						<div className="flex items-center gap-[11px]">
							<span
								aria-hidden="true"
								className="font-anybody flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-ink text-[19px] leading-none font-medium text-bg font-stretch-[95%]"
							>
								F
							</span>
							<div className="flex flex-col">
								<b className="text-[15px] font-semibold">{t`Senior Product Designer`}</b>
								<span className="text-[12.5px] text-ink-3">{t`Fieldnote · Remote, EU`}</span>
							</div>
							<span className={cn(labelClass, "ms-auto text-[10px] tracking-[.06em] text-ink-3")}>{t`Posting`}</span>
						</div>
						<p className="text-ink-2">
							<Trans>
								You’ll own our <PostingKeyword id="a">design systems</PostingKeyword>, run{" "}
								<PostingKeyword id="b">user research</PostingKeyword> with customers and hold a high bar for{" "}
								<PostingKeyword id="c">accessibility</PostingKeyword>, working in a{" "}
								<PostingKeyword id="d">cross-functional</PostingKeyword> team.
							</Trans>
						</p>
						<div className="flex items-baseline justify-between border-t border-line pt-3">
							<span className={cn(labelClass, "text-[10.5px] text-ink-3")}>{t`Job match`}</span>
							<span className="font-anybody text-[40px] leading-none font-light tracking-[-.03em] text-accent-text tabular-nums">
								{i18n.number((MATCH[matched] ?? 0) / 100, { style: "percent" })}
							</span>
						</div>
					</div>

					<div className="min-[900px]:short:hidden hidden flex-col gap-2 rounded-[14px] border border-dashed border-line-2 px-3.5 py-3 min-[900px]:flex">
						<div className="font-martian grid grid-cols-4 text-[10px] leading-none font-medium tracking-[.06em] text-ink-3 uppercase">
							{stages.map((stage) => (
								<span key={stage.label} className="flex min-w-0 items-center gap-[5px]">
									<span aria-hidden="true" className={cn("size-[7px] shrink-0 rounded-full", stage.dot)} />
									{stage.label}
								</span>
							))}
						</div>
						<div className="relative h-10">
							<div className="absolute start-[calc(var(--ap)*25%)] top-0 flex h-10 w-[calc(25%-6px)] min-w-max flex-col justify-center overflow-hidden rounded-[9px] border border-line bg-raised px-2 font-ui text-[11.5px] leading-[1.2] font-semibold whitespace-nowrap text-ink shadow-e2 [transition:inset-inline-start_.5s_var(--ease)]">
								{t`Fieldnote`}
								<span className="text-[10.5px] font-normal text-ink-3">{t`Resume attached`}</span>
							</div>
						</div>
					</div>
				</div>

				<div className="absolute end-[8vw] top-[78%] aspect-[612/792] w-(--pw) -translate-y-1/2 min-[900px]:top-[58%]">
					<div
						aria-hidden="true"
						className="@container absolute inset-0 [transform:translate(calc(var(--dir)*var(--cv)*var(--cvx)),calc(var(--cv)*8%))_rotate(calc(var(--dir)*var(--cv)*-8deg))] overflow-hidden rounded-[2px] bg-[#fbfaf6] shadow-paper [transition:transform_.5s_var(--ease)]"
					>
						<div className="flex flex-col gap-[2.6cqw] p-[9cqw] font-display text-[2.2cqw] leading-normal text-[oklch(0.3_0.01_95)]">
							<span className="font-martian text-[1.6cqw] font-medium tracking-[.08em] text-[oklch(0.48_0.1_150)] uppercase">
								{t`Cover letter · Fieldnote`}
							</span>
							<span className="text-[3cqw]">{t`Dear Fieldnote team,`}</span>
							{["92%", "86%", "90%", "62%"].map((width) => (
								<span key={width} className="h-[1.2cqw] rounded-[1cqw] bg-[oklch(0.9_0.006_95)]" style={{ width }} />
							))}
						</div>
					</div>
					<div className="absolute inset-0 rounded-[2px] shadow-paper">
						<Sheet />
					</div>
				</div>
			</div>
		</section>
	);
}
