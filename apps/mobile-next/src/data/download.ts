import type { DocumentRef } from "./lifecycle";
import type { Directory } from "expo-file-system";
import { t } from "@lingui/core/macro";
import { File } from "expo-file-system";
import { dataClient } from "./client";
import { isFake } from "./fixtures";
import { activeDataScope, assertDataScope } from "./scope";
import { rest } from "@/api/client";
import { pageRenderer } from "@/render/page-renderer";
export type DownloadFormat = "pdf" | "docx" | "json";
/** Saving to a chosen directory is distinct from merely opening the share sheet. */
export async function downloadDocuments(
	documents: readonly DocumentRef[],
	format: DownloadFormat,
	directory: Directory,
	signal: AbortSignal,
) {
	const scope = activeDataScope();
	const saved: string[] = [];
	for (const ref of documents) {
		assertDataScope(scope);
		signal.throwIfAborted();
		const document =
			ref.type === "resume"
				? await dataClient.resume.getById({ id: ref.id }, { signal, context: { scope } })
				: await dataClient.coverLetters.getById({ id: ref.id }, { signal, context: { scope } });
		assertDataScope(scope);
		const name = safeFileName(document.name).slice(0, 80) || "document";
		const file = new File(directory, `${name}-${saved.length + 1}.${format}`);
		if (format === "pdf") {
			const result = await pageRenderer.render({
				kind: ref.type,
				id: ref.id,
				revision: "revision" in document ? document.revision : document.updatedAt.toISOString(),
			});
			assertDataScope(scope);
			signal.throwIfAborted();
			if (result.stale) throw new Error(t`Current PDF unavailable. Previously saved files are kept.`);
			new File(result.pdfFile).copy(file);
		} else if (isFake()) {
			if (format !== "json") throw new Error(t`Word export needs a real server.`);
			file.write(JSON.stringify(document));
		} else {
			const response = await rest(
				`/${ref.type === "letter" ? "cover-letters" : "resumes"}/${encodeURIComponent(ref.id)}/exports/${format}`,
				{ signal },
				scope,
			);
			if (!response.ok) throw new Error(t`Couldn't generate this file. Previously saved files are kept.`);
			const bytes = new Uint8Array(await response.arrayBuffer());
			assertDataScope(scope);
			signal.throwIfAborted();
			file.write(bytes);
		}
		saved.push(file.uri);
	}
	return saved;
}
