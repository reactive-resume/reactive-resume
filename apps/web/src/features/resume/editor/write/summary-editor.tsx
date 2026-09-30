import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { RichTextEditor } from "./rich-text-editor";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";

/** The summary: one rich text, with the guidance the spec gives. Improve joins it in M10. */
export function SummaryEditor({ locked }: { locked: boolean }) {
	const content = useCurrentBuilderResumeSelector((resume) => resume.data.summary.content);
	const updateResumeData = useUpdateResumeData();

	return (
		<RichTextEditor
			label={t`Summary`}
			value={content}
			disabled={locked}
			hint={<Trans>2–3 sentences reads best</Trans>}
			onChange={(html) =>
				updateResumeData(
					(draft) => {
						draft.summary.content = html;
					},
					{ coalesceKey: "summary.content" },
				)
			}
		/>
	);
}
