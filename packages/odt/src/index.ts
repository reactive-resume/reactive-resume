import type { OdtRenderOptions, SectionTitleResolver } from "./types";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Zippable } from "fflate";
import { strToU8, zipSync } from "fflate";
import { parseResumeData } from "@reactive-resume/schema/resume/data";
import { ODT_MIME_TYPE, buildOdtFiles } from "./builder";

export type { SectionTitleResolver } from "./types";

/**
 * Builds an ODT file from resume data and returns it as a Blob. Pass `resolveTitle` to fill in
 * locale-aware section headings (titles are stored empty and resolved at render time).
 */
// oxlint-disable-next-line require-await -- keep synchronous renderer errors on the public Promise rejection path.
export async function buildOdt(
	data: ResumeData,
	resolveTitle?: SectionTitleResolver,
	options?: OdtRenderOptions,
): Promise<Blob> {
	const archive: Zippable = {};
	// ODF wants `mimetype` as the first entry, stored uncompressed; `buildOdtFiles` lists it first.
	for (const [path, content] of Object.entries(buildOdtFiles(parseResumeData(data), resolveTitle, options))) {
		archive[path] = [strToU8(content), { level: path === "mimetype" ? 0 : 6 }];
	}
	return new Blob([zipSync(archive)], { type: ODT_MIME_TYPE });
}
