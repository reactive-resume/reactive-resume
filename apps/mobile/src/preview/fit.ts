import type { PageMap } from "@reactive-resume/pdf/page-map";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { nativeEngine } from "@reactive-resume/forme-native";
import { renderResumePdf } from "@reactive-resume/pdf/native";
import { configurePreviewResources, readPreviewImage } from "./resources";

/** Layout measurement uses the same engine, fonts and images as the native preview. */
export async function measureResume(data: ResumeData): Promise<PageMap> {
	configurePreviewResources();
	let pageMap: PageMap | undefined;
	await renderResumePdf(nativeEngine, {
		data,
		readImage: readPreviewImage,
		onPageMap: (map) => {
			pageMap = map;
		},
	});
	if (!pageMap) throw new Error("Page map unavailable");
	return pageMap;
}

/** Port of web design/presets: density, margins, then half-point steps with a 9 pt floor. */
export function tightenResume(data: ResumeData): boolean {
	const { page, typography } = data.metadata;
	if (typography.body.lineHeight !== 1.35 || page.gapY !== 4) {
		if (typography.body.lineHeight === 1.65 && page.gapY === 8) {
			typography.body.lineHeight = 1.5;
			page.gapY = 6;
		} else {
			typography.body.lineHeight = 1.35;
			page.gapY = 4;
		}
	} else if (page.marginX !== 10 || page.marginY !== 8) {
		if (page.marginX === 19 && page.marginY === 16) {
			page.marginX = 14;
			page.marginY = 12;
		} else {
			page.marginX = 10;
			page.marginY = 8;
		}
	} else if (typography.body.fontSize > 9) {
		const ratio = typography.body.fontSize > 0 ? typography.heading.fontSize / typography.body.fontSize : 1.4;
		typography.body.fontSize = Math.max(9, Math.round((typography.body.fontSize - 0.5) * 2) / 2);
		typography.heading.fontSize = Math.round(typography.body.fontSize * ratio * 2) / 2;
	} else return false;
	return true;
}

/** Measure a private candidate. Caller applies once through DraftStore.update, giving Fit one undo step. */
export async function fitResume(data: ResumeData, isCurrent: () => boolean) {
	configurePreviewResources();
	const candidate = structuredClone(data);
	const authored = Math.max(1, data.metadata.layout.pages.length);
	for (let step = 0; step < 16 && isCurrent() && tightenResume(candidate); step++) {
		const count = (await measureResume(candidate)).pages.length;
		if (count <= authored) return { data: candidate, fits: true };
	}
	return { data: candidate, fits: false };
}
