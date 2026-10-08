import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { createResumePdfBlob } from "@/features/resume/export/pdf-document";
import { createPdfFirstPageImageUrl, releaseThumbnailUrls } from "@/features/resume/preview/pdf-thumbnail";

const QUERY_KEY = "template-thumbnail";
// Twice the gallery card (about 172 × 243 CSS px), so thumbnails stay sharp on high-density screens.
const SIZE = { width: 344, height: 486 };

let queue: Promise<unknown> = Promise.resolve();

const whenIdle = () =>
	new Promise<void>((resolve) => {
		if ("requestIdleCallback" in window) window.requestIdleCallback(() => resolve(), { timeout: 2000 });
		else setTimeout(resolve, 50);
	});

/** Renders one thumbnail at a time, when the browser is idle, so they never compete with the page. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
	const run = queue.then(whenIdle).then(task);
	queue = run.catch(() => undefined);
	return run;
}

/** FNV-1a over the content, so a thumbnail re-renders only when the resume changes. */
function fingerprint(data: ResumeData) {
	const text = JSON.stringify({ ...data, metadata: { ...data.metadata, template: null } });
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index++) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(36);
}

/**
 * A template's first page rendered from the user's own content, font and colour. Cached by template and
 * content; until it's ready the gallery shows the template's sample image, so the grid never jumps.
 */
export function useTemplateThumbnail(template: Template, data: ResumeData, enabled: boolean) {
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
		queryKey: [QUERY_KEY, template, hash],
		queryFn: ({ signal }) =>
			enqueue(async () => {
				signal.throwIfAborted();
				const pdf = await createResumePdfBlob({ ...data, metadata: { ...data.metadata, template } });
				return createPdfFirstPageImageUrl(pdf, SIZE, signal);
			}),
		enabled: enabled && hasContent,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 5 * 60 * 1000,
		// Keep the previous image while the content changes, so thumbnails don't flash back to the sample.
		placeholderData: (previous) => (hasContent ? previous : undefined),
	});
}
