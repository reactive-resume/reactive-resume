import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { RichTextEditor } from "./rich-text-editor";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";

/** The summary: one rich text, with the guidance the spec gives. Improve joins it in M10. */
export function SummaryEditor({ locked }: { locked: boolean }) {
	const content = useCurrentBuilderResumeSelector((resume) => resume.data.summary.content);
	const updateResumeData = useUpdateResumeData();

	return (
		<div className="grid gap-1.5">
			<span className="t-small font-medium text-ink-2">
				<Trans>Text</Trans>
			</span>
			<RichTextEditor
				label={t`Summary`}
				value={content}
				disabled={locked}
				hint={<Trans>2–3 sentences reads best</Trans>}
				onChange={(html, options) =>
					updateResumeData(
						(draft) => {
							draft.summary.content = html;
						},
						{ coalesceKey: "summary.content", ...options },
					)
				}
			/>
		</div>
	);
}
