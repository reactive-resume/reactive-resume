import { ORPCError } from "@orpc/server";
import { harvestPdfDocument } from "@reactive-resume/resume/ats-pdf";

/** Server adapter for the same bounded extraction used by the browser's checker and importer. */
export async function extractPdf(file: File, signal?: AbortSignal, operatorBudgetMs = 30_000) {
	const data = new Uint8Array(await file.arrayBuffer());
	if (file.size > 25_000_000 || ![0x25, 0x50, 0x44, 0x46].every((byte, index) => data[index] === byte)) {
		throw new ORPCError("BAD_REQUEST", { message: "Provide a PDF no larger than 25 MB." });
	}
	const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
	const task = getDocument({ data, fontExtraProperties: true, useSystemFonts: false });
	const timeout = AbortSignal.timeout(45_000);
	const aborted = signal ? AbortSignal.any([signal, timeout]) : timeout;
	const cancel = () => {
		void task.destroy().catch(() => {});
	};
	aborted.addEventListener("abort", cancel, { once: true });
	try {
		aborted.throwIfAborted();
		const document = await task.promise;
		return await harvestPdfDocument(document, {
			file: { name: file.name, sizeBytes: file.size, magicBytesOk: true },
			signal: aborted,
			operatorBudgetMs,
		});
	} catch (cause) {
		throw new ORPCError("BAD_REQUEST", {
			message: "The PDF could not be read. Use an unencrypted PDF with a readable text layer.",
			cause,
		});
	} finally {
		aborted.removeEventListener("abort", cancel);
		await task.destroy().catch(() => {});
	}
}
