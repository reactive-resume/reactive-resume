import { call, ORPCError } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../context";
import { storageUploadRateLimit } from "../../middleware/rate-limit";
import { crudRouter } from "./crud";

export const importResumeFile = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/file-imports",
		tags: ["Resumes"],
		operationId: "importResumeFile",
		summary: "Import a PDF, resume JSON or LinkedIn archive",
		description:
			"Multipart form with file and format fields. PDF imports read the text layer without AI. For AI-assisted PDF and Word imports, use the AI parsing endpoints then create a resume import.",
	})
	.input(
		z.object({
			file: z.file().max(10 * 1024 * 1024),
			format: z.enum(["REACTIVE_RESUME", "REACTIVE_RESUME_V4", "JSON_RESUME", "LINKEDIN", "PDF"]),
		}),
	)
	.output(z.string().describe("The imported resume ID."))
	.use(storageUploadRateLimit)
	.handler(async ({ input, context, signal }) => {
		let data;
		try {
			if (input.format === "PDF") {
				const [{ extractPdf }, { documentToLines }, { buildExtractedDocument }, { parseResumeText }] =
					await Promise.all([
						import("./pdf-analysis"),
						import("@reactive-resume/import/pdf-lines"),
						import("@reactive-resume/resume/ats-pdf"),
						import("@reactive-resume/import/plain-text"),
					]);
				const raw = await extractPdf(input.file, signal, 0);
				if (raw.truncated) throw new Error("The PDF has too many pages to import completely.");
				const lines = documentToLines(buildExtractedDocument(raw));
				if (lines.length === 0) throw new Error("The PDF has no readable text layer.");
				data = parseResumeText(lines.join("\n"));
			} else if (input.format === "LINKEDIN") {
				const { parseLinkedInExport } = await import("@reactive-resume/import/linkedin");
				data = parseLinkedInExport(new Uint8Array(await input.file.arrayBuffer()));
			} else {
				const text = await input.file.text();
				if (input.format === "JSON_RESUME") {
					const { parseJSONResume } = await import("@reactive-resume/import/json-resume");
					data = parseJSONResume(text);
				} else if (input.format === "REACTIVE_RESUME_V4") {
					const { parseReactiveResumeV4JSON } = await import("@reactive-resume/import/reactive-resume-v4-json");
					data = parseReactiveResumeV4JSON(text);
				} else {
					const { parseReactiveResumeJSON } = await import("@reactive-resume/import/reactive-resume-json");
					data = parseReactiveResumeJSON(text);
				}
			}
			const { convertLegacyStylesheet, needsLegacyStyleConversion } =
				await import("@reactive-resume/pdf/semantic-legacy");
			if (needsLegacyStyleConversion(data.metadata)) data.metadata.stylesheet = convertLegacyStylesheet(data);
		} catch (error) {
			throw new ORPCError("BAD_REQUEST", {
				message: "The file is not a valid resume in the selected format.",
				cause: error,
			});
		}
		return call(crudRouter.import, { data }, { context });
	});
