import type { Template } from "@reactive-resume/schema/templates";
import type { ReactNode } from "react";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { Badge } from "@reactive-resume/ui/components/badge";
import { Button } from "@reactive-resume/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@reactive-resume/ui/components/dialog";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@reactive-resume/ui/components/tooltip";
import { cn } from "@reactive-resume/utils/style";
import { Chip } from "@/components/calm/filter-bar";
import { templates } from "@/dialogs/resume/template/data";

type Filter = "all" | "one" | "two" | "ats";

const all = templateSchema.options;

const shows = (id: Template, filter: Filter) => {
	const layout = templateLayouts[id];
	if (filter === "one") return layout.columns === 1;
	if (filter === "two") return layout.columns === 2;
	if (filter === "ats") return layout.atsSafe;
	return true;
};

const isTemplate = (value: string): value is Template => (all as readonly string[]).includes(value);

/** Columns and ATS-safe come from the layout data, never from a template's description. */
const columns = (id: Template) => (templateLayouts[id].columns === 1 ? t`One column` : t`Two columns`);
const facts = (id: Template) => (templateLayouts[id].atsSafe ? `${columns(id)} · ${t`ATS-safe`}` : columns(id));

const pdfUrl = (id: Template) => `/templates/pdf/${id}.pdf`;

/**
 * The public template gallery: every template in the first screen, filtered by the two facts that matter, and the
 * chosen one at reading size beside the grid, with the page's one accent button.
 */
export function TemplateGallery() {
	const { i18n } = useLingui();
	const [filter, setFilter] = useState<Filter>("all");
	// Old links name a template in the hash (/resume-templates#bronzor): open on it. The build-time HTML has no window.
	const [selected, setSelected] = useState<Template>(() => {
		const id = typeof window === "undefined" ? "" : window.location.hash.slice(1);
		return isTemplate(id) ? id : "onyx";
	});
	const [fullSize, setFullSize] = useState(false);

	const filters: { id: Filter; label: string }[] = [
		{ id: "all", label: t`All` },
		{ id: "one", label: t`One column` },
		{ id: "two", label: t`Two columns` },
		{ id: "ats", label: t`ATS-safe` },
	];
	const shown = all.filter((id) => shows(id, filter));
	const name = templates[selected].name;

	const pick = (id: Template) => {
		setSelected(id);
		// Under 1024 there is no room for the preview beside the grid: it opens over it.
		if (!window.matchMedia("(min-width: 1024px)").matches) setFullSize(true);
	};

	const actions = (
		<>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon"
							nativeButton={false}
							aria-label={t`Download ${name} sample PDF`}
							render={
								// oxlint-disable-next-line jsx-a11y/anchor-has-content -- the button's aria-label names it
								<a href={pdfUrl(selected)} download={`${name}-resume-example.pdf`} />
							}
						/>
					}
				>
					<Icon name="download-simple" />
				</TooltipTrigger>
				<TooltipContent>{t`Download sample PDF`}</TooltipContent>
			</Tooltip>
			<UseTemplate id={selected} />
		</>
	);

	return (
		<div className="flex flex-1 items-start">
			<main id="main-content" data-design="main" className="min-h-[calc(100svh-4rem)] min-w-0 flex-1">
				<div data-design="page" className="px-4 pt-[26px] pb-16 sm:px-8 lg:px-10">
					<header data-design="rh" className="flex min-h-11 items-center">
						<h1 className="t-root-title">{t`${i18n.number(all.length)} free resume templates`}</h1>
					</header>
					<p className="pt-0.5 text-sm text-ink-3">
						{t`Free to customize, with PDF and Word downloads and no watermark. Switch templates anytime without rewriting your content.`}
					</p>

					<div className="flex flex-wrap items-center gap-2 pt-[18px] pb-1">
						<div role="group" aria-label={t`Show templates`} className="flex flex-wrap items-center gap-1.5">
							{filters.map(({ id, label }) => (
								<Chip key={id} pressed={filter === id} onClick={() => setFilter(id)}>
									{label}
									<span className={cn("t-mono", filter !== id && "text-ink-3")}>
										{i18n.number(all.filter((template) => shows(template, id)).length)}
									</span>
								</Chip>
							))}
						</div>
						<a
							href="https://docs.rxresu.me/guides/choosing-a-template"
							target="_blank"
							rel="noreferrer"
							className="ms-auto inline-flex items-center gap-1.5 rounded-xs text-sm font-medium text-accent-text"
						>
							{t`How to choose a template`}
							<Icon name="arrow-square-out" size={16} />
						</a>
					</div>
					<p className="pt-1.5 pb-[18px] t-small text-ink-3">
						{t`One column reads top to bottom, which hiring software follows most reliably. Two columns keep supporting details in a sidebar.`}
					</p>

					<ul className="grid grid-cols-2 gap-x-6 gap-y-[26px] sm:grid-cols-3 xl:grid-cols-4 min-[90rem]:grid-cols-5">
						{shown.map((id, index) => {
							const on = id === selected;
							return (
								<li key={id} className="min-w-0">
									<button
										type="button"
										aria-pressed={on}
										onClick={() => pick(id)}
										className="group flex w-full flex-col gap-2 rounded-xs text-start"
									>
										<img
											src={`/templates/thumb/${id}.webp`}
											srcSet={`/templates/thumb/${id}-small.webp 300w, /templates/thumb/${id}.webp 596w`}
											sizes="(min-width: 90rem) 150px, (min-width: 640px) 200px, 45vw"
											alt={t`${templates[id].name} resume template preview`}
											width={298}
											height={420}
											// The first rows are on the first screen, and the first preview is its largest paint.
											loading={index < 10 ? "eager" : "lazy"}
											fetchPriority={index === 0 ? "high" : "auto"}
											decoding="async"
											className={cn(
												"aspect-[210/297] w-full rounded-paper bg-paper object-cover object-top transition-shadow duration-quick",
												on
													? "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--accent)]"
													: "shadow-[var(--shadow-1),0_0_0_1px_var(--line)] group-hover:shadow-[var(--shadow-1),0_0_0_1px_var(--line-2)]",
											)}
										/>
										<span className="text-sm font-medium">{templates[id].name}</span>
										<span className="-mt-[7px] text-xs/4 text-ink-3">{facts(id)}</span>
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			</main>

			<aside
				aria-label={t`Selected template`}
				className="sticky top-16 flex h-[calc(100svh-4rem)] w-[400px] shrink-0 flex-col overflow-y-auto border-s border-line bg-sunken px-8 pt-7 pb-8 max-lg:hidden xl:w-[520px] dark:bg-raised"
			>
				<div className="flex items-center gap-3">
					<h2 className="min-w-0 flex-1 t-page-title">{name}</h2>
					<UseTemplate id={selected} />
				</div>
				<div className="flex items-center gap-2 pt-0.5">
					<p className="min-w-0 flex-1 text-sm text-ink-3">{facts(selected)}</p>
					<a
						href={pdfUrl(selected)}
						download={`${name}-resume-example.pdf`}
						aria-label={t`Download ${name} sample PDF`}
						className="inline-flex items-center gap-1.5 rounded-xs text-[13px]/5 font-medium text-accent-text"
					>
						<Icon name="download-simple" size={16} />
						{t`Sample PDF`}
					</a>
				</div>
				<p className="mt-2.5 t-small text-ink-2">{i18n._(templates[selected].description)}</p>
				<ul className="mt-3 flex flex-wrap gap-1.5">
					{templates[selected].tags
						.filter((tag) => !/column/i.test(tag))
						.map((tag) => (
							<Badge key={tag} variant="outline" render={<li />}>
								{tag}
							</Badge>
						))}
				</ul>
				<div className="relative mt-[18px] w-full max-w-[456px] shrink-0 self-center">
					<div data-design="paper" className="rounded-paper bg-paper">
						<Preview id={selected} />
					</div>
					<Button variant="secondary" size="sm" className="absolute end-2.5 top-2.5" onClick={() => setFullSize(true)}>
						<Icon name="arrows-out-simple" />
						{t`View full size`}
					</Button>
				</div>
			</aside>

			<Dialog open={fullSize} onOpenChange={setFullSize}>
				<DialogContent
					showCloseButton={false}
					className="flex h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden bg-sunken p-0 sm:max-w-[920px] dark:bg-raised"
				>
					<div className="flex shrink-0 items-center gap-1 border-b border-line bg-bg py-2.5 ps-4 pe-3">
						<div className="flex min-w-0 flex-1 flex-col">
							<DialogTitle className="truncate t-label font-ui">{name}</DialogTitle>
							<DialogDescription className="truncate t-small text-ink-3">
								{t`${columns(selected)} · ${i18n.number(Math.max(shown.indexOf(selected), 0) + 1)} of ${i18n.number(shown.length)}`}
							</DialogDescription>
						</div>
						<Step
							label={t`Previous template`}
							icon="caret-left"
							onClick={() => setSelected(step(shown, selected, -1))}
						/>
						<Step label={t`Next template`} icon="caret-right" onClick={() => setSelected(step(shown, selected, 1))} />
						{actions}
						<Tooltip>
							<TooltipTrigger
								render={<DialogClose render={<Button variant="ghost" size="icon" aria-label={t`Close`} />} />}
							>
								<Icon name="x" />
							</TooltipTrigger>
							<TooltipContent>{t`Close`}</TooltipContent>
						</Tooltip>
					</div>
					<div className="flex min-h-0 flex-1 justify-center overflow-y-auto p-5">
						{/* The page itself opens the sample PDF in a new tab. */}
						<a
							href={pdfUrl(selected)}
							target="_blank"
							rel="noreferrer"
							aria-label={t`Preview ${name} sample PDF`}
							className="block h-fit w-full max-w-[760px] rounded-paper"
						>
							<Preview id={selected} />
						</a>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}

/** The neighbour in the filtered list, wrapping at the ends; from a template the filter hides, the first one. */
const step = (shown: readonly Template[], current: Template, by: number): Template =>
	shown[(shown.indexOf(current) + by + shown.length) % shown.length] ?? current;

function Step({ label, icon, onClick }: { label: string; icon: "caret-left" | "caret-right"; onClick: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} onClick={onClick} />}>
				<Icon name={icon} className="rtl:-scale-x-100" />
			</TooltipTrigger>
			<TooltipContent>{label}</TooltipContent>
		</Tooltip>
	);
}

/** The template's real sample page. Paper never inverts; it dims a little in the dark. */
function Preview({ id }: { id: Template }): ReactNode {
	return (
		<img
			key={id}
			src={templates[id].imageUrl}
			alt={t`${templates[id].name} resume template preview`}
			width={600}
			height={848}
			decoding="async"
			className="block h-auto w-full rounded-paper bg-paper shadow-page"
		/>
	);
}

/** The page's one accent button. Signed out, sign-up comes first and the choice is carried to Documents. */
function UseTemplate({ id }: { id: Template }) {
	return (
		<Button
			nativeButton={false}
			render={<Link to="/auth/register" search={{ callbackURL: `/dashboard/documents?new=resume&template=${id}` }} />}
		>
			{t`Use this template`}
		</Button>
	);
}
