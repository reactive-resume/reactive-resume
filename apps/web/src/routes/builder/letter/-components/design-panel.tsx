import type { DesignSource } from "@/features/resume/editor/design/style-groups";
import type { Template } from "@reactive-resume/schema/templates";
import type { IconName } from "@reactive-resume/ui/components/icon";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { produce } from "immer";
import { useEffect, useId, useMemo, useState } from "react";
import { templateLayouts, templateSchema } from "@reactive-resume/schema/templates";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { Crumb, CrumbButton } from "@/components/calm/crumb";
import { List, ListRow } from "@/components/calm/list-row";
import { Combobox } from "@/components/ui/combobox";
import { templates } from "@/dialogs/resume/template/data";
import { useLetterEditorStore } from "@/features/letters/store";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { PanelBody, PanelHeader } from "@/features/resume/editor/chrome/panel";
import { ACCENTS, matchDensity, matchMargins, rgbaToHex } from "@/features/resume/editor/design/presets";
import { ColorGroup, DesignSourceProvider, PageGroup, TypeGroup } from "@/features/resume/editor/design/style-groups";
import { useEditorStore } from "@/features/resume/editor/store";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

const failed = (error: unknown) =>
	toast.add({
		type: "error",
		description: getOrpcErrorMessage(error, { fallback: t`Couldn't change the design. Try again.` }),
	});

const updateDesign = (changes: { designLinked?: boolean; template?: Template }) =>
	useLetterEditorStore.getState().change((letter) =>
		client.coverLetters.update({
			id: letter.id,
			expectedRevision: letter.revision,
			sessionId: useLetterEditorStore.getState().sessionId,
			...changes,
		}),
	);

/** The letter's own type, colors and page, edited like the resume's and saved with what's typed. */
function useLetterDesignSource() {
	const metadata = useLetterEditorStore((state) => state.letter?.style.metadata);
	return useMemo<DesignSource>(
		() => ({
			metadata,
			write: (_key, mutate) => {
				const { letter, edit } = useLetterEditorStore.getState();
				if (!letter || letter.isLocked) return;
				const { typography, design, page } = produce(letter.style.metadata, mutate);
				edit({ metadata: { typography, design, page } });
			},
		}),
		[metadata],
	);
}

type DesignView = "design" | "template" | "typography" | "color" | "page" | "language";

/**
 * Design for letters (L2): one switch decides whether the letter matches its resume. The four things it takes from
 * the resume are rows that state their values; matched, they are locked, and off, each opens the same groups as the
 * resume's Design, set for this letter only (L6). Language never follows the resume.
 */
export function LetterDesignPanel() {
	const letter = useLetterEditorStore((state) => state.letter);
	const designSource = useLetterDesignSource();
	const [view, setView] = useState<DesignView>("design");
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	// Leaving Design never leaves a preview on the page.
	useEffect(() => () => useEditorStore.setState({ previewTemplate: null }), []);
	if (!letter) return null;

	const resume = resumes?.find((item) => item.id === letter.sourceResumeId);
	const disabled = letter.isLocked;
	const locked = letter.designLinked && Boolean(letter.sourceResumeId);
	const { metadata } = letter.style;
	const back = () => setView("design");

	const setLinked = (designLinked: boolean) =>
		void updateDesign({ designLinked })
			.then(() =>
				toast.add({
					description: designLinked
						? t`The letter matches the resume's design again`
						: t`The letter keeps this design as its own`,
				}),
			)
			.catch(failed);

	if (view !== "design") {
		const titles = {
			template: <Trans>Template</Trans>,
			typography: <Trans>Typography</Trans>,
			color: <Trans>Color</Trans>,
			page: <Trans>Page</Trans>,
			language: <Trans>Language</Trans>,
		} as const;
		return (
			<PanelBody className="pb-6">
				<PanelHeader
					crumb={
						<Crumb>
							<CrumbButton onClick={back}>
								<Trans>Design</Trans>
							</CrumbButton>
						</Crumb>
					}
					title={titles[view]}
				/>
				<div className="mt-4 flex flex-col gap-3">
					{view === "language" ? (
						<>
							<LetterLanguageField disabled={disabled} />
							<span className="text-xs/4 text-ink-3">
								<Trans>
									Writes the greeting, sign-off and date, and the language a new draft uses. Your own words stay as you
									wrote them.
								</Trans>
							</span>
						</>
					) : view === "template" ? (
						<TemplateGrid current={metadata.template} disabled={disabled} />
					) : (
						<DesignSourceProvider value={designSource}>
							{view === "typography" ? (
								<TypeGroup />
							) : view === "color" ? (
								<ColorGroup />
							) : (
								<PageGroup showLanguage={false} />
							)}
						</DesignSourceProvider>
					)}
				</div>
			</PanelBody>
		);
	}

	const accent = ACCENTS.find((option) => option.hex === rgbaToHex(metadata.design.colors.primary));
	const { heading, body } = metadata.typography;
	const margins = matchMargins(metadata);
	const density = matchDensity(metadata);
	const format = { a4: "A4", letter: t`US Letter`, "free-form": t`Free-form` }[metadata.page.format];
	const rows = [
		{
			view: "template" as const,
			icon: "layout" as const,
			title: <Trans>Template</Trans>,
			subtitle: `${templates[metadata.template].name} · ${templateLayouts[metadata.template].columns === 1 ? t`One column` : t`Two columns`}`,
		},
		{
			view: "typography" as const,
			icon: "text-aa" as const,
			title: <Trans>Typography</Trans>,
			subtitle: (
				<>
					<Trans>
						Headings in {heading.fontFamily}, {heading.fontSize} pt
					</Trans>
					<br />
					<Trans>
						Body in {body.fontFamily}, {body.fontSize} pt
					</Trans>
				</>
			),
		},
		{
			view: "color" as const,
			icon: "palette" as const,
			title: <Trans>Color</Trans>,
			subtitle: (
				<span className="inline-flex items-center gap-1.5">
					<span
						aria-hidden="true"
						className="size-2.5 rounded-[3px]"
						style={{ background: metadata.design.colors.primary }}
					/>
					{/* The resume's Design (B3) words it the same way. */}
					{`${accent ? t`${i18n._(accent.label)} accent` : (rgbaToHex(metadata.design.colors.primary) ?? "")} · ${
						["#000000", "#1D1D1F"].includes(rgbaToHex(metadata.design.colors.text) ?? "") &&
						rgbaToHex(metadata.design.colors.background) === "#FFFFFF"
							? t`near-black text on white`
							: t`${rgbaToHex(metadata.design.colors.text) ?? metadata.design.colors.text} text`
					}`}
				</span>
			),
		},
		{
			view: "page" as const,
			icon: "file" as const,
			title: <Trans>Page</Trans>,
			subtitle: [
				format,
				margins && { narrow: t`narrow margins`, normal: t`normal margins`, wide: t`wide margins` }[margins],
				density && { compact: t`compact density`, normal: t`normal density`, roomy: t`roomy density` }[density],
			]
				.filter(Boolean)
				.join(" · "),
		},
	];

	return (
		<PanelBody className="pb-6">
			<PanelHeader title={<Trans>Design</Trans>} />
			{letter.sourceResumeId ? (
				<div className="mt-5 flex items-start gap-3.5 pb-3.5">
					<RowIcon name="link-simple" className="mt-0.5" />
					<SwitchRow
						label={t`Match “${resume?.name ?? t`the resume`}”`}
						description={
							letter.designLinked
								? t`Template, type and colors follow the resume, so the pair always matches.`
								: t`The letter keeps a design of its own.`
						}
						checked={letter.designLinked}
						disabled={disabled}
						onCheckedChange={setLinked}
						className="min-h-0 items-start py-0 [&_[id$=-description]]:text-ink-3 [&>span:first-child>span:first-child]:text-[15px]/[22px]"
					/>
				</div>
			) : (
				<p className="mt-3 t-small text-ink-2">
					<Trans>Choose a resume in Write to match its design. Until then, the letter has its own.</Trans>
				</p>
			)}

			<List className="mt-0.5">
				{rows.map((row) => (
					<ListRow
						key={row.view}
						render={locked || disabled ? undefined : <button type="button" onClick={() => setView(row.view)} />}
						leading={<RowIcon name={row.icon} />}
						title={row.title}
						subtitle={row.subtitle}
						trailing={
							locked ? (
								<Icon name="lock-simple" size={18} className="text-ink-3" aria-label={t`Follows the resume`} />
							) : undefined
						}
						caret={!locked && !disabled}
						className="border-t-0"
					/>
				))}
			</List>

			{locked && letter.sourceResumeId && (
				<div className="flex flex-col items-start gap-3 border-t border-line pt-3 pb-6">
					<p className="text-xs/4 text-ink-3">
						<Trans>
							These four follow the resume. Turn matching off to set them for this letter only; it starts from the
							values above.
						</Trans>
					</p>
					<Link
						to="/builder/$resumeId"
						params={{ resumeId: letter.sourceResumeId }}
						search={{ mode: "design" }}
						className={buttonVariants({ variant: "secondary", size: "sm" })}
					>
						<Icon name="palette" />
						<Trans>Change the resume's design</Trans>
					</Link>
				</div>
			)}

			<List cap>
				<ListRow
					render={<button type="button" onClick={() => setView("language")} />}
					leading={<RowIcon name="translate" />}
					title={<Trans>Language</Trans>}
					subtitle={
						<>
							{languageName(metadata.page.locale, i18n.locale)}
							<br />
							<Trans>Sets the greeting, sign-off and date</Trans>
						</>
					}
					caret
				/>
			</List>
		</PanelBody>
	);
}

/** A row's 20px icon, centred in the 24px column the rows' text lines up after. */
function RowIcon({ name, className }: { name: IconName; className?: string }) {
	return (
		<span aria-hidden="true" className={cn("flex w-6 shrink-0 justify-center text-ink-2", className)}>
			<Icon name={name} size={20} />
		</span>
	);
}

/** "British English" for en-GB, in the interface's language. */
const languageName = (locale: string, uiLocale: string) => {
	try {
		return new Intl.DisplayNames([uiLocale], { type: "language" }).of(locale) ?? locale;
	} catch {
		return locale;
	}
};

/** The letter's own template: hovering one previews it on the page, a click applies it. */
function TemplateGrid({ current, disabled }: { current: Template; disabled: boolean }) {
	return (
		<fieldset
			disabled={disabled}
			className="m-0 grid min-w-0 grid-cols-2 gap-3 border-0 p-0"
			onMouseLeave={() => useEditorStore.setState({ previewTemplate: null })}
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					useEditorStore.setState({ previewTemplate: null });
			}}
		>
			<legend className="sr-only">
				<Trans>Template</Trans>
			</legend>
			{templateSchema.options.map((id) => {
				const selected = id === current;
				return (
					<button
						key={id}
						type="button"
						aria-pressed={selected}
						onMouseEnter={() => useEditorStore.setState({ previewTemplate: id === current ? null : id })}
						onFocus={() => useEditorStore.setState({ previewTemplate: id === current ? null : id })}
						onClick={() => {
							useEditorStore.setState({ previewTemplate: null });
							if (!selected) void updateDesign({ template: id }).catch(failed);
						}}
						className="group/template grid gap-1.5 text-start disabled:cursor-not-allowed disabled:opacity-60"
					>
						<span
							className={cn(
								"relative block aspect-[1/1.414] overflow-hidden rounded-paper border bg-paper transition-[translate,scale,box-shadow] duration-quick ease-enter group-hover/template:-translate-y-0.5 group-active/template:scale-[0.98]",
								selected
									? "border-accent shadow-[0_0_0_2px_var(--accent)]"
									: "border-line group-hover/template:shadow-e2",
							)}
						>
							<img src={templates[id].imageUrl} alt="" loading="lazy" className="size-full object-cover object-top" />
							{selected && (
								<span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-xs bg-accent text-on-accent">
									<Icon name="check" size={14} />
								</span>
							)}
						</span>
						<span className="text-sm leading-4 font-medium">{templates[id].name}</span>
					</button>
				);
			})}
		</fieldset>
	);
}

/** The letter's language, independent of whether its design follows the resume. Write and Design both offer it. */
type LetterLanguageFieldProps = { disabled: boolean; id?: string };

function LetterLanguageField({ disabled, id: givenId }: LetterLanguageFieldProps) {
	const ownId = useId();
	const id = givenId ?? ownId;
	const locale = useLetterEditorStore((state) => state.letter?.style.metadata.page.locale ?? "en-US");
	const edit = useLetterEditorStore((state) => state.edit);
	return (
		<Combobox
			id={id}
			options={getLocaleOptions()}
			value={locale}
			disabled={disabled}
			onValueChange={(value: string | null) => {
				if (value && value !== locale) edit({ locale: value });
			}}
		/>
	);
}
