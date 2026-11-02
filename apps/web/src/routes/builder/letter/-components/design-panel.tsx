import type { DesignSource } from "@/features/resume/editor/design/style-groups";
import type { Template } from "@reactive-resume/schema/templates";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { produce } from "immer";
import { useEffect, useId, useMemo } from "react";
import { templateSchema } from "@reactive-resume/schema/templates";
import { buttonVariants } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { SwitchRow } from "@reactive-resume/ui/components/switch";
import { toast } from "@reactive-resume/ui/components/toast";
import { cn } from "@reactive-resume/utils/style";
import { Combobox } from "@/components/ui/combobox";
import { templates } from "@/dialogs/resume/template/data";
import { useLetterEditorStore } from "@/features/letters/store";
import { getLocaleOptions } from "@/features/locale/locale-options";
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

/**
 * Design for letters: by default a letter matches its resume's design, changed on the resume. Turned off, the
 * letter keeps a design of its own: its template (hovering one previews it on the page, a click applies it), then
 * its type, color and page.
 */
export function LetterDesignPanel() {
	const letter = useLetterEditorStore((state) => state.letter);
	const designSource = useLetterDesignSource();
	const { data: resumes } = useQuery(orpc.resume.list.queryOptions({ input: {} }));
	// Leaving Design never leaves a preview on the page.
	useEffect(() => () => useEditorStore.setState({ previewTemplate: null }), []);
	if (!letter) return null;

	const resume = resumes?.find((item) => item.id === letter.sourceResumeId);
	const current = letter.style.metadata.template;
	const disabled = letter.isLocked;

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

	return (
		<div className="divide-y divide-line">
			<section aria-labelledby="letter-design-match" className="grid gap-3 px-4 py-5">
				<h2 id="letter-design-match" className="text-[15px] font-semibold">
					<Trans>Matching the resume</Trans>
				</h2>
				{letter.sourceResumeId ? (
					<>
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
						/>
						{letter.designLinked && (
							<Link
								to="/builder/$resumeId"
								params={{ resumeId: letter.sourceResumeId }}
								search={{ mode: "design" }}
								className={buttonVariants({ variant: "secondary", size: "sm", className: "w-fit" })}
							>
								<Icon name="palette" size={16} />
								<Trans>Change the resume's design</Trans>
							</Link>
						)}
					</>
				) : (
					<p className="text-sm text-ink-2">
						<Trans>Choose a resume in Write to match its design. Until then, the letter has its own.</Trans>
					</p>
				)}
			</section>

			<section aria-labelledby="letter-design-language" className="grid gap-3 px-4 py-5">
				<h2 id="letter-design-language" className="text-[15px] font-semibold">
					<Trans>Language</Trans>
				</h2>
				<LetterLanguageField disabled={disabled} />
				<span className="text-xs text-ink-3">
					<Trans>
						Writes the greeting, sign-off and date, and the language a new draft uses. Your own words stay as you wrote
						them.
					</Trans>
				</span>
			</section>

			{!letter.designLinked && (
				<section aria-labelledby="letter-design-template" className="grid gap-3 px-4 py-5">
					<h2 id="letter-design-template" className="text-[15px] font-semibold">
						<Trans>Template</Trans>
					</h2>
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
											"relative block aspect-[1/1.414] overflow-hidden rounded-md border bg-white transition-[translate,scale,box-shadow] duration-quick ease-enter group-hover/template:-translate-y-0.5 group-active/template:scale-[0.98]",
											selected
												? "border-accent shadow-[0_0_0_2px_var(--accent)]"
												: "border-line group-hover/template:shadow-e2",
										)}
									>
										<img
											src={templates[id].imageUrl}
											alt=""
											loading="lazy"
											className="size-full object-cover object-top"
										/>
										{selected && (
											<span className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-sm bg-accent text-on-accent">
												<Icon name="check" size={14} />
											</span>
										)}
									</span>
									<span className="text-sm leading-4 font-medium">{templates[id].name}</span>
								</button>
							);
						})}
					</fieldset>
				</section>
			)}

			{!letter.designLinked && (
				<DesignSourceProvider value={designSource}>
					<section aria-labelledby="letter-design-type" className="grid gap-3 px-4 py-5">
						<h2 id="letter-design-type" className="text-[15px] font-semibold">
							<Trans>Type</Trans>
						</h2>
						<TypeGroup />
					</section>
					<section aria-labelledby="letter-design-color" className="grid gap-3 px-4 py-5">
						<h2 id="letter-design-color" className="text-[15px] font-semibold">
							<Trans>Color</Trans>
						</h2>
						<ColorGroup />
					</section>
					<section aria-labelledby="letter-design-page" className="grid gap-3 px-4 py-5">
						<h2 id="letter-design-page" className="text-[15px] font-semibold">
							<Trans>Page</Trans>
						</h2>
						<PageGroup showLanguage={false} />
					</section>
				</DesignSourceProvider>
			)}
		</div>
	);
}

/** The letter's language, independent of whether its design follows the resume. */
function LetterLanguageField({ disabled }: { disabled: boolean }) {
	const id = useId();
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
