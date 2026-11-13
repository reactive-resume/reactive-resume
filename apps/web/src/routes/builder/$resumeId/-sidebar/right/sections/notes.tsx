import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { SectionBase } from "../shared/section-base";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { RichTextEditor } from "@/features/resume/editor/write/rich-text-editor";

export function NotesSectionBuilder() {
	return (
		<SectionBase type="notes">
			<NotesSectionForm />
		</SectionBase>
	);
}

function NotesSectionForm() {
	const resume = useCurrentResume();
	const notes = resume.data.metadata.notes;
	const updateResumeData = useUpdateResumeData();

	const onChange = (value: string, options?: { newStep?: boolean }) => {
		updateResumeData((draft) => {
			draft.metadata.notes = value;
		}, options);
	};

	return (
		<div className="space-y-4">
			<p className="t-body text-ink-2">
				<Trans>Private notes about this resume. Nobody else can see them.</Trans>
			</p>

			<div className="space-y-2">
				<RichTextEditor label={t`Notes`} value={notes} onChange={onChange} disabled={resume.isLocked} compact />

				<p className="t-caption text-ink-3">
					<Trans>For example, where you sent this resume, or links to the postings.</Trans>
				</p>
			</div>
		</div>
	);
}
