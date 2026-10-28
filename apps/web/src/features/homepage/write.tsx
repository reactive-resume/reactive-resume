import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@reactive-resume/ui/components/icon";
import { cn } from "@reactive-resume/utils/style";
import { goToScene, SCENE, useLanding } from "./scroll";
import { AccessibilityBullet, designSystemBullet, ResearchBullet } from "./sheet";
import { Doodle, SceneCaption, TypedText } from "./ui";

/** Scene progress for the accepted suggestion (Accept) and for the open comment (Keep mine, Undo). */
const ACCEPTED_AT = 0.93;
const COMMENT_AT = 0.42;

/**
 * 01 Write. A line types itself on a sheet of paper, the assistant suggests a sharper one in the margin, and the
 * suggestion is struck through, typed in and accepted. Accept scrubs the scene to that ending; Keep mine ends it the
 * other way, with the original line kept and the suggestion set aside. Undo takes either back to the comment.
 */
export function Write() {
	const { i18n } = useLingui();
	const step = useLanding((state) => state.writeStep);
	const active = useLanding((state) => state.activeScene === SCENE.write);
	const version = i18n.number(14);
	const acceptRef = useRef<HTMLButtonElement>(null);
	const undoRef = useRef<HTMLButtonElement>(null);
	// The control a keyboard user pressed goes inert mid-scroll, so focus follows to its counterpart on arrival.
	const pendingFocus = useRef<"accept" | "undo" | null>(null);
	const [kept, setKept] = useState(false);

	useEffect(() => {
		if (pendingFocus.current === "undo" && step === 2) undoRef.current?.focus({ preventScroll: true });
		else if (pendingFocus.current === "accept" && step === 1) acceptRef.current?.focus({ preventScroll: true });
		else return;
		pendingFocus.current = null;
	}, [step]);

	const finish = (keep: boolean) => {
		setKept(keep);
		pendingFocus.current = "undo";
		goToScene(SCENE.write, ACCEPTED_AT);
	};
	const reopen = () => {
		setKept(false);
		pendingFocus.current = "accept";
		goToScene(SCENE.write, COMMENT_AT);
	};

	return (
		<section
			id="write"
			data-scene={SCENE.write}
			data-pin
			aria-labelledby="write-title"
			className="relative h-[280vh] motion-reduce:h-svh min-[900px]:h-[330vh]"
		>
			<div
				className="sticky top-0 h-svh overflow-clip [--card:calc(1-var(--cl))] [--chip:var(--cl)] [--cl:clamp(0,(var(--p)-.8)/.08,1)] [--cm:clamp(0,(var(--p)-.36)/.08,1)] [--in:clamp(0,var(--p)/.12,1)] [--oc:var(--cl)] [--st:clamp(0,(var(--p)-.48)/.08,1)] [--ta:clamp(0,(var(--p)-.12)/.22,1)] [--ti:clamp(0,(var(--p)-.56)/.2,1)]"
				// Keep mine: the original line stays, unstruck, and the comment gives way to a note saying so.
				style={kept ? ({ "--st": 0, "--ti": 0, "--oc": 0, "--card": 0, "--chip": 1 } as CSSProperties) : undefined}
			>
				<Doodle
					name="eraser"
					wipe="clamp(0, (var(--p) - .02) / .2, 1)"
					sizes="10vw"
					className="start-[7vw] top-[36vh] w-[10vw] translate-y-[calc(var(--p)*-50px)] rotate-[-10deg] max-[900px]:hidden"
				/>

				<h2
					id="write-title"
					className="font-anybody absolute start-(--gutter) top-[10vh] max-w-[90vw] text-[10vw] leading-[.95] font-light tracking-[-.03em] text-balance text-ink min-[900px]:top-[11vh] min-[900px]:max-w-[34vw] min-[900px]:text-[clamp(48px,4.5vw,80px)]"
				>
					{t`Write your professional resume`}
					<span className="text-accent">.</span>
				</h2>

				<SceneCaption
					number="01"
					title={t`Write`}
					className="absolute inset-x-(--gutter) top-[calc(10vh+24vw)] min-[900px]:end-auto min-[900px]:top-auto min-[900px]:bottom-[clamp(20px,5vh,44px)] min-[900px]:max-w-[min(30em,34vw)] min-[900px]:opacity-(--in)"
				>
					{t`Write beside a live page. It saves as you type and keeps every version. Ask the assistant for a sharper line: it suggests, you decide.`}
				</SceneCaption>

				<div className="absolute start-[5vw] top-[calc(10vh+17vw+150px)] h-[120vh] w-[90vw] origin-top-left [transform:translateY(calc((1-var(--in))*14vh))_rotate(-1.2deg)_scale(calc(.94+var(--in)*.06))] rounded-md bg-paper p-[6vw] font-ui text-[14px] leading-[1.55] text-[oklch(0.28_0.01_95)] shadow-paper [transition:transform_.5s_var(--ease)] min-[900px]:start-[42vw] min-[900px]:top-[14vh] min-[900px]:w-[53vw] min-[900px]:px-[3vw] min-[900px]:py-[3.5vw] min-[900px]:text-[clamp(14px,1.3vw,20px)] min-[900px]:opacity-[clamp(0,var(--p)*20,1)] rtl:origin-top-right">
					<div className="absolute end-[2vw] top-[1.6vw] flex h-7 items-center gap-1.5 rounded-sm bg-[oklch(0.95_0.006_95)] ps-2 pe-[11px] text-[12px] font-medium text-[oklch(0.42_0.01_95)] opacity-(--cl)">
						<Icon name="cloud-check" size={16} className="text-[oklch(0.42_0.1_150)]" />
						{t`Saved · version ${version}`}
					</div>

					{/*
					 * The lines and the comment keep their full height so nothing below them reflows while scrolling (a layout
					 * shift on every frame). What used to grow with max-height is clipped instead, and what it pushed is
					 * translated: --oh, --nh and --cmh-* are their measured heights (scroll.ts), the --w*v values how much of each
					 * shows, and --row-off how far everything beneath has to rise to sit where the old reflow put it.
					 */}
					<div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-[3vw] gap-y-[.5em] [--row-off:calc(max(var(--oh,0px)+var(--nh,0px),var(--cmh-side,0px))-max(var(--wov)+var(--wnv),var(--cmh-side,0px))+var(--cmh-inline,0px)-var(--wcv))] [--wcv:min(var(--cmh-inline,0px),calc(var(--cm)*16em))] [--wnv:min(var(--nh,0px),calc(clamp(0,var(--ti)*40,1)*(1.6em+var(--ti)*6.4em)))] [--wov:min(var(--oh,0px),calc((1-var(--oc))*(1.6em+var(--ta)*6.4em)))] min-[1280px]:grid-cols-[minmax(0,1fr)_minmax(0,max(15vw,210px))]">
						<div className="col-start-1 flex flex-col gap-[.25em]">
							<span className="font-martian mb-[.8em] border-b border-[oklch(0.45_0.1_150/.35)] pb-[.6em] text-[.7em] leading-[1.4] text-[oklch(0.45_0.1_150)]">
								{t`Experience`}
							</span>
							<div className="flex items-baseline justify-between gap-[1em]">
								<b className="font-display text-[1.55em] leading-[1.1] font-medium">{t`Lead Product Designer`}</b>
								<span className="font-martian text-[.72em] whitespace-nowrap text-[oklch(0.5_0.01_95)]">
									{t`2021 – Present`}
								</span>
							</div>
							<span className="text-[oklch(0.45_0.01_95)]">{t`Northwind Labs · Lisbon`}</span>
						</div>

						{/* Each line draws its own bullet, so the rewrite keeps one when the original collapses away. */}
						<ul className="col-start-1 mt-[.3em]">
							<li>
								<span
									data-line-old
									className="relative block ps-[1.1em] opacity-[calc(1-var(--oc))] [clip-path:inset(0_0_calc(100%-var(--wov))_0)] before:absolute before:start-[.25em] before:content-['•']"
								>
									<TypedText
										text={t`Responsible for the design system and helping other teams with their designs.`}
										progress="--ta"
										className="bg-[linear-gradient(oklch(0.55_0.17_27),oklch(0.55_0.17_27))] [box-decoration-break:clone] [background-size:calc(var(--st)*100%)_2px] [background-position:0_58%] bg-no-repeat text-[color-mix(in_oklch,oklch(0.28_0.01_95),oklch(0.55_0.15_27)_calc(var(--st)*70%))]"
									/>
								</span>
								<span
									data-line-new
									className="relative block [translate:0_calc(var(--wov)-var(--oh,0px))] ps-[1.1em] [clip-path:inset(0_0_calc(100%-var(--wnv))_0)] before:absolute before:start-[.25em] before:opacity-(--cl) before:content-['•']"
								>
									<TypedText text={designSystemBullet()} progress="--ti" charClassName="typed-suggestion" />
								</span>
							</li>
						</ul>

						<div
							data-write-comment
							className={cn(
								// Below 1280px the comment stays inline so the resume keeps a readable column width.
								"relative col-start-1 grid min-w-0 [transform:translateX(calc(var(--dir)*(1-var(--cm))*30px))] font-ui text-[13px] leading-[1.45] text-[oklch(0.25_0.01_95)] opacity-(--cm) [transition:transform_.4s_var(--ease)] max-[1280px]:[translate:0_calc(var(--wov)+var(--wnv)-var(--oh,0px)-var(--nh,0px))] max-[1280px]:[clip-path:inset(0_0_calc(100%-var(--wcv))_0)] min-[1280px]:col-start-2 min-[1280px]:row-start-2",
								!active && "pointer-events-none",
							)}
						>
							<span
								aria-hidden="true"
								className="absolute -start-[3vw] top-[22px] hidden w-[3vw] border-t-[1.5px] border-dashed border-[oklch(0.5_0.1_150/.6)] min-[1280px]:block"
							/>
							<div
								inert={kept || step !== 1}
								className="col-start-1 row-start-1 flex flex-col gap-[9px] rounded-xl border border-[oklch(0.9_0.006_95)] bg-white px-[13px] py-3 opacity-(--card) shadow-[0_12px_30px_-12px_oklch(0.2_0.01_95/.3)]"
							>
								<div className="flex items-center gap-2">
									<span className="flex size-[22px] items-center justify-center rounded-sm bg-[oklch(0.94_0.035_150)] text-[oklch(0.42_0.1_150)]">
										<Icon name="sparkle" size={15} />
									</span>
									<b className="font-semibold">{t`Assistant`}</b>
								</div>
								<span>{t`Lead with the result and give it a scale.`}</span>
								<div className="flex flex-wrap gap-1.5">
									<button
										ref={acceptRef}
										type="button"
										onClick={() => finish(false)}
										className="h-[30px] rounded-md bg-[oklch(0.5_0.1_150)] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[oklch(0.44_0.1_150)]"
									>
										{t`Accept`}
									</button>
									<button
										type="button"
										onClick={() => finish(true)}
										className="h-[30px] rounded-md border border-[oklch(0.82_0.008_95)] bg-white px-[11px] text-[12.5px] font-medium text-[oklch(0.25_0.01_95)] transition-colors hover:bg-[oklch(0.96_0.005_95)]"
									>
										{t`Keep mine`}
									</button>
								</div>
							</div>
							<div
								inert={kept ? step < 1 : step !== 2}
								className={cn(
									"col-start-1 row-start-1 flex items-center gap-2 self-start rounded-xl px-[13px] py-2.5 font-medium opacity-(--chip)",
									kept
										? "bg-[oklch(0.95_0.006_95)] text-[oklch(0.3_0.01_95)]"
										: "bg-[oklch(0.95_0.03_150)] text-[oklch(0.38_0.1_150)]",
								)}
							>
								<Icon name="check" size={17} />
								{kept ? t`Kept yours` : t`Accepted`}
								{/* Undo scrubs the scene back, which reduced motion doesn't do, so it's left out there. */}
								<button
									ref={undoRef}
									type="button"
									onClick={reopen}
									className="ms-auto flex h-7 items-center gap-[3px] rounded-sm px-2 text-[12.5px] font-medium text-[oklch(0.3_0.01_95)] transition-colors hover:bg-[oklch(0.9_0.04_150)] motion-reduce:hidden"
								>
									<Icon name="arrow-u-up-left" size={16} />
									{t`Undo`}
								</button>
							</div>
						</div>

						<ul className="col-start-1 [translate:0_calc(-1*var(--row-off))] list-disc ps-[1.1em]">
							<li>
								<ResearchBullet />
							</li>
						</ul>
						<div className="col-start-1 mt-[1.2em] flex [translate:0_calc(-1*var(--row-off))] flex-col gap-[.25em]">
							<div className="flex items-baseline justify-between gap-[1em]">
								<b className="font-display text-[1.55em] leading-[1.1] font-medium">{t`Product Designer`}</b>
								<span className="font-martian text-[.72em] whitespace-nowrap text-[oklch(0.5_0.01_95)]">{t`2017 – 2021`}</span>
							</div>
							<span className="text-[oklch(0.45_0.01_95)]">{t`Parcel & Co. · Porto`}</span>
							<ul className="mt-[.3em] list-disc ps-[1.1em]">
								<li>
									<AccessibilityBullet />
								</li>
							</ul>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
