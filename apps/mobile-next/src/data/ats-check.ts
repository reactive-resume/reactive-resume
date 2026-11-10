import type { PdfAtsReport } from "@reactive-resume/resume/ats-pdf";
import { t } from "@lingui/core/macro";
import { File } from "expo-file-system";
import { getNetworkStateAsync } from "expo-network";
import { rest } from "@/api/client";

export type AtsResult = { report: PdfAtsReport; fullText: string };

/** The server checks PDFs up to 25 MB (`POST /pdf-checks`). */
export const MAX_CHECK_BYTES = 25_000_000;
/** Importing into the editor (`POST /resumes/file-imports`) takes up to 10 MB. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export class AtsCheckError extends Error {}

/** "%PDF" first, and no `/Encrypt` in the trailer: the server can't say which of the two failed, so ask here. */
function sniff(file: File) {
	const handle = file.open();
	try {
		const header = handle.readBytesSync(4);
		if (String.fromCharCode(...header) !== "%PDF") throw new AtsCheckError(t`That file couldn't be read as a PDF.`);
		// ponytail: trailer heuristic; an /Encrypt entry outside the last 4 KB falls through to the server's error.
		handle.offset = Math.max(0, (handle.size ?? 0) - 4096);
		if (String.fromCharCode(...handle.readBytesSync(4096)).includes("/Encrypt"))
			throw new AtsCheckError(t`This PDF is password protected. Save an unprotected copy and try again.`);
	} finally {
		handle.close();
	}
}

/** Uploads the PDF to the server's checker, which reads it in memory and stores nothing. */
export async function runAtsCheck(uri: string, name: string, posting: string, signal: AbortSignal): Promise<AtsResult> {
	const file = new File(uri);
	if (file.size > MAX_CHECK_BYTES) throw new AtsCheckError(t`That file is too large to check. PDFs up to 25 MB work.`);
	sniff(file);

	const network = await getNetworkStateAsync();
	if (network.isConnected === false || network.isInternetReachable === false)
		throw new AtsCheckError(t`You're offline. Connect to check a file.`);

	const body = new FormData();
	body.append("file", file, name);
	if (posting.trim()) body.append("jobDescription", posting.trim());
	const response = await rest("/pdf-checks", { method: "POST", body, signal });
	if (!response.ok) {
		if (response.status === 413) throw new AtsCheckError(t`That file is too large to check. PDFs up to 25 MB work.`);
		if (response.status === 429) throw new AtsCheckError(t`Too many requests. Try again later.`);
		if (response.status === 400) throw new AtsCheckError(t`That file couldn't be read as a PDF.`);
		throw new AtsCheckError(t`Couldn't read that file. Try again.`);
	}
	// The server sends the report itself with `fullText` beside its fields (`checkPdf` output), not nested.
	const { fullText, ...report } = (await response.json()) as PdfAtsReport & { fullText: string };
	return { report, fullText };
}
