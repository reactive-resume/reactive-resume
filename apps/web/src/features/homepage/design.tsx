import type { CSSProperties } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { templateSchema } from "@reactive-resume/schema/templates";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import { goToScene, SCENE, useLanding } from "./scroll";
import { Sheet, sheetTemplates } from "./sheet";
import { Doodle, SceneCaption } from "./ui";
import { templates } from "@/dialogs/resume/template/data";

/** Where each template tab scrolls the scene to: just past its wipe. */
const TEMPLATE_AT = [0.05, 0.2, 0.36, 0.52, 0.7];

/**
 * The contact sheet the scene zooms out to: every real template, six by three, with Alex's page taking the eighteenth
 * cell. Its cell sits half a column left of centre, so the page drifts there as the sheet comes in.
 */
const STACK_CELL = 8;
const sheetCells = (() => {
	const names = [...templateSchema.options];
	return Array.from({ length: 18 }, (_, index) => ({
		index,
		template: index === STACK_CELL ? null : (names.shift() ?? null),
		rise: 30 + ((index * 37) % 60),
	}));
})();

/** "No. 02 · Sidebar": a look's place in the stack and its name. */
function pageNumber(value: number, name: string) {
	const number = i18n.number(value, { minimumIntegerDigits: 2 });
	return t`No. ${number} · ${name}`;
}
const pageLabel = "font-martian font-medium text-[calc(var(--pw)*.045)] leading-none tracking-[.06em] text-ink-3";

/**
 * 02 Design. The word "Design." changes its type as five looks wipe across the page in turn, then the scene zooms out
 * to a contact sheet of every real template, with Alex's page settling into a cell of its own. The tabs jump to each
 * wipe.
 *
 * Everything that moves with the scroll sits on its own layer (will-change), and the wipes slide clipped layers
 * rather than animating clip-path. Otherwise every scrolled frame repaints the whole sticky stage, which Android
 * Chromium can't raster in time, so the scene flickers.
 */
export function Design() {
	const step = useLanding((state) => state.designStep);
	const zoomed = useLanding((state) => state.designZoomed);
	const active = useLanding((state) => state.activeScene === SCENE.design);
	const design = t`Design`;
	const templateCount = i18n.number(templateSchema.options.length);
	const templateNames = sheetTemplates.map((template) => i18n._(template.name));
	const railRef = useRef<HTMLDivElement>(null);

	// On narrow screens the tab rail scrolls; keep the current look in view.
	useEffect(() => {
		const rail = railRef.current;
		const checked = rail?.querySelector<HTMLElement>("[data-checked]");
		if (!rail || !checked || rail.scrollWidth <= rail.clientWidth) return;
		rail.scrollTo({ left: checked.offsetLeft - rail.clientWidth / 2 + checked.offsetWidth / 2, behavior: "smooth" });
	}, [step]);

	return (
		<section
			id="design"
			data-scene={SCENE.design}
			data-pin
			aria-labelledby="design-title"
			className="relative h-[320vh] motion-reduce:h-svh min-[900px]:h-[360vh]"
		>
			<div className="sticky top-0 h-svh overflow-clip [--dpt:52%] [--pw:min(66vw,42vh)] [--w1:clamp(0,(var(--p)-.1)/.1,1)] [--w2:clamp(0,(var(--p)-.26)/.1,1)] [--w3:clamp(0,(var(--p)-.42)/.1,1)] [--w4:clamp(0,(var(--p)-.58)/.1,1)] [--z:clamp(0,(var(--p)-.76)/.16,1)] min-[900px]:[--dpt:57%] min-[900px]:[--pw:min(24vw,44vh)]">
				<Doodle
					name="curve"
					wipe="clamp(0, (var(--p) - .03) / .2, 1)"
					sizes="16vw"
					className="start-[79vw] top-[62vh] w-[16vw] translate-y-[calc(var(--p)*-50px)] rotate-[8deg] [--doodle-fade:calc(1-var(--z))] max-[900px]:hidden"
				/>

				<div
					aria-hidden="true"
					className="absolute inset-x-0 top-[12vh] h-[1.05em] [transform:translateY(calc(var(--z)*-10vh))] text-[15vw] font-normal text-ink opacity-[calc(1-var(--z))] will-change-[transform,opacity] min-[900px]:top-[10vh] min-[900px]:text-[clamp(80px,10vw,180px)]"
				>
					<span className="absolute inset-0 text-center font-display leading-none tracking-[-.03em] opacity-[calc(1-clamp(0,(var(--w1)-.35)*3.4,1))]">
						{design}
						<span className="text-accent">.</span>
					</span>
					<span
						aria-hidden="true"
						data-text={`${design}.`}
						className="absolute inset-0 text-center font-ui text-[.9em] leading-[1.1] font-medium tracking-[-.04em] text-[oklch(0.5_0.11_250)] opacity-[calc(clamp(0,(var(--w1)-.35)*3.4,1)*(1-clamp(0,(var(--w2)-.35)*3.4,1)))] before:content-[attr(data-text)] dark:text-[oklch(0.74_0.11_250)]"
					/>
					<span
						aria-hidden="true"
						data-text={`${design}.`}
						className="absolute inset-0 text-center font-display leading-none tracking-[-.03em] text-[oklch(0.56_0.13_40)] italic opacity-[calc(clamp(0,(var(--w2)-.35)*3.4,1)*(1-clamp(0,(var(--w3)-.35)*3.4,1)))] before:content-[attr(data-text)] dark:text-[oklch(0.74_0.12_40)]"
					/>
					<span
						aria-hidden="true"
						data-text={`${design}_`}
						className="font-martian absolute inset-0 text-center text-[.66em] leading-[1.5] font-light tracking-[-.02em] uppercase opacity-[calc(clamp(0,(var(--w3)-.35)*3.4,1)*(1-clamp(0,(var(--w4)-.35)*3.4,1)))] before:content-[attr(data-text)]"
					/>
					<span
						aria-hidden="true"
						data-text={`${design}.`}
						className="font-anybody absolute inset-0 text-center leading-none font-light tracking-[-.03em] uppercase font-stretch-[90%] opacity-[clamp(0,(var(--w4)-.35)*3.4,1)] before:content-[attr(data-text)]"
					/>
				</div>

				<div
					aria-hidden="true"
					className="absolute top-(--dpt) left-1/2 grid [transform:translate(-50%,calc(-50%-var(--z)*8vh))_scale(calc(1-var(--z)*(1-var(--smin,.5))))] grid-cols-[repeat(6,var(--pw))] gap-[calc(var(--pw)*.12)] opacity-(--z) will-change-[transform,opacity] [transition:transform_.35s_var(--ease)]"
				>
					{sheetCells.map((cell) => (
						<div
							key={cell.index}
							className={cn(
								"relative aspect-[612/792] [transform:translateY(calc((1-var(--z))*var(--rise)))] will-change-transform [transition:transform_.5s_var(--ease)]",
								!cell.template && "invisible",
							)}
							style={{ "--rise": `${cell.rise}px` } as CSSProperties}
						>
							{cell.template && (
								<>
									<img
										src={`/templates/thumb/${cell.template}.webp`}
										alt=""
										width={298}
										height={420}
										loading="lazy"
										decoding="async"
										draggable={false}
										className="absolute inset-0 size-full rounded-sm bg-paper object-contain shadow-paper dark:brightness-[.93]"
									/>
									<span className={cn(pageLabel, "absolute start-0 top-[calc(100%+10px)]")}>
										{templates[cell.template].name}
									</span>
								</>
							)}
						</div>
					))}
				</div>

				<div
					data-stack
					className="absolute top-(--dpt) left-1/2 aspect-[612/792] w-(--pw) [transform:translate(calc(-50%-var(--dir)*var(--z)*.56*var(--pw)*(1-var(--z)*(1-var(--smin,.5)))),calc(-50%-var(--z)*8vh))_scale(calc(1-var(--z)*(1-var(--smin,.5))))] opacity-[clamp(0,var(--p)*20,1)] will-change-[transform,opacity] [transition:transform_.35s_var(--ease)]"
				>
					<div className="absolute inset-0 rounded-sm shadow-paper" />
					{sheetTemplates.map((template, index) => (
						<div
							key={template.name.id}
							className="absolute inset-0"
							style={{ "--w": index === 0 ? 1 : `var(--w${index})` } as CSSProperties}
						>
							<div className="absolute inset-0 [transform:translateX(calc((1-var(--w))*var(--pw)))] overflow-hidden will-change-transform">
								<div className="absolute inset-0 [transform:translateX(calc((var(--w)-1)*var(--pw)))] will-change-transform">
									<Sheet template={template} />
								</div>
							</div>
							{index > 0 && (
								<div
									aria-hidden="true"
									className="absolute -top-[6%] -bottom-[6%] left-0 -ml-px w-0.5 [transform:translateX(calc((1-var(--w))*var(--pw)))] bg-ink opacity-[calc(clamp(0,var(--w)*30,1)*clamp(0,(1-var(--w))*30,1))] will-change-[transform,opacity]"
								>
									<span className="font-martian absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-sm bg-ink px-[9px] py-[5px] text-[10.5px] leading-none font-medium tracking-[.06em] whitespace-nowrap text-bg">
										{pageNumber(index + 1, templateNames[index] ?? "")}
									</span>
								</div>
							)}
						</div>
					))}
					<span
						aria-hidden="true"
						className={cn(
							pageLabel,
							"absolute start-0 top-[calc(100%+10px)] whitespace-nowrap opacity-(--z) will-change-[opacity]",
						)}
					>
						{t`Yours · ${templateNames[step] ?? ""}`}
					</span>
				</div>

				<SegmentedControl
					ref={railRef}
					aria-label={t`Templates`}
					value={step}
					onValueChange={(value) => goToScene(SCENE.design, TEMPLATE_AT[value as number] ?? 0)}
					inert={zoomed}
					className={cn(
						"blur-ok:backdrop-blur-[8px] absolute bottom-[5vh] left-1/2 flex h-auto max-w-[calc(100vw-2*var(--gutter))] -translate-x-1/2 scroll-px-1 [scrollbar-width:none] overflow-x-auto rounded-sm border border-line bg-[color-mix(in_oklch,var(--surface)_85%,transparent)] p-1 whitespace-nowrap opacity-[calc(1-var(--z)*2)] min-[900px]:bottom-[clamp(20px,5vh,44px)]",
						!active && "pointer-events-none",
					)}
				>
					{templateNames.map((name, index) => (
						<label key={name} className="contents">
							<SegmentedControlItem
								value={index}
								className="h-8 flex-none rounded-sm px-3 font-ui duration-300 min-[900px]:px-[13px] data-checked:bg-ink data-checked:text-bg data-checked:shadow-none"
							>
								{name}
							</SegmentedControlItem>
						</label>
					))}
				</SegmentedControl>

				<SceneCaption
					number="02"
					title={design}
					className="absolute start-(--gutter) bottom-[clamp(20px,5vh,44px)] hidden max-w-[22em] opacity-[calc(1-var(--z)*2)] min-[1100px]:flex"
				>
					{t`Pick from ${templateCount} templates, then set the type, color and spacing. The words stay put, so try as many looks as you like.`}
				</SceneCaption>

				<h2
					id="design-title"
					className="pointer-events-none absolute inset-x-(--gutter) top-[12vh] bottom-[8vh] [transform:translateY(calc((1-var(--z))*30px))] text-center text-[8vw] leading-none font-normal text-balance opacity-(--z) will-change-[transform,opacity] min-[900px]:bottom-[5vh] min-[900px]:text-[clamp(36px,4vw,72px)]"
				>
					<Link to="/resume-templates" inert={!zoomed} className="flex h-full flex-col justify-between">
						<span className="font-anybody pointer-events-auto font-light tracking-[-.02em] text-ink">
							{t`${templateCount} free resume templates.`}
						</span>
						<span className="pointer-events-auto font-display tracking-[-.02em] text-accent-text italic">
							{t`Make any of them yours.`}
						</span>
					</Link>
				</h2>
			</div>
		</section>
	);
}
