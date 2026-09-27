import type { Template } from "@reactive-resume/schema/templates";
import type { CSSProperties } from "react";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ArrowLeftIcon, ArrowRightIcon, ArrowUpRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { templateSchema } from "@reactive-resume/schema/templates";
import { textLink } from "./classes";

type TemplateShelfProps = { template: Template; onChange: (template: Template) => void };
const templates = templateSchema.options;
const displayName = (name: string) => name[0].toUpperCase() + name.slice(1);
const roundLinkClass =
	"inline-flex size-[46px] shrink-0 items-center justify-center rounded-full border border-[#444447] bg-transparent text-(--home-ink) [transition:background-color_150ms_ease,transform_150ms_var(--ease-out-strong)] hover:bg-[#2c2c2f] active:transform-[scale(0.97)] max-[540px]:size-11";

export function TemplateShelf({ template, onChange }: TemplateShelfProps) {
	const index = templates.indexOf(template);
	const [instant, setInstant] = useState(false);
	const select = (next: Template, keyboard: boolean) => {
		setInstant(keyboard);
		onChange(next);
	};
	return (
		<div
			className="group/shelf [--home-paper-step:230px] [--home-paper-width:284px] max-[1100px]:[--home-paper-step:190px] max-[540px]:[--home-paper-step:140px] max-[540px]:[--home-paper-width:218px] max-[900px]:[--home-paper-step:178px] max-[900px]:[--home-paper-width:250px]"
			data-instant={instant}
		>
			<fieldset
				className="perspective-[1200px] relative isolate h-[465px] max-[540px]:h-[360px] max-[900px]:h-[420px]"
				aria-label={t`Resume templates`}
			>
				{templates.map((item, itemIndex) => {
					const offset = ((itemIndex - index + templates.length + 7) % templates.length) - 7;
					return (
						<button
							key={item}
							type="button"
							className="transform-[translateX(calc(var(--position)_*_var(--home-paper-step)))_translateY(calc(var(--distance)_*_15px))_translateZ(calc(var(--distance)_*_-80px))_rotateY(calc(var(--position)_*_-12deg))_rotateZ(calc(var(--position)_*_2deg))] absolute top-5 left-[calc(50%_-_var(--home-paper-width)_/_2)] z-[calc(10_-_var(--distance))] aspect-[510/720] w-(--home-paper-width) rounded-[2px] border border-[#dedbd3] bg-[#eee] shadow-[0_25px_28px_#0004,0_2px_1px_#0006] brightness-[calc(1_-_var(--distance)_*_0.18)] [transition:transform_550ms_var(--ease-out-strong),filter_350ms_ease,opacity_220ms_ease,visibility_220ms] not-aria-pressed:hover:brightness-95 aria-hidden:invisible aria-hidden:opacity-0 group-data-[instant=true]/shelf:transition-none"
							aria-label={t`Choose ${displayName(item)}`}
							aria-pressed={item === template}
							aria-hidden={Math.abs(offset) > 2}
							tabIndex={Math.abs(offset) > 2 ? -1 : 0}
							disabled={Math.abs(offset) > 2}
							style={{ "--position": offset, "--distance": Math.abs(offset) } as CSSProperties}
							onClick={(event) => select(item, event.detail === 0)}
						>
							<img
								src={`/templates/jpg/${item}.jpg`}
								alt=""
								width="510"
								height="720"
								loading="lazy"
								draggable={false}
								className="pointer-events-none block size-full"
							/>
						</button>
					);
				})}
			</fieldset>
			<div className="flex items-center justify-center gap-[29px]">
				<button
					type="button"
					className={roundLinkClass}
					aria-label={t`Previous template`}
					onClick={(event) => select(templates[(index - 1 + templates.length) % templates.length], event.detail === 0)}
				>
					<ArrowLeftIcon size={21} aria-hidden="true" />
				</button>
				<div className="grid w-[110px] justify-items-center gap-[2px]" aria-live="polite">
					<strong className="font-medium text-[20px]">{displayName(template)}</strong>
					<span className="text-(--home-muted) text-[12px] tabular-nums">
						{index + 1} / {templates.length}
					</span>
				</div>
				<button
					type="button"
					className={roundLinkClass}
					aria-label={t`Next template`}
					onClick={(event) => select(templates[(index + 1) % templates.length], event.detail === 0)}
				>
					<ArrowRightIcon size={21} aria-hidden="true" />
				</button>
			</div>
			<fieldset
				className="mx-auto mt-[35px] flex max-w-[860px] flex-wrap justify-center gap-x-[7px] gap-y-[2px] max-[540px]:mt-[26px] max-[540px]:gap-0"
				aria-label={t`Choose a template`}
			>
				{templates.map((item) => (
					<button
						type="button"
						key={item}
						className="min-h-11 rounded-[4px] bg-transparent px-3 py-[7px] text-(--home-muted) text-[13px] [transition:color_150ms_ease,background-color_150ms_ease] hover:text-(--home-ink) aria-pressed:bg-[#313133] aria-pressed:text-(--home-ink) max-[540px]:px-2.5 max-[540px]:text-[12px]"
						aria-pressed={item === template}
						onClick={(event) => select(item, event.detail === 0)}
					>
						{displayName(item)}
					</button>
				))}
			</fieldset>
			<div className="mt-[30px] flex items-center justify-end gap-5 border-(--home-line) border-t pt-[35px] max-[540px]:pt-[25px]">
				<a href={`/templates/pdf/${template}.pdf`} target="_blank" rel="noopener noreferrer" className={textLink}>
					<Trans>Open template PDF</Trans>
					<ArrowUpRightIcon size={16} aria-hidden="true" />
					<span className="sr-only">
						<Trans>Opens in a new tab</Trans>
					</span>
				</a>
			</div>
		</div>
	);
}
