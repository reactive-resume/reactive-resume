import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { fnv1a } from "@reactive-resume/utils/string";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";
import { createPdfFirstPageImage, releaseThumbnailUrls } from "@/features/resume/preview/pdf-thumbnail";
import { enqueueThumbnailRender } from "@/features/resume/preview/resume-thumbnail.shared";

const QUERY_KEY = "template-thumbnail";
// Twice the gallery card (about 172 × 243 CSS px), so thumbnails stay sharp on high-density screens.
const SIZE = { width: 344, height: 486 };

/** A hash of the content, so a thumbnail re-renders only when the resume changes. */
const fingerprint = (data: ResumeData) =>
	fnv1a(JSON.stringify({ ...data, metadata: { ...data.metadata, template: null } })).toString(36);

/** The newest image already rendered for `template` from this resume's earlier content (never another resume's). */
function lastRender(queryClient: QueryClient, resumeId: string, template: Template): string | undefined {
	const [latest] = queryClient
		.getQueryCache()
		.findAll({ queryKey: [QUERY_KEY, resumeId, template] })
		.filter((query) => typeof query.state.data === "string")
		.toSorted((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
	return latest?.state.data as string | undefined;
}

/**
 * A template's first page rendered from the user's own content, font and colour. Cached by template and
 * content; until it's ready the gallery shows the template's sample image, so the grid never jumps.
 */
export function useTemplateThumbnail(template: Template, data: ResumeData, enabled: boolean, resumeId = "") {
	const queryClient = useQueryClient();
	const hash = fingerprint(data);
	// New resumes inherit account details; those alone don't show a template's section layout.
	const hasContent = Boolean(
		buildMarkdown({ ...data, basics: defaultResumeData.basics }).trim() || (!data.picture.hidden && data.picture.url),
	);

	useEffect(() => {
		releaseThumbnailUrls(queryClient, QUERY_KEY);
	}, [queryClient]);

	return useQuery({
		// Keyed by resume too, so a render of one resume never stands in for another's.
		queryKey: [QUERY_KEY, resumeId, template, hash],
		queryFn: ({ signal }) =>
			enqueueThumbnailRender(async () => {
				const pdf = await createResumePdfBlob({ ...data, metadata: { ...data.metadata, template } });
				return URL.createObjectURL(await createPdfFirstPageImage(pdf, SIZE, signal));
			}, signal),
		enabled: enabled && hasContent,
		// Mutations invalidate every query; the same template and content draw the same image, so never refetch.
		staleTime: "static",
		// While the new image renders, show this template's last render of this resume (also after Design
		// was closed and reopened), never the sample: that one shows other people's names and photos.
		placeholderData: (previous) =>
			hasContent ? (previous ?? (resumeId ? lastRender(queryClient, resumeId, template) : undefined)) : undefined,
	});
}
