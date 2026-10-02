import type { ResumeRenderOptions } from "./context";
import type { SectionTitleResolver } from "./section-title";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import * as forme from "@formepdf/core";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { readServerImage } from "./forme/images.node.ts";
import { assertPdfText, renderResume } from "./forme/render";

export type CreateResumePdfFileOptions = {
	data: ResumeData;
	filename: string;
	template?: Template | undefined;
	renderOptions?: ResumeRenderOptions | undefined;
	resolveSectionTitle?: SectionTitleResolver | undefined;
	/** Operator-configured app origin; only its public picture upload paths may use private addresses. */
	uploadOrigin?: string | undefined;
};

export const createResumePdfFile = async ({
	filename,
	uploadOrigin,
	...input
}: CreateResumePdfFileOptions): Promise<File> => {
	const result = await renderResume(forme, {
		...input,
		data: parseResumeData(input.data),
		readImage: (source) => readServerImage(source, uploadOrigin),
	});
	assertPdfText(result);
	return new File([result.pdf as Uint8Array<ArrayBuffer>], filename, { type: "application/pdf" });
};
