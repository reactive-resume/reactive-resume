import { t } from "@lingui/core/macro";
import { randomUUID } from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { sanitizeFileName } from "@reactive-resume/utils/file";
import { readResponseBytes } from "@reactive-resume/utils/http";
import { privateUpload } from "@/api/client";
import { dataClient } from "@/data/client";
import { isFake } from "@/data/fixtures";
import { activeDataScope, assertDataScope } from "@/data/scope";

const MAX_POSTING_BYTES = 10 * 1024 * 1024;

export class PostingPdfError extends Error {}

/** The PDF picker's result, validated before any upload starts. */
export async function pickPostingPdf(): Promise<File | null> {
	const picked = await DocumentPicker.getDocumentAsync({
		type: "application/pdf",
		copyToCacheDirectory: true,
		multiple: false,
	});
	const asset = picked.canceled ? null : picked.assets[0];
	if (!asset) return null;
	const file = new File(asset.uri);
	if (file.size > MAX_POSTING_BYTES) throw new PostingPdfError(t`Choose a PDF up to 10 MB.`);
	if (file.type !== "application/pdf") throw new PostingPdfError(t`Choose a PDF file.`);
	return file;
}

/** Uploads the employer's posting as the application's original copy. Online-only: a File cannot wait in the queue. */
export async function attachPostingPdf(applicationId: string, file: File) {
	const scope = activeDataScope();
	assertDataScope(scope);
	if (isFake()) {
		await dataClient.applications.update({
			id: applicationId,
			postingFileUrl: `fixture://${file.name}`,
			postingFileName: file.name,
		});
		return;
	}
	await dataClient.applications.update(
		{ id: applicationId, postingFile: file as unknown as globalThis.File, postingFileName: file.name },
		{ context: { scope } },
	);
	assertDataScope(scope);
}

export async function removePostingPdf(applicationId: string) {
	const scope = activeDataScope();
	assertDataScope(scope);
	await dataClient.applications.update(
		{ id: applicationId, postingFileUrl: null, postingFileName: null },
		{ context: { scope } },
	);
	assertDataScope(scope);
}

/** PDFs need the session, so fetch with the bearer token and hand the bytes to the system share sheet. */
export async function openPostingPdf(url: string, name: string) {
	if (isFake()) return;
	const scope = activeDataScope();
	const controller = new AbortController();
	const response = await privateUpload(url, controller.signal, scope);
	const bytes = await readResponseBytes(response, MAX_POSTING_BYTES, controller.signal);
	assertDataScope(scope);
	const sanitized = sanitizeFileName(name).slice(0, 80) || "posting";
	const filename = sanitized.toLowerCase().endsWith(".pdf") ? sanitized : `${sanitized}.pdf`;
	const directory = new Directory(Paths.cache, `posting-${randomUUID()}`);
	directory.create();
	try {
		const file = new File(directory, filename);
		file.write(bytes);
		if (!(await Sharing.isAvailableAsync())) throw new PostingPdfError(t`Opening PDFs is unavailable on this device.`);
		assertDataScope(scope);
		await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
	} finally {
		directory.delete();
	}
}
