import type { CSSProperties, PointerEvent } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { m, useMotionTemplate, useReducedMotion, useSpring } from "motion/react";
import { useId, useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import "./resume-sculpture.css";

export type SculptureTemplate = "azurill" | "bronzor" | "ditgar";

const templates: SculptureTemplate[] = ["ditgar", "azurill", "bronzor"];

const focusRing =
	"focus-visible:outline-2 focus-visible:outline-[#e0c8b2] focus-visible:outline-offset-4 focus-visible:transition-none";

const dockLabel = "mb-[7px] block text-[11px] leading-[1.4] text-[#a5a5ab]";

const dockButton =
	"relative grid min-h-[44px] min-w-[44px] cursor-pointer place-items-center bg-transparent text-[12px] text-[#a5a5ab] [transition:transform_140ms_var(--ease-out-strong),color_150ms_ease]";

const templateIcon: Record<SculptureTemplate, string> = {
	ditgar: "bg-[linear-gradient(to_right,#aa8ebe_34%,transparent_34%)]",
	azurill:
		"bg-[linear-gradient(to_bottom,#aa8ebe_20%,transparent_20%),linear-gradient(to_right,transparent_28%,#b6aea7_28%,#b6aea7_32%,transparent_32%)]",
	bronzor: "bg-[repeating-linear-gradient(to_bottom,transparent_0_4px,#b6aea7_4px_5px)]",
};

type ResumeSculptureProps = {
	template: SculptureTemplate;
	onTemplateChange: (template: SculptureTemplate) => void;
	name: string;
	onNameChange: (name: string) => void;
	accent: string;
	onAccentChange: (accent: string) => void;
	typeface: "sans" | "serif";
	onTypefaceChange: (typeface: "sans" | "serif") => void;
};

export function ResumeSculpture({
	template,
	onTemplateChange,
	name,
	onNameChange,
	accent,
	onAccentChange,
	typeface,
	onTypefaceChange,
}: ResumeSculptureProps) {
	const colors = [
		{ name: t`Plum`, value: "#735c9a" },
		{ name: t`Moss`, value: "#507665" },
		{ name: t`Clay`, value: "#a26046" },
	];
	const displayName = name || t`Your name`;
	const nameId = useId();
	const [spread, setSpread] = useState(false);
	const [keyboardAction, setKeyboardAction] = useState(false);
	const [dragging, setDragging] = useState(false);
	const dragOrigin = useRef<{ id: number; x: number; y: number; rotateX: number; rotateY: number } | null>(null);
	const reducedMotion = useReducedMotion();
	const rotateX = useSpring(10, { stiffness: 180, damping: 26 });
	const rotateY = useSpring(-19, { stiffness: 180, damping: 26 });
	const transform = useMotionTemplate`rotateX(${rotateX}deg) rotateY(${rotateY}deg) rotateZ(-7deg)`;

	function startDrag(event: PointerEvent<HTMLDivElement>) {
		if (event.pointerType === "touch" || event.button !== 0 || dragOrigin.current || reducedMotion) return;
		dragOrigin.current = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			rotateX: rotateX.get(),
			rotateY: rotateY.get(),
		};
		event.currentTarget.setPointerCapture(event.pointerId);
		setDragging(true);
	}

	function turnPages(event: PointerEvent<HTMLDivElement>) {
		const origin = dragOrigin.current;
		if (!origin || origin.id !== event.pointerId) return;
		rotateX.set(origin.rotateX - Math.tanh((event.clientY - origin.y) / 170) * 18);
		rotateY.set(origin.rotateY + Math.tanh((event.clientX - origin.x) / 170) * 32);
	}

	function endDrag(event: PointerEvent<HTMLDivElement>) {
		if (dragOrigin.current?.id !== event.pointerId) return;
		dragOrigin.current = null;
		setDragging(false);
		if (event.currentTarget.hasPointerCapture(event.pointerId))
			event.currentTarget.releasePointerCapture(event.pointerId);
		rotateX.set(10);
		rotateY.set(-19);
	}

	return (
		<div className="@container mx-auto w-full max-w-[620px] text-(--home-ink) max-[960px]:mt-[25px] max-[900px]:max-w-[560px]">
			<div className="perspective-[1400px] relative aspect-[620/600]">
				<div
					className="absolute right-[5%] bottom-0 left-[15%] h-[10%] rounded-full bg-black opacity-70 blur-[18px]"
					aria-hidden="true"
				/>
				<div
					className={cn(
						"transform-3d absolute inset-0 cursor-grab pointer-coarse:cursor-auto touch-pan-y select-none motion-reduce:cursor-auto",
						dragging && "cursor-grabbing",
					)}
					onPointerDown={startDrag}
					onPointerMove={turnPages}
					onPointerUp={endDrag}
					onPointerCancel={endDrag}
					onLostPointerCapture={endDrag}
				>
					<m.div
						className="sculpture-rig group/rig transform-3d absolute inset-0"
						data-spread={spread}
						data-instant={keyboardAction}
						style={{ transform }}
					>
						{templates.map((paperTemplate, index) => {
							const position = (index - templates.indexOf(template) + templates.length) % templates.length;
							return (
								<ResumePaper
									key={paperTemplate}
									name={displayName}
									accent={accent}
									typeface={typeface}
									template={paperTemplate}
									position={position === 0 ? "front" : position === 1 ? "left" : "right"}
								/>
							);
						})}
					</m.div>
				</div>
			</div>
			<div className="flex items-center justify-between @max-[450px]:gap-1 gap-3 @max-[450px]:px-0 px-2 pt-[14px] pb-[18px] text-(--home-muted)">
				<p className="flex items-center gap-[9px] @max-[450px]:text-[11px] text-[12px]">
					<span aria-hidden="true">↔</span>{" "}
					<span className="pointer-coarse:hidden motion-reduce:hidden">
						<Trans>Drag to turn the pages</Trans>
					</span>
					<span className="pointer-coarse:inline hidden motion-reduce:inline">
						<Trans>Make it your own</Trans>
					</span>
				</p>

				<button
					type="button"
					className={cn(
						"flex min-h-[44px] cursor-pointer items-center gap-[14px] bg-transparent px-2 @max-[450px]:text-[11px] text-(--home-ink) text-[12px] hover:text-white",
						focusRing,
					)}
					aria-pressed={spread}
					onClick={(event) => {
						setKeyboardAction(event.detail === 0);
						setSpread(!spread);
					}}
				>
					{spread ? t`Stack pages` : t`Spread pages`}
					<span className="font-light text-[21px]" aria-hidden="true">
						{spread ? "−" : "+"}
					</span>
				</button>
			</div>
			<fieldset className="mb-4 flex @max-[300px]:gap-[5px] gap-2" aria-label={t`Choose a resume template`}>
				{templates.map((option) => (
					<button
						key={option}
						type="button"
						className={cn(
							"flex min-h-[44px] flex-1 cursor-pointer items-center justify-center @max-[300px]:gap-[5px] gap-[9px] rounded-[4px] border border-[#343437] bg-[#19191b] p-2 @max-[300px]:text-[11px] text-[#a5a5ab] text-[12px] hover:text-white aria-pressed:border-[#8c7b6d] aria-pressed:bg-[#262427] aria-pressed:text-[#f1f0eb] aria-pressed:hover:text-white",
							focusRing,
						)}
						aria-pressed={option === template}
						onClick={(event) => {
							setKeyboardAction(event.detail === 0);
							onTemplateChange(option);
						}}
					>
						<span
							className={cn("h-[21px] w-[16px] rounded-[2px] border border-[#b6aea7]", templateIcon[option])}
							aria-hidden="true"
						/>
						{option === "ditgar" ? "Ditgar" : option === "azurill" ? "Azurill" : "Bronzor"}
					</button>
				))}
			</fieldset>
			<div className="grid @max-[300px]:grid-cols-1 @max-[450px]:grid-cols-[1fr_auto] grid-cols-[minmax(120px,1fr)_auto_auto] @max-[450px]:gap-[17px] gap-5 rounded-[4px] border border-[#363638] bg-[#1b1b1d] @max-[450px]:p-[17px] px-[21px] py-[19px] shadow-[0_15px_30px_rgb(0_0_0/16%),inset_0_1px_0_rgb(255_255_255/3%)]">
				<div className="@max-[450px]:col-span-full">
					<label htmlFor={nameId} className={dockLabel}>
						<Trans>Your name</Trans>
					</label>
					<input
						id={nameId}
						className={cn(
							"min-h-[44px] w-full rounded-[4px] border border-[#3b3b3e] bg-[#232326] px-[11px] text-[#f1f0eb] text-[13px]",
							focusRing,
						)}
						value={name}
						maxLength={40}
						onChange={(event) => onNameChange(event.target.value)}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<fieldset className="min-w-0">
					<legend className={dockLabel}>
						<Trans>Color</Trans>
					</legend>
					<div className="flex">
						{colors.map((color) => (
							<button
								key={color.value}
								type="button"
								className={cn(
									dockButton,
									"active:transform-[scale(0.96)] rounded-[4px] motion-reduce:active:transform-none",
									focusRing,
								)}
								aria-label={color.name}
								aria-pressed={accent === color.value}
								onClick={() => onAccentChange(color.value)}
							>
								<span
									className={cn(
										"size-[23px] rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/12%)]",
										accent === color.value && "outline-1 outline-[#dedbd6] outline-offset-4",
									)}
									style={{ backgroundColor: color.value }}
								/>
							</button>
						))}
					</div>
				</fieldset>
				<fieldset className="min-w-0">
					<legend className={dockLabel}>
						<Trans>Typeface</Trans>
					</legend>
					<div className="flex @max-[300px]:w-max rounded-[4px] border border-[#3b3b3e]">
						{(["sans", "serif"] as const).map((font) => (
							<button
								key={font}
								type="button"
								className={cn(
									dockButton,
									"min-h-[36px] @max-[450px]:min-w-[64px] min-w-[45px] hover:text-white aria-pressed:bg-[#37373b] aria-pressed:text-[#f1f0eb] aria-pressed:hover:text-white",
									font === "sans" ? "rounded-s-[4px]" : "rounded-e-[4px] font-[Georgia,serif]",
									focusRing,
								)}
								aria-pressed={typeface === font}
								onClick={() => onTypefaceChange(font)}
							>
								{font === "sans" ? t`Sans` : t`Serif`}
							</button>
						))}
					</div>
				</fieldset>
			</div>
		</div>
	);
}

const paperTransform = {
	front:
		"transform-[translate3d(0,0,45px)_rotateZ(2deg)] group-data-[spread=true]/rig:transform-[translate3d(0,-2%,75px)_rotateZ(0deg)]",
	left: "transform-[translate3d(-12%,4%,-65px)_rotateX(-2deg)_rotateY(-3deg)_rotateZ(-13deg)] group-data-[spread=true]/rig:transform-[translate3d(-36%,1%,-80px)_rotateX(-2deg)_rotateY(-3deg)_rotateZ(-24deg)]",
	right:
		"transform-[translate3d(13%,-1%,-25px)_rotateX(2deg)_rotateY(3deg)_rotateZ(13deg)] group-data-[spread=true]/rig:transform-[translate3d(34%,-4%,-40px)_rotateX(2deg)_rotateY(3deg)_rotateZ(24deg)]",
};

const paperSide =
	"absolute inset-0 border border-[#e6e2db] shadow-[8px_15px_20px_rgb(0_0_0/35%),18px_38px_45px_rgb(0_0_0/45%)] backface-hidden";

// Per-template layout of the paper face and its regions.
const face: Record<SculptureTemplate, string> = {
	azurill:
		"grid grid-cols-[28%_1fr] grid-rows-[auto_auto_auto_auto_1fr] gap-x-[2cqw] gap-y-[1.7cqw] p-[7%] [grid-template-areas:'identity_identity'_'skills_summary'_'skills_experience'_'skills_education'_'skills_projects']",
	bronzor: "flex flex-col gap-[1.1cqw] p-[6%]",
	ditgar:
		"grid grid-cols-[34%_66%] grid-rows-[minmax(28%,max-content)_auto_auto_1fr] gap-0 bg-[linear-gradient(to_right,color-mix(in_srgb,var(--resume-accent)_20%,#fcfaf5)_34%,#fcfaf5_34%)] pb-[7%] [grid-template-areas:'identity_summary'_'skills_experience'_'skills_education'_'skills_projects']",
};

const header: Record<SculptureTemplate, string> = {
	azurill: "pb-[1.7cqw] text-center [grid-area:identity]",
	bronzor: "pb-[1.1cqw] text-center",
	ditgar: "bg-(--resume-accent) p-[2.3cqw] text-left text-white [grid-area:identity]",
};

const bronzorRow = "grid grid-cols-[25%_1fr] gap-[1.4cqw] border-t border-(--resume-accent) pt-[1cqw]";

const sections: Record<
	SculptureTemplate,
	Record<"summary" | "skills" | "experience" | "education" | "projects", string>
> = {
	azurill: {
		summary: "[grid-area:summary]",
		skills: "border-r border-[color-mix(in_srgb,var(--resume-accent)_35%,white)] pr-[1cqw] [grid-area:skills]",
		experience: "[grid-area:experience]",
		education: "[grid-area:education]",
		projects: "[grid-area:projects]",
	},
	bronzor: {
		summary: bronzorRow,
		skills: bronzorRow,
		experience: bronzorRow,
		education: bronzorRow,
		projects: bronzorRow,
	},
	ditgar: {
		summary:
			"bg-[color-mix(in_srgb,var(--resume-accent)_20%,#fcfaf5)] p-[2.6cqw] text-[1.3cqw] leading-[1.65] [grid-area:summary]",
		skills: "px-[2.3cqw] py-[2.6cqw] [grid-area:skills]",
		experience: "px-[2.6cqw] pt-[2.4cqw] [grid-area:experience]",
		education: "px-[2.6cqw] pt-[2.2cqw] [grid-area:education]",
		projects: "px-[2.6cqw] pt-[2.2cqw] [grid-area:projects]",
	},
};

const job: Record<SculptureTemplate, string> = {
	azurill: "block",
	bronzor: "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-[0.7cqw] gap-y-[0.25cqw]",
	ditgar: "ml-[calc(-0.8cqw_-_2px)] block border-l-2 border-(--resume-accent) pl-[0.8cqw]",
};

const h4 = "text-[1.2cqw] leading-[1.3] font-[650]";
const sectionP = "mt-[0.5cqw] text-[#5c5663]";
const date = "block whitespace-nowrap text-[1cqw] text-[#746d79]";

type ResumePaperProps = {
	name: string;
	accent: string;
	typeface: "sans" | "serif";
	template: SculptureTemplate;
	position: "front" | "left" | "right";
};

function ResumePaper({ name, accent, typeface, template, position }: ResumePaperProps) {
	const bronzor = template === "bronzor";
	const ditgar = template === "ditgar";
	const h3 = cn(
		"mb-[0.9cqw] font-[650] text-(--resume-accent) text-[1.5cqw] leading-[1.2]",
		ditgar && "border-(--resume-accent) border-b pb-[0.6cqw]",
	);
	const jobEntry = cn(
		"relative",
		template === "azurill" &&
			"before:absolute before:top-[0.35cqw] before:-left-[1.75cqw] before:size-[0.85cqw] before:rounded-full before:border before:border-(--resume-accent) before:bg-[#fcfaf5] before:content-['']",
	);
	const jobStrong = cn("block font-medium", bronzor ? "col-span-full row-2" : "mt-[0.25cqw]");
	const jobDate = cn(date, bronzor ? "col-2 row-1" : "mt-[0.25cqw]");

	return (
		<article
			className={cn(
				"sculpture-paper transform-3d absolute top-[2%] left-[24%] aspect-[210/297] w-[56%] origin-[50%_80%] animate-[home-sculpture-assemble_900ms_var(--ease-out-strong)_both] transition-[transform] duration-[650ms] ease-out-strong group-data-[instant=true]/rig:transition-none",
				paperTransform[position],
			)}
			data-template={template}
			data-position={position}
			data-typeface={typeface}
			data-long-name={name.length > 18}
			aria-hidden={position !== "front"}
			aria-label={t`Sample resume for ${name}`}
			style={{ "--resume-accent": accent } as CSSProperties}
		>
			<div
				className={cn(
					"sculpture-paper-back transform-[rotateY(180deg)_translateZ(1px)] bg-[linear-gradient(105deg,#ebe7dd,#fbf8f0_42%,#eee9e0)]",
					paperSide,
				)}
				aria-hidden="true"
			/>
			<span
				className="sculpture-edge transform-[translateX(-50%)_rotateY(90deg)] absolute top-0 left-0 h-full w-[2px] bg-[linear-gradient(#fffdf7,#b6aea2,#efebe1)]"
				aria-hidden="true"
			/>
			<span
				className="sculpture-edge transform-[translateX(-50%)_rotateY(90deg)] absolute top-0 left-full h-full w-[2px] bg-[linear-gradient(#fffdf7,#b6aea2,#efebe1)]"
				aria-hidden="true"
			/>
			<span
				className="sculpture-edge transform-[translateY(-50%)_rotateX(90deg)] absolute top-0 left-0 h-[2px] w-full bg-[linear-gradient(#fffdf7,#b6aea2,#efebe1)]"
				aria-hidden="true"
			/>
			<span
				className="sculpture-edge transform-[translateY(-50%)_rotateX(90deg)] absolute top-full left-0 h-[2px] w-full bg-[linear-gradient(#fffdf7,#b6aea2,#efebe1)]"
				aria-hidden="true"
			/>
			<div
				className={cn(
					"sculpture-paper-face transform-[translateZ(1px)] overflow-hidden bg-[#fcfaf5] text-[#24222a] text-[1.2cqw] leading-[1.45] after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(110deg,rgb(255_255_255/10%),transparent_35%,rgb(62_42_12/3%)_97%,rgb(255_255_255/30%))] after:content-['']",
					typeface === "serif" ? "font-[Georgia,serif]" : "font-[Arial,sans-serif]",
					paperSide,
					face[template],
				)}
			>
				<header className={header[template]}>
					<h2
						className={cn(
							"wrap-anywhere mb-[1cqw] font-[650] leading-[1.1] tracking-[-0.05em]",
							name.length > 18 ? "text-[1.9cqw]" : ditgar ? "text-[3.5cqw]" : "text-[3.8cqw]",
						)}
					>
						{name}
					</h2>
					<p className={cn("mb-[1cqw]", ditgar ? "text-[1.2cqw] text-white" : "text-[#55515c] text-[1.45cqw]")}>
						<Trans>Product designer</Trans>
					</p>
					<div
						className={
							ditgar
								? "wrap-anywhere grid justify-start justify-items-start gap-[0.55cqw] text-[0.82cqw] text-white"
								: "flex flex-wrap justify-center gap-x-[1cqw] gap-y-[0.3cqw] text-[#66606c] text-[1cqw]"
						}
					>
						<span>London, UK</span>
						<span>alexmorgan.design</span>
						<span>alex.morgan@example.com</span>
					</div>
				</header>
				<section className={cn("min-w-0", sections[template].summary)}>
					<h3 className={cn(h3, ditgar && "hidden")}>
						<Trans>About me</Trans>
					</h3>
					<div>
						<p className={sectionP}>
							<Trans>I design software for teams, from early research to the details people use every day.</Trans>
						</p>
					</div>
				</section>
				<section className={cn("min-w-0", sections[template].experience)}>
					<h3 className={h3}>
						<Trans>Experience</Trans>
					</h3>
					<div className={cn(template === "azurill" && "relative border-(--resume-accent) border-l pl-[1.3cqw]")}>
						<div className={jobEntry}>
							<div className={job[template]}>
								<h4 className={h4}>Northstar Studio</h4>
								<strong className={jobStrong}>
									<Trans>Senior product designer</Trans>
								</strong>
								<span className={jobDate}>
									<Trans>2022 to now</Trans>
								</span>
							</div>
							<p className={sectionP}>
								<Trans>Built a design system used by six product teams.</Trans>
							</p>
							<ul className="mt-[0.7cqw] list-outside list-disc pl-[1.5cqw] text-[#5c5663]">
								<li>
									<Trans>Worked with engineers from idea to launch.</Trans>
								</li>
							</ul>
						</div>
						<div className={cn(jobEntry, "mt-[1.9cqw]")}>
							<div className={job[template]}>
								<h4 className={h4}>Form &amp; Field</h4>
								<strong className={jobStrong}>
									<Trans>Product designer</Trans>
								</strong>
								<span className={jobDate}>
									<Trans>2019 to 2022</Trans>
								</span>
							</div>
							<p className={sectionP}>
								<Trans>Designed websites and tools for a growing creative community.</Trans>
							</p>
						</div>
					</div>
				</section>
				<section className={cn("min-w-0", sections[template].skills)}>
					<h3 className={h3}>
						<Trans>Skills</Trans>
					</h3>
					<div className={cn(bronzor && "grid grid-cols-2 gap-x-[1.2cqw] gap-y-[0.6cqw]")}>
						<strong className={cn("block font-medium", bronzor && "row-1")}>
							<Trans>Design</Trans>
						</strong>
						<p className={sectionP}>
							<Trans>Product strategy</Trans>
							<br />
							<Trans>Interaction design</Trans>
							<br />
							<Trans>Design systems</Trans>
						</p>
						<strong className={cn("block font-medium", bronzor ? "row-1" : "mt-[2cqw]")}>
							<Trans>Tools</Trans>
						</strong>
						<p className={sectionP}>
							Figma
							<br />
							<Trans>Prototyping</Trans>
							<br />
							<Trans>User research</Trans>
						</p>
						<h3 className={cn(h3, bronzor ? "hidden" : "mt-[2cqw]")}>
							<Trans>Languages</Trans>
						</h3>
						<p className={cn(sectionP, bronzor && "hidden")}>
							<Trans>English</Trans>
							<br />
							<Trans>French</Trans>
						</p>
					</div>
				</section>
				<section className={cn("min-w-0", sections[template].education)}>
					<h3 className={h3}>
						<Trans>Education</Trans>
					</h3>
					<div>
						<h4 className={h4}>
							<Trans>Graphic Design</Trans>
						</h4>
						<p className={sectionP}>University of the West of England</p>
						<span className={cn(date, "mt-[0.25cqw]")}>
							<Trans>2015 to 2019</Trans>
						</span>
					</div>
				</section>
				<section className={cn("min-w-0", sections[template].projects)}>
					<h3 className={h3}>
						<Trans>Projects</Trans>
					</h3>
					<div>
						<h4 className={h4}>
							<Trans>Open design library</Trans>
						</h4>
						<p className={sectionP}>
							<Trans>A free collection of accessible patterns for the web.</Trans>
						</p>
					</div>
				</section>
				<footer
					className={cn(
						"absolute bottom-[3%] flex justify-between text-[#8d8791] text-[0.9cqw]",
						ditgar ? "right-[4.5%] left-[38.5%]" : "right-[7%] left-[7%]",
					)}
				>
					<span>
						<Trans>Made with Reactive Resume</Trans>
					</span>
					<span>1</span>
				</footer>
			</div>
		</article>
	);
}
