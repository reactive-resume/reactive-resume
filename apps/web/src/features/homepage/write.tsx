import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef } from "react";
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
 * suggestion is struck through, typed in and accepted. Accept and Keep mine scrub the scene to either outcome.
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

	useEffect(() => {
		if (pendingFocus.current === "undo" && step === 2) undoRef.current?.focus({ preventScroll: true });
		else if (pendingFocus.current === "accept" && step === 1) acceptRef.current?.focus({ preventScroll: true });
		else return;
		pendingFocus.current = null;
	}, [step]);

	const accept = () => {
		pendingFocus.current = "undo";
		goToScene(SCENE.write, ACCEPTED_AT);
	};
	const reopen = (focusAccept: boolean) => {
		pendingFocus.current = focusAccept ? "accept" : null;
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
			<div className="sticky top-0 h-svh overflow-hidden [--cl:clamp(0,(var(--p)-.8)/.08,1)] [--cm:clamp(0,(var(--p)-.36)/.08,1)] [--in:clamp(0,var(--p)/.12,1)] [--st:clamp(0,(var(--p)-.48)/.08,1)] [--ta:clamp(0,(var(--p)-.12)/.22,1)] [--ti:clamp(0,(var(--p)-.56)/.2,1)]">
				<Doodle
					name="eraser"
					wipe="clamp(0, (var(--p) - .02) / .2, 1)"
					className="start-[7vw] top-[36vh] w-[10vw] translate-y-[calc(var(--p)*-50px)] rotate-[-10deg] max-[900px]:hidden"
				/>

				<h2
					id="write-title"
					className="font-anybody absolute start-(--gutter) top-[10vh] text-[16vw] leading-[.9] font-light tracking-[-.03em] whitespace-nowrap text-ink [font-stretch:calc(86%+var(--in)*14%)] [transition:font-stretch_.3s] min-[900px]:top-[11vh] min-[900px]:text-[clamp(72px,9vw,160px)]"
				>
					{t`Write`}
					<span className="text-accent">.</span>
				</h2>

				<SceneCaption
					number="01"
					title={t`Write`}
					className="absolute inset-x-(--gutter) top-[calc(10vh+17vw)] opacity-(--in) min-[900px]:end-auto min-[900px]:top-auto min-[900px]:bottom-[clamp(20px,5vh,44px)] min-[900px]:max-w-[min(30em,34vw)]"
				>
					{t`Write in one editor beside a live page. It saves as you type and keeps every version. Ask the assistant for a sharper line: it suggests, you decide.`}
				</SceneCaption>

				<div className="absolute start-[5vw] top-[calc(10vh+17vw+150px)] h-[120vh] w-[90vw] origin-top-left [transform:translateY(calc((1-var(--in))*14vh))_rotate(-1.2deg)_scale(calc(.94+var(--in)*.06))] rounded-[3px] bg-paper p-[6vw] font-ui text-[14px] leading-[1.55] text-[oklch(0.28_0.01_95)] shadow-paper [transition:transform_.5s_var(--ease)] min-[900px]:start-[42vw] min-[900px]:top-[14vh] min-[900px]:w-[60vw] min-[900px]:px-[5vw] min-[900px]:py-[4.5vw] min-[900px]:text-[clamp(14px,1.3vw,20px)] rtl:origin-top-right">
					<div className="absolute end-[2vw] top-[1.6vw] flex h-7 items-center gap-1.5 rounded-full bg-[oklch(0.95_0.006_95)] ps-2 pe-[11px] text-[12px] font-medium text-[oklch(0.42_0.01_95)] opacity-(--cl)">
						<Icon name="cloud_done" size={16} className="text-[oklch(0.42_0.1_150)]" />
						{t`Saved · version ${version}`}
					</div>

					<div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-[3vw] gap-y-[.5em] min-[900px]:grid-cols-[minmax(0,1fr)_minmax(0,max(15vw,210px))]">
						<div className="col-start-1 flex flex-col gap-[.25em]">
							<span className="font-martian mb-[.8em] border-b border-[oklch(0.45_0.1_150/.35)] pb-[.6em] text-[.7em] leading-[1.4] tracking-[.14em] text-[oklch(0.45_0.1_150)] uppercase">
								{t`Experience`}
							</span>
							<div className="flex items-baseline justify-between gap-[1em]">
								<b className="font-display text-[1.55em] leading-[1.1] font-medium">{t`Lead Product Designer`}</b>
								<span className="font-martian text-[.72em] whitespace-nowrap text-[oklch(0.5_0.01_95)] uppercase">
									{t`2021 – Present`}
								</span>
							</div>
							<span className="text-[oklch(0.45_0.01_95)]">{t`Northwind Labs · Lisbon`}</span>
						</div>

						{/* Each line draws its own bullet, so the rewrite keeps one when the original collapses away. */}
						<ul className="col-start-1 mt-[.3em]">
							<li>
								<span className="relative block max-h-[calc((1-var(--cl))*8em)] overflow-hidden ps-[1.1em] opacity-[calc(1-var(--cl))] before:absolute before:start-[.25em] before:content-['•']">
									<TypedText
										text={t`Responsible for the design system and helping other teams with their designs.`}
										progress="--ta"
										className="bg-[linear-gradient(oklch(0.55_0.17_27),oklch(0.55_0.17_27))] [box-decoration-break:clone] [background-size:calc(var(--st)*100%)_2px] [background-position:0_58%] bg-no-repeat text-[color-mix(in_oklch,oklch(0.28_0.01_95),oklch(0.55_0.15_27)_calc(var(--st)*70%))]"
									/>
								</span>
								<span className="relative block max-h-[calc(clamp(0,var(--ti)*40,1)*8em)] overflow-hidden ps-[1.1em] before:absolute before:start-[.25em] before:opacity-(--cl) before:content-['•']">
									<TypedText text={designSystemBullet()} progress="--ti" charClassName="typed-suggestion" />
								</span>
							</li>
						</ul>

						<div
							className={cn(
								"relative col-start-1 grid min-w-0 [transform:translateX(calc(var(--dir)*(1-var(--cm))*30px))] font-ui text-[13px] leading-[1.45] text-[oklch(0.25_0.01_95)] opacity-(--cm) [transition:transform_.4s_var(--ease)] min-[900px]:col-start-2 min-[900px]:row-start-2",
								!active && "pointer-events-none",
							)}
						>
							<span
								aria-hidden="true"
								className="absolute -start-[3vw] top-[22px] hidden w-[3vw] border-t-[1.5px] border-dashed border-[oklch(0.5_0.1_150/.6)] min-[900px]:block"
							/>
							<div
								inert={step !== 1}
								className="col-start-1 row-start-1 flex flex-col gap-[9px] rounded-xl border border-[oklch(0.9_0.006_95)] bg-white px-[13px] py-3 opacity-[calc(1-var(--cl))] shadow-[0_12px_30px_-12px_oklch(0.2_0.01_95/.3)]"
							>
								<div className="flex items-center gap-2">
									<span className="flex size-[22px] items-center justify-center rounded-full bg-[oklch(0.94_0.035_150)] text-[oklch(0.42_0.1_150)]">
										<Icon name="auto_awesome" size={15} />
									</span>
									<b className="font-semibold">{t`Assistant`}</b>
								</div>
								<span>{t`Lead with the result and give it a scale.`}</span>
								<div className="flex flex-wrap gap-1.5">
									<button
										ref={acceptRef}
										type="button"
										onClick={accept}
										className="h-[30px] rounded-md bg-[oklch(0.5_0.1_150)] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[oklch(0.44_0.1_150)]"
									>
										{t`Accept`}
									</button>
									<button
										type="button"
										onClick={() => reopen(false)}
										className="h-[30px] rounded-md border border-[oklch(0.82_0.008_95)] bg-white px-[11px] text-[12.5px] font-medium text-[oklch(0.25_0.01_95)] transition-colors hover:bg-[oklch(0.96_0.005_95)]"
									>
										{t`Keep mine`}
									</button>
								</div>
							</div>
							<div
								inert={step !== 2}
								className="col-start-1 row-start-1 flex items-center gap-2 self-start rounded-xl bg-[oklch(0.95_0.03_150)] px-[13px] py-2.5 font-medium text-[oklch(0.38_0.1_150)] opacity-(--cl)"
							>
								<Icon name="check" size={17} />
								{t`Accepted`}
								{/* Undo scrubs the scene back, which reduced motion doesn't do, so it's left out there. */}
								<button
									ref={undoRef}
									type="button"
									onClick={() => reopen(true)}
									className="ms-auto flex h-7 items-center gap-[3px] rounded-sm px-2 text-[12.5px] font-medium text-[oklch(0.3_0.01_95)] transition-colors hover:bg-[oklch(0.9_0.04_150)] motion-reduce:hidden"
								>
									<Icon name="undo" size={16} />
									{t`Undo`}
								</button>
							</div>
						</div>

						<ul className="col-start-1 list-disc ps-[1.1em]">
							<li>
								<ResearchBullet />
							</li>
						</ul>
						<div className="col-start-1 mt-[1.2em] flex flex-col gap-[.25em]">
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
