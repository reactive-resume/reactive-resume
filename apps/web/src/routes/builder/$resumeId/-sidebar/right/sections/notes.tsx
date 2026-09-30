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

	const onChange = (value: string) => {
		updateResumeData((draft) => {
			draft.metadata.notes = value;
		});
	};

	return (
		<div className="space-y-4">
			<p>
				<Trans>Keep private notes about this resume here. Nobody else can see them.</Trans>
			</p>

			<RichTextEditor label={t`Notes`} value={notes} onChange={onChange} disabled={resume.isLocked} />

			<p className="text-ink-3">
				<Trans>For example, note which companies you sent this resume to, or links to the job descriptions.</Trans>
			</p>
		</div>
	);
}
