import { Trans } from "@lingui/react/macro";
import { useId } from "react";
import { Combobox } from "@/components/ui/combobox";
import { getLocaleOptions } from "@/features/locale/locale-options";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";

type ResumeLanguageProps = { locked: boolean };

/**
 * The resume's own language, at the top of Write: a new resume takes the interface language, which is easy to miss
 * when writing in another one. The same setting as Design → Page → Language.
 */
export function ResumeLanguage({ locked }: ResumeLanguageProps) {
	const id = useId();
	const locale = useCurrentBuilderResumeSelector((resume) => resume.data.metadata.page.locale);
	const updateResumeData = useUpdateResumeData();

	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs text-ink-3">
			<label htmlFor={id} className="font-semibold">
				<Trans comment="Label beside the picker for the language a resume's headings and dates print in">
					Resume language
				</Trans>
			</label>
			<Combobox
				id={id}
				disabled={locked}
				options={getLocaleOptions()}
				value={locale}
				onValueChange={(next) =>
					updateResumeData(
						(draft) => {
							draft.metadata.page.locale = (next ?? "en-US") as string;
						},
						{ newStep: true },
					)
				}
				className="h-7 w-auto min-w-36 text-xs"
			/>
			<span>
				<Trans>Changes section titles and date words only, not your content.</Trans>
			</span>
		</div>
	);
}
