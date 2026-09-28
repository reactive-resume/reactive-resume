import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import {
	ArrowRightIcon,
	ArrowUpRightIcon,
	CheckIcon,
	CodeIcon,
	GlobeIcon,
	KanbanIcon,
	LockSimpleIcon,
	PauseIcon,
	PencilSimpleIcon,
	PlayIcon,
} from "@phosphor-icons/react";
import { useInView, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { cn } from "@reactive-resume/utils/style";
import { textLink } from "./classes";

const demoClass =
	"min-h-[492px] animate-[home-feature-enter_220ms_var(--ease-out-strong)_both] px-[30px] py-6 group-data-[instant=true]/explorer:animate-none max-[1100px]:p-[23px] max-[900px]:p-[27px] max-[540px]:px-4 max-[540px]:py-5";
const demoTopClass = "flex items-center justify-between gap-5 text-[12px] text-(--home-muted)";
const demoCaptionClass = "mt-[25px] text-[12px] leading-[1.7] text-(--home-muted) max-[540px]:text-[11px]";
const pressTransition =
	"[transition:transform_140ms_var(--ease-out-strong),background-color_180ms_ease,color_180ms_ease] active:transform-[scale(0.97)]";
const jobCardClass =
	"min-h-[191px] rounded-[4px] border px-3 py-[14px] max-[540px]:min-h-[183px] max-[540px]:px-2 max-[540px]:py-[13px]";
const toolBoxClass =
	"flex h-[122px] w-[132px] shrink-0 flex-col items-center justify-center gap-[15px] rounded-[4px] border border-[#4d4d50] bg-[#242426] shadow-[0_5px_0_#111112,0_6px_0_#3b3b3f] max-[540px]:h-[105px] max-[540px]:w-[110px]";
const toolLabelClass = "text-[11px] max-[540px]:text-[10px]";
const stageDotColors = ["bg-[#8898b7]", "bg-[#d9b67b]", "bg-[#9cbd9e]"];

export function FeatureExplorer() {
	const [feature, setFeature] = useState("writing");
	const [accepted, setAccepted] = useState(false);
	const [sharing, setSharing] = useState("public");
	const [stage, setStage] = useState(0);
	const [instant, setInstant] = useState(false);
	const [flowPlaying, setFlowPlaying] = useState(true);
	const ref = useRef<HTMLDivElement>(null);
	const visible = useInView(ref);
	const reducedMotion = useReducedMotion();
	const revisedText = t`Designed a shared component library that six product teams use to build consistent interfaces.`;
	const sharingOptions = [
		{ id: "public", label: t`Public` },
		{ id: "password", label: t`Password` },
		{ id: "private", label: t`Private` },
	];
	const features = [
		{ id: "writing", label: t`A hand with the writing`, hint: t`AI, when you want it`, icon: PencilSimpleIcon },
		{ id: "sharing", label: t`A link worth sharing`, hint: t`Choose who can see it`, icon: GlobeIcon },
		{ id: "tracking", label: t`Know where things stand`, hint: t`Your applications, together`, icon: KanbanIcon },
		{ id: "tools", label: t`Fits into your workflow`, hint: t`API and MCP access`, icon: CodeIcon },
	];
	const stages = [t`Applied`, t`Interview`, t`Offer`];
	return (
		<div
			ref={ref}
			className="group/explorer grid grid-cols-[320px_minmax(0,1fr)] gap-[55px] max-[1100px]:grid-cols-[280px_minmax(0,1fr)] max-[900px]:grid-cols-1 max-[1100px]:gap-[26px] max-[900px]:gap-6"
			data-instant={instant || reducedMotion}
			onClickCapture={(event) => setInstant(event.detail === 0)}
		>
			<fieldset
				className="flex flex-col gap-2 max-[900px]:grid max-[900px]:grid-cols-2 max-[540px]:gap-[6px]"
				aria-label={t`Explore features`}
			>
				{features.map(({ id, label, hint, icon: Icon }) => (
					<button
						key={id}
						type="button"
						className="group/item flex w-full items-center gap-[15px] rounded-[4px] border border-transparent bg-transparent px-4 py-[21px] text-left text-(--home-muted) [transition:background-color_150ms_ease,color_150ms_ease] hover:bg-[#1b1b1d] aria-pressed:border-(--home-line) aria-pressed:bg-[#1e1e20] aria-pressed:text-(--home-ink) aria-pressed:hover:bg-[#1b1b1d] max-[540px]:gap-[9px] max-[900px]:p-4 max-[540px]:px-2.5 max-[540px]:py-[13px]"
						aria-pressed={feature === id}
						onClick={() => setFeature(id)}
					>
						<Icon size={23} aria-hidden="true" className="max-[540px]:w-[19px]" />
						<span className="flex-1">
							<strong className="block font-medium text-[16px] max-[540px]:text-[12px] max-[900px]:text-[14px]">
								{label}
							</strong>
							<small className="mt-1 block text-(--home-muted) text-[13px] max-[540px]:text-[10px] max-[900px]:text-[12px]">
								{hint}
							</small>
						</span>
						<ArrowRightIcon
							size={17}
							aria-hidden="true"
							className="opacity-0 group-aria-pressed/item:opacity-100 max-[540px]:hidden"
						/>
					</button>
				))}
			</fieldset>
			<div className="min-h-[492px] overflow-hidden rounded-[4px] border border-(--home-line) bg-[#19191b]">
				{feature === "writing" && (
					<div className={demoClass}>
						<div className={demoTopClass}>
							<span>
								<Trans>Example edit</Trans>
							</span>
							<span>Alex Morgan</span>
						</div>
						<div className="transform-[perspective(1000px)_rotateX(3deg)_rotateY(-3deg)] mx-auto mt-[25px] min-h-[224px] max-w-[430px] rounded-[2px] border border-[#d9d6d0] bg-[#efeee9] px-[30px] pt-7 pb-[38px] text-[#343239] shadow-[0_10px_18px_#0002] max-[540px]:px-6 max-[540px]:pt-[23px] max-[540px]:pb-8">
							<span className="text-[#735c9a] text-[11px]">
								<Trans>Experience</Trans>
							</span>
							<h3 className="mt-[9px] font-[Manrope_Variable,sans-serif] font-semibold text-[18px] leading-[1.3] tracking-[-0.03em]">
								<Trans>Product designer</Trans>
							</h3>
							<p
								className={cn(
									"-mx-[5px] mt-3 rounded-[2px] px-[5px] py-1 text-[12px] leading-[1.8]",
									accepted && "bg-[#d6e5d6]",
								)}
							>
								{accepted ? (
									<>
										<span className="sr-only" role="status">
											{revisedText}
										</span>
										<span aria-hidden="true">
											{revisedText.split(" ").map((word, index) => (
												<span
													key={`${index}-${word}`}
													className="animate-[home-word-arrive_180ms_ease-out_both] group-data-[instant=true]/explorer:animate-none"
													style={{ animationDelay: `${index * 45}ms` }}
												>
													{word}{" "}
												</span>
											))}
										</span>
									</>
								) : (
									t`Responsible for working on the design system and helping other teams with their designs.`
								)}
							</p>
							<div className="mt-[15px] h-[3px] w-[95%] bg-[#dad8d4]" />
							<div className="mt-[7px] h-[3px] w-[66%] bg-[#dad8d4]" />
						</div>
						<div className="relative -mt-4 flex items-start gap-3 rounded-[4px] border border-[#514b59] bg-[#2c2732] px-[17px] py-[19px] shadow-[0_10px_20px_#0003] max-[1100px]:flex-wrap max-[540px]:flex-wrap max-[900px]:flex-nowrap max-[540px]:gap-[9px] max-[540px]:px-3 max-[540px]:py-4">
							<PencilSimpleIcon size={20} aria-hidden="true" className="mt-[2px] shrink-0 text-[#c9b7dc]" />
							<div className="max-[540px]:flex-[1_0_calc(100%_-_30px)]">
								<strong className="block font-medium text-[13px]">
									{accepted ? t`Your edit is in.` : t`Say what you actually did.`}
								</strong>
								<p className="mt-[5px] max-w-[250px] text-[#b8b0c0] text-[12px]">
									{accepted
										? t`You can always go back to the original.`
										: t`Lead with the work. Add a concrete detail so someone can picture it.`}
								</p>
							</div>
							<button
								type="button"
								className={`ml-auto flex min-h-11 shrink-0 items-center gap-[9px] rounded-[4px] border border-[#655971] bg-[#3e3449] px-2.5 py-2 text-[#efebf2] text-[12px] ${pressTransition} max-[1100px]:ml-[31px] max-[540px]:ml-[29px] max-[900px]:ml-auto`}
								onClick={() => setAccepted(!accepted)}
							>
								{accepted ? t`Undo` : t`Use this wording`}
								{accepted ? (
									<CheckIcon size={16} aria-hidden="true" />
								) : (
									<ArrowRightIcon size={16} aria-hidden="true" />
								)}
							</button>
						</div>
						<p className={demoCaptionClass}>
							<Trans>
								This is a sample edit. In the app, connect your own AI provider. Turn on Review edits to approve changes
								before they’re applied.
							</Trans>
						</p>
					</div>
				)}
				{feature === "sharing" && (
					<div className={demoClass}>
						<div className={demoTopClass}>
							<span>
								<Trans>Sharing preview</Trans>
							</span>
							<GlobeIcon size={18} aria-hidden="true" />
						</div>
						<div className="mt-[25px] mb-5 flex justify-center gap-[3px]">
							{sharingOptions.map(({ id, label }) => (
								<button
									type="button"
									key={id}
									className={`min-h-11 rounded-[4px] border border-transparent bg-transparent px-[18px] py-2 text-(--home-muted) text-[13px] ${pressTransition} aria-pressed:border-[#47474a] aria-pressed:bg-[#323235] aria-pressed:text-(--home-ink) group-data-[instant=true]/explorer:transition-none`}
									aria-pressed={sharing === id}
									onClick={() => setSharing(id)}
								>
									{label}
								</button>
							))}
						</div>
						<div className="m-auto max-w-[430px] overflow-hidden rounded-[4px] border border-[#404043] shadow-[0_12px_30px_#0002]">
							<div className="flex items-center justify-center gap-2 bg-[#252527] p-2.5 text-[#939399] text-[10px]">
								<LockSimpleIcon size={13} aria-hidden="true" />
								<Trans>Your resume link</Trans>
							</div>
							<div className="grid bg-[#202022]">
								{sharingOptions.map(({ id }) => (
									<div
										key={id}
										className="invisible col-start-1 row-start-1 flex min-h-[215px] flex-col items-center justify-center p-6 text-center opacity-0 [transition:opacity_180ms_ease,visibility_180ms] data-[active=true]:visible data-[active=true]:opacity-100 group-data-[instant=true]/explorer:transition-none"
										data-active={sharing === id}
										aria-hidden={sharing !== id}
									>
										{id === "public" ? (
											<>
												<div className="grid size-11 place-items-center rounded-full bg-[#45382e] text-[#decfbf] text-[12px]">
													AM
												</div>
												<h3 className="mt-3 font-medium text-[19px] tracking-[-0.03em]">Alex Morgan</h3>
												<p className="mt-1.5 text-(--home-muted) text-[12px]">
													<Trans>Product designer</Trans>
												</p>
												<div className="mt-[15px] grid w-[110px] gap-[5px]">
													<i className="h-[2px] bg-[#444447]" />
													<i className="h-[2px] bg-[#444447]" />
													<i className="h-[2px] w-[70%] bg-[#444447]" />
												</div>
											</>
										) : (
											<>
												<LockSimpleIcon size={34} weight="light" aria-hidden="true" />
												<h3 className="mt-3 font-medium text-[19px] tracking-[-0.03em]">
													{id === "password" ? t`Password required` : t`Resume not found`}
												</h3>
												<p className="mt-1.5 text-(--home-muted) text-[12px]">
													{id === "password"
														? t`Visitors need your password to open the resume.`
														: t`A private resume does not appear at its public link.`}
												</p>
											</>
										)}
									</div>
								))}
							</div>
						</div>
						<p className={demoCaptionClass}>
							<Trans>
								Try the settings to see what visitors can access. When you create your resume, you decide how to share
								it.
							</Trans>
						</p>
					</div>
				)}
				{feature === "tracking" && (
					<div className={demoClass}>
						<div className={demoTopClass}>
							<span>
								<Trans>Example application</Trans>
							</span>
							<button
								type="button"
								className="-my-1.5 min-h-8 px-2 py-1 text-(--home-muted)"
								onClick={() => setStage(0)}
							>
								<Trans>Reset</Trans>
							</button>
						</div>
						<div className="mt-[34px] [--home-board-gap:12px] max-[540px]:[--home-board-gap:7px]">
							<div className="grid grid-cols-3 gap-(--home-board-gap)">
								{stages.map((label, index) => (
									<div
										key={label}
										className="flex items-center gap-1.5 text-(--home-muted) text-[11px] max-[540px]:gap-1 max-[540px]:text-[9px]"
									>
										<i className={cn("size-1.5 rounded-full", stageDotColors[index])} />
										{label}
										<span className="ml-auto text-[#85858c]">{stage === index ? 1 : 0}</span>
									</div>
								))}
							</div>
							<div
								className="relative mt-[15px] grid grid-cols-3 gap-(--home-board-gap)"
								style={{ "--stage": stage } as CSSProperties}
							>
								{stages.map((label) => (
									<div
										key={label}
										className={`${jobCardClass} border-[#323237] border-dashed text-transparent`}
										aria-hidden="true"
									/>
								))}
								<div
									className={`${jobCardClass} transform-[translateX(calc(var(--stage)_*_(100%_+_var(--home-board-gap))))_rotate(calc(var(--stage)_*_3deg_-_2deg))] absolute top-0 left-0 w-[calc((100%_-_2_*_var(--home-board-gap))_/_3)] border-[#4b4b51] bg-[#2a2a2e] text-(--home-ink) shadow-[0_5px_12px_#0002] [transition:transform_460ms_var(--ease-out-strong)] group-data-[instant=true]/explorer:transition-none`}
								>
									<div className="mb-4 grid size-[30px] place-items-center rounded-[4px] bg-[#d8c4ac] font-[Georgia,serif] font-semibold text-[#34302a] text-[19px] leading-none">
										n.
									</div>
									<strong className="block font-medium text-[12px] max-[540px]:text-[10px]">
										<Trans>Product designer</Trans>
									</strong>
									<p className="mt-[5px] text-(--home-muted) text-[10px] max-[540px]:text-[9px]">Northstar Studio</p>
									<span className="mt-[18px] block text-[#bab4c7] text-[9px] max-[540px]:text-[8px]">
										<Trans>Resume attached</Trans>
									</span>
								</div>
							</div>
						</div>
						<div className="mt-7 flex items-center justify-between text-(--home-muted) text-[12px]">
							<span role="status">{stages[stage]}</span>
							<button
								type="button"
								className={`inline-flex min-h-11 items-center gap-2.5 rounded-[4px] border border-[#4b4b51] bg-[#2b2b2e] px-[13px] py-2 text-(--home-ink) text-[12px] ${pressTransition}`}
								onClick={() => setStage((stage + 1) % stages.length)}
							>
								{stage === 0 ? t`Move to interview` : stage === 1 ? t`Move to offer` : t`Start again`}
								<ArrowRightIcon size={17} aria-hidden="true" />
							</button>
						</div>
						<p className={demoCaptionClass}>
							<Trans>
								Keep the company, role, resume, and follow-up date together. Switch between a board, table, and insights
								in the app.
							</Trans>
						</p>
					</div>
				)}
				{feature === "tools" && (
					<div className={demoClass}>
						<div className={demoTopClass}>
							<span>
								<Trans>Your tools, connected</Trans>
							</span>
							{!reducedMotion && (
								<button
									type="button"
									className={`-my-3 grid min-h-11 min-w-11 place-items-center rounded-[4px] px-2 py-1 text-(--home-muted) ${pressTransition} hover:bg-[#323235]`}
									aria-label={flowPlaying ? t`Pause data flow animation` : t`Play data flow animation`}
									onClick={() => setFlowPlaying(!flowPlaying)}
								>
									{flowPlaying ? <PauseIcon size={16} aria-hidden="true" /> : <PlayIcon size={16} aria-hidden="true" />}
								</button>
							)}
						</div>
						<div className="mx-auto mt-[55px] mb-[38px] flex max-w-[410px] items-center">
							<div className={toolBoxClass}>
								<CodeIcon size={32} weight="light" aria-hidden="true" />
								<span className={toolLabelClass}>
									<Trans>Your AI app</Trans>
								</span>
							</div>
							<div className="group/wire relative h-px flex-1 bg-[#66666d]" data-playing={flowPlaying && visible}>
								<span className={`absolute -top-[25px] w-full text-center text-(--home-muted) ${toolLabelClass}`}>
									MCP
								</span>
								<i
									className="absolute inset-x-0 -top-[3px] h-[7px] animate-[home-data-flow_3.5s_cubic-bezier(0.45,0,0.55,1)_infinite_alternate_paused] after:-ml-[3px] after:block after:size-[7px] after:rounded-full after:bg-[#ddc8eb] after:shadow-[0_0_0_4px_#c5a4db14,0_0_11px_#c5a4db50] after:content-[''] group-data-[playing=true]/wire:[animation-play-state:running]"
									aria-hidden="true"
								/>
							</div>
							<div className={toolBoxClass}>
								<img src="/icon/dark.svg" width="38" height="38" alt="" />
								<span className={toolLabelClass}>Reactive Resume</span>
							</div>
						</div>
						<h3 className="font-[Manrope_Variable,sans-serif] font-medium text-[23px] leading-[1.3] tracking-[-0.035em] max-[540px]:text-[22px]">
							<Trans>Work on your resume from your AI app.</Trans>
						</h3>
						<p className="mt-[15px] text-(--home-muted) text-[14px] leading-[1.7]">
							<Trans>
								Connect through MCP to create and update resumes in a conversation. Or use the API to build your own
								workflow.
							</Trans>
						</p>
						<a href="https://docs.rxresu.me/guides/using-the-mcp-server" className={cn(textLink, "mt-4")}>
							<Trans>See how to connect</Trans>
							<ArrowUpRightIcon size={17} aria-hidden="true" />
						</a>
					</div>
				)}
			</div>
		</div>
	);
}
