import { call, ORPCError } from "@orpc/server";
import z from "zod";
import { pdfImportPreviewSchema } from "@reactive-resume/import/review";
import { protectedProcedure } from "../../context";
import { storageUploadRateLimit } from "../../middleware/rate-limit";
import { crudRouter } from "./crud";

async function readPdfImport(file: File, signal?: AbortSignal) {
	const [{ extractPdf }, { parsePdfResume }, { buildExtractedDocument }] = await Promise.all([
		import("./pdf-analysis"),
		import("@reactive-resume/import/pdf-lines"),
		import("@reactive-resume/resume/ats-pdf"),
	]);
	const raw = await extractPdf(file, signal, 0);
	const document = buildExtractedDocument(raw);
	const partial = raw.truncated || raw.textReadFailed === true || raw.annotationReadFailed === true;
	return {
		data: !partial && document.lines.length ? parsePdfResume(document) : null,
		source: {
			lines: document.lines.map((line) => line.text),
			links: raw.links.flatMap((link) => (link.url ? [link.url] : [])),
			partial,
		},
	};
}

export const previewPdfImport = protectedProcedure
	.route({
		method: "POST",
		path: "/resumes/file-previews",
		tags: ["Resumes"],
		operationId: "previewPdfImport",
		summary: "Read a PDF before creating a resume",
		description:
			"Returns unsaved resume data, source text and annotation targets without AI. Reads at most 30 pages and reports partial coverage. Stores nothing; requires authentication and write access.",
	})
	.input(z.object({ file: z.file().max(10 * 1024 * 1024) }))
	.output(pdfImportPreviewSchema)
	.use(storageUploadRateLimit)
	.handler(({ input, context, signal }) => {
		context.resHeaders?.set("Cache-Control", "private, no-store");
		return readPdfImport(input.file, signal);
	});

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
				const preview = await readPdfImport(input.file, signal);
				if (preview.source.partial) throw new Error("The PDF has too many pages to import completely.");
				if (!preview.data) throw new Error("The PDF has no readable text layer.");
				data = preview.data;
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
				message: "This file isn't a valid resume in the selected format. Check the format and try again.",
				cause: error,
			});
		}
		return call(crudRouter.import, { data }, { context });
	});
