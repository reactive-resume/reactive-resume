import type { Resume } from "@/features/resume/builder/draft";
import { useCallback } from "react";
import { useUpdateResumeData } from "@/features/resume/builder/draft";
import { getDefaultFileName, sanitizeFileName } from "@/features/resume/export/use-resume-export";

/**
 * The resume's download file name, kept with the resume so it's there next time and on every device. `saved` is
 * empty while the generated name applies; typing the generated name back (or clearing the field) returns to it,
 * so it keeps following the author's name. A locked resume can't be edited, so `save` is undefined and a typed
 * name lasts only for this download.
 */
export function useResumeFileName(resume: Resume) {
	const updateResumeData = useUpdateResumeData();
	const generated = getDefaultFileName(resume);
	const saved = sanitizeFileName(resume.data.metadata.fileName ?? "");

	const save = useCallback(
		(value: string) => {
			const next = sanitizeFileName(value);
			updateResumeData(
				(draft) => {
					draft.metadata.fileName = next === generated ? "" : next;
				},
				{ coalesceKey: "metadata.fileName" },
			);
		},
		[generated, updateResumeData],
	);

	return { generated, saved, save: resume.isLocked ? undefined : save };
}
