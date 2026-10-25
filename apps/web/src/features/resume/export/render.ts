import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { createResumePdfBlob } from "@reactive-resume/pdf/browser";

export type RenderInput = { data: ResumeData; renderOptions?: { includeCoverLetterHeader?: boolean } | undefined };
export type Rendered = { blob: Blob; pageMap: PageMap | undefined; lostCharacters: string[] | undefined };

/** One render with its page map and lost characters; runs in the PDF worker, or on the main thread without one. */
export async function renderResumePdf({ data, renderOptions }: RenderInput): Promise<Rendered> {
	let pageMap: PageMap | undefined;
	let lostCharacters: string[] | undefined;
	const blob = await createResumePdfBlob({
		data,
		renderOptions,
		onPageMap: (map) => {
			pageMap = map;
		},
		onLostCharacters: (characters) => {
			lostCharacters = characters;
		},
	});
	return { blob, pageMap, lostCharacters };
}
