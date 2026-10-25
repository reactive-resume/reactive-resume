import type { DocumentPickerAsset } from "expo-document-picker";
import { t } from "@lingui/core/macro";
import { File } from "expo-file-system";
import { coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { client, rest } from "@/api/client";
import { getServer } from "@/auth/session";

export type ImportFormat =
	| "REACTIVE_RESUME"
	| "REACTIVE_RESUME_V4"
	| "JSON_RESUME"
	| "LINKEDIN"
	| "PDF"
	| "DOCX"
	| "LETTER";
export type ImportedDocument = { id: string; type: "resume" | "letter" };

export class ImportError extends Error {}

/** JSON formats share an extension; account exports can wrap resume data. */
export function jsonImportFormat(value: unknown): ImportFormat | null {
	if (!value || typeof value !== "object") return null;
	const data = value as Record<string, unknown>;
	if (data.data && !("sections" in data) && !("metadata" in data)) return jsonImportFormat(data.data);
	if (data.format === "reactive-resume-cover-letter") return "LETTER";
	if ("basics" in data && !("sections" in data) && !("metadata" in data)) return "JSON_RESUME";
	if ("sections" in data || "metadata" in data) {
		const metadata = data.metadata;
		if (
			metadata &&
			typeof metadata === "object" &&
			(Array.isArray((metadata as Record<string, unknown>).layout) || !("page" in metadata))
		)
			return "REACTIVE_RESUME_V4";
		return "REACTIVE_RESUME";
	}
	return null;
}

export async function importDocument(
	asset: DocumentPickerAsset,
	aiAvailable: boolean,
	aiPdf: boolean,
	signal: AbortSignal,
): Promise<ImportedDocument> {
	const server = getServer();
	const assertCurrent = () => {
		if (signal.aborted) throw new ImportError(t`Import canceled.`);
		if (getServer() !== server) throw new ImportError(t`Server changed. Return to Documents and try again.`);
	};
	const file = new File(asset.uri);
	if (file.size > 10 * 1024 * 1024 || (asset.size ?? 0) > 10 * 1024 * 1024)
		throw new ImportError(t`File is too large. Choose a file up to 10 MB.`);
	const name = asset.name.toLowerCase();
	if (name.endsWith(".doc") || asset.mimeType === "application/msword")
		throw new ImportError(t`Open the file in Word and save it as .docx first.`);
	let format: ImportFormat | null =
		name.endsWith(".pdf") || asset.mimeType === "application/pdf"
			? "PDF"
			: name.endsWith(".docx") ||
				  asset.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
				? "DOCX"
				: name.endsWith(".zip") || asset.mimeType === "application/zip"
					? "LINKEDIN"
					: null;
	let json: unknown;
	if (!format) {
		try {
			json = JSON.parse(await file.text());
			format = jsonImportFormat(json);
		} catch {
			throw new ImportError(t`This file couldn't be read. Choose a PDF, Word, JSON or LinkedIn export (.zip).`);
		}
	}
	if (!format) throw new ImportError(t`This JSON isn't a supported resume or cover letter.`);
	assertCurrent();
	if (format === "LETTER") {
		const value = json && typeof json === "object" && "data" in json ? json.data : json;
		const parsed = coverLetterDocumentSchema.safeParse(value);
		if (!parsed.success) throw new ImportError(t`This cover letter file isn't valid.`);
		const letter = await client.coverLetters.import({ document: parsed.data }, { signal });
		return { id: letter.id, type: "letter" };
	}
	if (format === "DOCX" || (format === "PDF" && aiPdf)) {
		if (!aiAvailable)
			throw new ImportError(t`Reading this file with AI needs a tested AI provider. Set one up, then retry.`);
		const input = { file: { name: asset.name, data: await file.base64() } };
		assertCurrent();
		const data =
			format === "DOCX"
				? await client.ai.parseDocx(
						{ ...input, mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
						{ signal },
					)
				: await client.ai.parsePdf(input, { signal });
		assertCurrent();
		const id = await client.resume.import({ data }, { signal });
		return { id, type: "resume" };
	}
	const body = new FormData();
	if (json && typeof json === "object" && "data" in json && !("sections" in json) && !("metadata" in json)) {
		body.append("file", new Blob([JSON.stringify(json.data)], { type: "application/json" }), asset.name);
	} else body.append("file", file, asset.name);
	body.append("format", format);
	const response = await rest("/resumes/file-imports", { method: "POST", body, signal });
	if (!response.ok) {
		if (response.status === 401) throw new ImportError(t`Your session expired. Sign in again.`);
		if (response.status === 413) throw new ImportError(t`File is too large. Choose a file up to 10 MB.`);
		if (response.status === 429) throw new ImportError(t`Too many requests. Try again later.`);
		throw new ImportError(
			t`Couldn't import this file. Check the selected format. PDFs need a readable text layer; account archives must be extracted first.`,
		);
	}
	const id: unknown = await response.json();
	if (typeof id !== "string" || !id)
		throw new ImportError(t`The server returned an invalid import result. Refresh Documents before retrying.`);
	return { id, type: "resume" };
}
