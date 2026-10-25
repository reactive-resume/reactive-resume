import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { ORPCError } from "@orpc/server";
import z from "zod";
import { env } from "@reactive-resume/env/server";
import { composeCoverLetter, createCoverLetterResumeData } from "@reactive-resume/resume/cover-letter";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { generateFilename } from "@reactive-resume/utils/file";
import { protectedProcedure } from "../../context";
import { pdfExportRateLimit } from "../../middleware/rate-limit";
import { coverLetterService } from "../cover-letters/service";
import { resumeService } from "../resume/service";

const exportInput = z.object({
	id: z.string().min(1),
	format: z.enum(["pdf", "docx", "odt", "md", "json"]),
});
const exportOutput = z.object({ headers: z.object({ "content-disposition": z.string() }), body: z.file() });

/** Builds the download response (headers + body) for a resume or cover letter in the requested format. */
async function fileResponse(
	data: ResumeData,
	name: string,
	format: z.infer<typeof exportInput>["format"],
	json: unknown,
	includeCoverLetterHeader = false,
) {
	const filename = generateFilename(name, format);
	let body: File;
	try {
		if (format === "json") body = new File([JSON.stringify(json, null, 2)], filename, { type: "application/json" });
		else if (format === "pdf") {
			const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
			body = await createResumePdfFile({
				data,
				filename,
				uploadOrigin: env.APP_URL,
				renderOptions: { includeCoverLetterHeader },
			});
		} else {
			const { getResumeSectionTitle } = await import("@reactive-resume/pdf/section-title");
			const resolveTitle = (id: string) => getResumeSectionTitle(data, id);
			if (format === "md") body = new File([buildMarkdown(data, resolveTitle)], filename, { type: "text/markdown" });
			else {
				const blob =
					format === "odt"
						? await (await import("@reactive-resume/odt")).buildOdt(data, resolveTitle)
						: await (await import("@reactive-resume/docx")).buildDocx(data, resolveTitle);
				body = new File([blob], filename, { type: blob.type });
			}
		}
	} catch (error) {
		console.error("[document export] Rendering failed", error);
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Couldn't generate the document. Try again." });
	}
	return { headers: { "content-disposition": `attachment; filename="${filename}"` }, body };
}

export const documentExports = {
	resume: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}/exports/{format}",
			tags: ["Resumes"],
			operationId: "exportResumeFile",
			summary: "Download a resume in PDF, DOCX, ODT, Markdown or JSON",
			description: "Renders the resume as a file in the chosen format.",
			outputStructure: "detailed",
		})
		.input(exportInput)
		.output(exportOutput)
		.use(pdfExportRateLimit)
		.handler(async ({ context, input }) => {
			const resume = await resumeService.getById({ id: input.id, userId: context.user.id });
			return fileResponse(getResumeExportData(resume.data, "resume"), resume.name, input.format, resume.data);
		}),
	letter: protectedProcedure
		.route({
			method: "GET",
			path: "/cover-letters/{id}/exports/{format}",
			tags: ["Cover Letters"],
			operationId: "exportCoverLetterFile",
			summary: "Download a cover letter in PDF, DOCX, ODT, Markdown or JSON",
			description:
				"Renders the cover letter as a file in the chosen format. Linked sender details and design come live from its resume. Structured letter greetings default to English; pass `words` to localize them. Dates use the document's locale.",
			outputStructure: "detailed",
		})
		.input(
			exportInput.extend({
				words: z
					.object({
						greeting: z.string().max(500).describe("Use {name} for the recipient."),
						teamGreeting: z.string().max(500),
						hiringTeam: z.string().max(500),
						signOff: z.string().max(500),
					})
					.optional(),
			}),
		)
		.output(exportOutput)
		.use(pdfExportRateLimit)
		.handler(async ({ context, input }) => {
			const letter = await coverLetterService.getById({ id: input.id, userId: context.user.id });
			const words = input.words ?? {
				greeting: "Dear {name},",
				teamGreeting: "Dear hiring team,",
				hiringTeam: "Hiring team",
				signOff: "Kind regards,",
			};
			const composed = composeCoverLetter(letter, {
				...words,
				greeting: (name) => words.greeting.replace("{name}", () => name),
				formatDate: (date) =>
					new Date(`${date}T12:00:00Z`).toLocaleDateString(letter.style.metadata.page.locale, {
						day: "numeric",
						month: "long",
						year: "numeric",
						timeZone: "UTC",
					}),
			});
			const json =
				input.format === "json" ? await coverLetterService.export({ id: input.id, userId: context.user.id }) : null;
			return fileResponse(
				createCoverLetterResumeData({ ...letter, ...composed }),
				letter.name,
				input.format,
				json,
				true,
			);
		}),
};
