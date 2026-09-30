import type { CSSProperties } from "react";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { SegmentedControl, SegmentedControlItem } from "@reactive-resume/ui/components/segmented-control";
import { cn } from "@reactive-resume/utils/style";
import { goToScene, SCENE, useLanding } from "./scroll";
import { Sheet, sheetTemplates } from "./sheet";
import { Doodle, SceneCaption } from "./ui";

/** Where each template tab scrolls the scene to: just past its wipe. */
const TEMPLATE_AT = [0.05, 0.2, 0.36, 0.52, 0.7];

const miniAccents = [
	"oklch(0.48 0.1 150)",
	"oklch(0.45 0.1 250)",
	"oklch(0.5 0.12 40)",
	"oklch(0.25 0.01 95)",
	"oklch(0.55 0.1 200)",
	"oklch(0.5 0.14 330)",
	"oklch(0.6 0.12 80)",
];

/**
 * The contact sheet the scene zooms out to: fifteen thumbnails, five by three. The middle one is left empty for the
 * stack of full pages, which shrinks into its place.
 */
const minis = Array.from({ length: 15 }, (_, index) => {
	const kind = (index * 7 + 3) % 6;
	const accent = miniAccents[(index * 5 + 1) % miniAccents.length] as string;
	return {
		index,
		number: index < 7 ? index + 2 : index + 1,
		accent,
		banded: kind === 1 || kind === 4,
		sidebar: kind === 2 || kind === 4 || kind === 5,
		centred: kind === 3 || kind === 4,
		ruled: kind === 0,
		wideName: kind === 5,
		sidebarEnd: kind === 5,
		rise: 30 + ((index * 37) % 60),
	};
});

const bar = "h-[1.6cqw] bg-[oklch(0.88_0.006_95)]";

function MiniPage({ mini }: { mini: (typeof minis)[number] }) {
	const accentBar = { background: mini.accent };
	return (
		<div className="@container absolute inset-0 flex flex-col overflow-hidden rounded-[2px] bg-paper shadow-paper">
			<div
				className="flex flex-col gap-[2.6cqw] px-[9cqw] pt-[9cqw] pb-[6cqw]"
				style={{
					background: mini.banded ? mini.accent : undefined,
					alignItems: mini.centred ? "center" : "flex-start",
					borderBottom: mini.ruled ? `0.4cqw solid ${mini.accent}` : undefined,
				}}
			>
				<span
					className="h-[5.5cqw] rounded-[1cqw]"
					style={{ width: mini.wideName ? "76%" : "54%", background: mini.banded ? "#fff" : "oklch(0.3 0.01 95)" }}
				/>
				<span className="h-[2.4cqw] w-[34%] rounded-[1cqw]" style={accentBar} />
			</div>
			<div
				className="grid flex-1"
				style={{ gridTemplateColumns: mini.sidebar ? "minmax(0,34fr) minmax(0,66fr)" : "minmax(0,1fr)" }}
			>
				{mini.sidebar && (
					<div
						className="flex flex-col gap-[2.6cqw] px-[5cqw] py-[7cqw]"
						style={{ order: mini.sidebarEnd ? 2 : 0, background: `color-mix(in oklch, ${mini.accent} 10%, white)` }}
					>
						<span className="h-[2.2cqw] w-[60%]" style={accentBar} />
						<span className={bar} />
						<span className={bar} />
						<span className={cn(bar, "w-[70%]")} />
						<span className="mt-[3cqw] h-[2.2cqw] w-1/2" style={accentBar} />
						<span className={bar} />
					</div>
				)}
				<div className="order-1 flex flex-col gap-[2.6cqw] px-[8cqw] py-[7cqw]">
					<span className="h-[2.2cqw] w-[32%]" style={accentBar} />
					<span className={bar} />
					<span className={bar} />
					<span className={cn(bar, "w-[80%]")} />
					<span className="mt-[3cqw] h-[2.2cqw] w-[40%]" style={accentBar} />
					<span className={bar} />
					<span className={bar} />
					<span className={cn(bar, "w-[64%]")} />
					<span className={bar} />
					<span className={cn(bar, "w-[72%]")} />
					<span className="mt-[3cqw] h-[2.2cqw] w-[36%]" style={accentBar} />
					<span className={bar} />
					<span className={cn(bar, "w-[55%]")} />
				</div>
			</div>
		</div>
	);
}

/** "No. 02", or "No. 02 · Sidebar" with a template name. */
function pageNumber(value: number, name?: string) {
	const number = i18n.number(value, { minimumIntegerDigits: 2 });
	return name ? t`No. ${number} · ${name}` : t`No. ${number}`;
}
const pageLabel = "font-martian font-medium text-[calc(var(--pw)*.045)] leading-none tracking-[.06em] text-ink-3";

/**
 * 02 Design. The word "Design." changes its type as five templates wipe across the page in turn, then the scene
 * zooms out to a contact sheet of all fifteen. The template tabs jump to each wipe.
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
	const templateNames = sheetTemplates.map((template) => i18n._(template.name));

	return (
		<section
			id="design"
			data-scene={SCENE.design}
			data-pin
			aria-labelledby="design-title"
			className="relative h-[380vh] motion-reduce:h-svh min-[900px]:h-[440vh]"
		>
			<div className="sticky top-0 h-svh overflow-hidden [--dpt:55%] [--pw:min(42vw,30vh)] [--w1:clamp(0,(var(--p)-.1)/.1,1)] [--w2:clamp(0,(var(--p)-.26)/.1,1)] [--w3:clamp(0,(var(--p)-.42)/.1,1)] [--w4:clamp(0,(var(--p)-.58)/.1,1)] [--z:clamp(0,(var(--p)-.76)/.16,1)] min-[900px]:[--dpt:57%] min-[900px]:[--pw:min(24vw,44vh)]">
				<Doodle
					name="curve"
					wipe="clamp(0, (var(--p) - .03) / .2, 1)"
					className="start-[79vw] top-[62vh] w-[16vw] translate-y-[calc(var(--p)*-50px)] rotate-[8deg] max-[900px]:hidden"
					style={{ "--doodle-fade": "calc(1 - var(--z))" } as CSSProperties}
				/>

				<h2
					id="design-title"
					className="absolute inset-x-0 top-[11vh] h-[1.05em] [transform:translateY(calc(var(--z)*-10vh))] text-[14vw] font-normal text-ink opacity-[calc(1-var(--z))] will-change-[transform,opacity] min-[900px]:top-[9vh] min-[900px]:text-[clamp(64px,7.5vw,140px)]"
				>
					<span className="absolute inset-0 text-center font-display leading-none tracking-[-.03em] opacity-[calc(1-var(--w1))]">
						{design}
						<span className="text-accent">.</span>
					</span>
					<span
						aria-hidden="true"
						data-text={`${design}.`}
						className="absolute inset-0 text-center font-ui text-[.9em] leading-[1.1] font-medium tracking-[-.04em] text-[oklch(0.5_0.11_250)] opacity-[calc(var(--w1)*(1-var(--w2)))] before:content-[attr(data-text)] dark:text-[oklch(0.74_0.11_250)]"
					/>
					<span
						aria-hidden="true"
						data-text={`${design}.`}
						className="absolute inset-0 text-center font-display leading-none tracking-[-.03em] text-[oklch(0.56_0.13_40)] italic opacity-[calc(var(--w2)*(1-var(--w3)))] before:content-[attr(data-text)] dark:text-[oklch(0.74_0.12_40)]"
					/>
					<span
						aria-hidden="true"
						data-text={`${design}_`}
						className="font-martian absolute inset-0 text-center text-[.66em] leading-[1.5] font-light tracking-[-.02em] uppercase opacity-[calc(var(--w3)*(1-var(--w4)))] before:content-[attr(data-text)]"
					/>
					<span
						aria-hidden="true"
						data-text={`${design}.`}
						className="font-anybody absolute inset-0 text-center leading-none font-light tracking-[-.03em] uppercase font-stretch-[90%] opacity-(--w4) before:content-[attr(data-text)]"
					/>
				</h2>

				<div
					aria-hidden="true"
					className="absolute top-[calc(var(--dpt)-var(--z)*4vh)] left-1/2 grid [transform:translate(-50%,-50%)_scale(calc(1-var(--z)*(1-var(--smin,.5))))] grid-cols-[repeat(5,var(--pw))] gap-[calc(var(--pw)*.12)] opacity-(--z) will-change-[transform,opacity] [transition:transform_.35s_var(--ease)]"
				>
					{minis.map((mini) => (
						<div
							key={mini.index}
							className={cn(
								"relative aspect-[612/792] [transform:translateY(calc((1-var(--z))*var(--rise)))] will-change-transform [transition:transform_.5s_var(--ease)]",
								mini.index === 7 && "invisible",
							)}
							style={{ "--rise": `${mini.rise}px` } as CSSProperties}
						>
							<MiniPage mini={mini} />
							<span className={cn(pageLabel, "absolute start-0 top-[calc(100%+10px)]")}>{pageNumber(mini.number)}</span>
						</div>
					))}
				</div>

				<div
					data-stack
					className="absolute top-[calc(var(--dpt)-var(--z)*4vh)] left-1/2 aspect-[612/792] w-(--pw) [transform:translate(-50%,-50%)_scale(calc(1-var(--z)*(1-var(--smin,.5))))] will-change-transform [transition:transform_.35s_var(--ease)]"
				>
					<div className="absolute inset-0 rounded-[2px] shadow-paper" />
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
									<span className="font-martian absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-full bg-ink px-[9px] py-[5px] text-[10.5px] leading-none font-medium tracking-[.06em] whitespace-nowrap text-bg">
										{pageNumber(index + 1, templateNames[index])}
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
						{pageNumber(1, templateNames[step])}
					</span>
				</div>

				<SegmentedControl
					aria-label={t`Templates`}
					value={step}
					onValueChange={(value) => goToScene(SCENE.design, TEMPLATE_AT[value as number] ?? 0)}
					inert={zoomed}
					className={cn(
						"absolute bottom-[5vh] left-1/2 flex h-auto max-w-[calc(100vw-2*var(--gutter))] -translate-x-1/2 [scrollbar-width:none] overflow-x-auto rounded-full border border-line bg-[color-mix(in_oklch,var(--surface)_85%,transparent)] p-1 whitespace-nowrap opacity-[calc(1-var(--z)*2)] backdrop-blur-[8px] min-[900px]:bottom-[clamp(20px,5vh,44px)]",
						!active && "pointer-events-none",
					)}
				>
					{templateNames.map((name, index) => (
						<SegmentedControlItem
							key={name}
							value={index}
							className="h-8 flex-none rounded-full px-3 font-ui duration-300 min-[900px]:px-[13px] data-checked:bg-ink data-checked:text-bg data-checked:shadow-none"
						>
							{name}
						</SegmentedControlItem>
					))}
				</SegmentedControl>

				<SceneCaption
					number="02"
					title={design}
					className="absolute start-(--gutter) bottom-[clamp(20px,5vh,44px)] hidden max-w-[22em] opacity-[calc(1-var(--z)*2)] min-[1100px]:flex"
				>
					{t`Pick a template, then set the type, color and spacing. The words stay put, so try as many looks as you like.`}
				</SceneCaption>

				<p className="pointer-events-none absolute inset-x-(--gutter) bottom-[8vh] [transform:translateY(calc((1-var(--z))*30px))] text-center text-[8vw] leading-none text-balance opacity-(--z) will-change-[transform,opacity] min-[900px]:bottom-[6vh] min-[900px]:text-[clamp(40px,5vw,90px)]">
					<span className="font-anybody font-light tracking-[-.02em] text-ink">{t`Fifteen templates.`}</span>{" "}
					<span className="font-display tracking-[-.02em] text-accent-text italic">{t`Make any of them yours.`}</span>
				</p>
			</div>
		</section>
	);
}
