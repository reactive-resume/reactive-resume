import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { DocumentPickerAsset } from "expo-document-picker";
import { t } from "@lingui/core/macro";
import { File } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { extractDocxText } from "@reactive-resume/import/docx-text";
import { parseJSONResume } from "@reactive-resume/import/json-resume";
import { parseReactiveResumeJSON } from "@reactive-resume/import/reactive-resume-json";
import { parseReactiveResumeV4JSON } from "@reactive-resume/import/reactive-resume-v4-json";
import {
	pdfImportPreviewSchema,
	reviewImport,
	withLeftoverSection,
	withLinkTargets,
	type ImportReview,
} from "@reactive-resume/import/review";
import { isQueueBundle, restoreQueued, type QueueBundle } from "./backup";
import { dataClient } from "./client";
import { ensureApproved, type Connection } from "./consent";
import { isFake } from "./fixtures";
import { activeDataScope, assertDataScope } from "./scope";
import { rest, client } from "@/api/client";

export type ImportStep = "reading" | "parsing" | "review" | "creating" | "restoring" | "complete";
export class DocumentImportError extends Error {
	constructor(
		readonly code: "unsupported" | "too-large" | "invalid" | "consent" | "unreadable" | "canceled" | "server",
		readonly file: DocumentPickerAsset,
		options?: ErrorOptions,
	) {
		const messages = {
			unsupported: t`Choose a PDF, Word or JSON file. Your file is kept.`,
			"too-large": t`File is too large. Choose a file up to 10 MB.`,
			invalid: t`This file couldn't be read. Your file is kept.`,
			consent: t`File sharing wasn't approved. Your file is kept.`,
			unreadable: t`Couldn't read the file. Your file is kept.`,
			canceled: t`Import canceled. Your file is kept.`,
			server: t`Couldn't import the file. Your file is kept. Try again.`,
		};
		super(messages[code], options);
		this.name = "DocumentImportError";
	}
}
export type ImportPreview =
	| {
			kind: "resume";
			file: DocumentPickerAsset;
			scope: string;
			data: ResumeData;
			summary: ImportReview;
			language: string;
			compared: boolean;
			partial: boolean;
			aiOperationIds: string[];
	  }
	| { kind: "backup"; file: DocumentPickerAsset; scope: string; bundle: QueueBundle };
export type ImportOptions = {
	signal: AbortSignal;
	connection?: Connection;
	ai?: boolean;
	onStep?: (step: ImportStep) => void;
};
export function parseResumeFileJSON(value: unknown): ResumeData {
	if (value && typeof value === "object" && "data" in value && !("sections" in value))
		return parseResumeFileJSON(value.data);
	if (!value || typeof value !== "object") throw new Error(t`Invalid resume JSON.`);
	const json = JSON.stringify(value);
	if (!("sections" in value) && !("metadata" in value)) return parseJSONResume(json);
	const metadata = "metadata" in value ? value.metadata : null;
	return metadata && typeof metadata === "object" && "layout" in metadata && Array.isArray(metadata.layout)
		? parseReactiveResumeV4JSON(json)
		: parseReactiveResumeJSON(json);
}
export async function readImportFile(file: DocumentPickerAsset, options: ImportOptions): Promise<ImportPreview> {
	const scope = activeDataScope();
	const { signal, onStep } = options;
	const check = () => {
		signal.throwIfAborted();
		assertDataScope(scope);
	};
	try {
		check();
		onStep?.("reading");
		const source = new File(file.uri);
		if (Math.max(source.size, file.size ?? 0) > 10 * 1024 * 1024) throw new DocumentImportError("too-large", file);
		const extension = file.name.toLowerCase().split(".").at(-1);
		let data: ResumeData;
		let compared = false;
		let partial = false;
		let lines: string[] | undefined;
		let aiOperationIds: string[] = [];
		if (extension === "json" || file.mimeType === "application/json") {
			const value: unknown = JSON.parse(await source.text());
			check();
			if (isQueueBundle(value)) {
				onStep?.("review");
				return { kind: "backup", scope, file, bundle: value };
			}
			onStep?.("parsing");
			data = parseResumeFileJSON(value);
		} else if (extension === "pdf" || extension === "docx") {
			if (options.ai || extension === "docx") {
				if (!options.connection || !(await ensureApproved("file", options.connection)))
					throw new DocumentImportError("consent", file);
				check();
				const encoded = await source.base64();
				check();
				onStep?.("parsing");
				if (isFake()) data = (await dataClient.resume.getById({ id: "resume-product" })).data;
				else {
					const input = {
						aiProviderId: options.connection.id,
						file: { name: file.name, data: encoded },
						includeProvenance: true,
					};
					const result =
						extension === "docx"
							? await client.ai.parseDocx(
									{ ...input, mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
									{ signal, context: { scope } },
								)
							: await client.ai.parsePdf(input, { signal, context: { scope } });
					data = result;
					aiOperationIds = result.aiOperationIds ?? [];
				}
				if (extension === "docx") {
					lines = extractDocxText(await source.bytes()).split("\n");
					compared = true;
				}
			} else if (isFake()) {
				onStep?.("parsing");
				data = (await dataClient.resume.getById({ id: "resume-product" })).data;
			} else {
				onStep?.("parsing");
				const body = new FormData();
				body.append("file", source);
				const response = await rest("/resumes/file-previews", { method: "POST", body, signal }, scope);
				check();
				if (!response.ok) throw new DocumentImportError("server", file);
				const preview = pdfImportPreviewSchema.parse(await response.json());
				if (!preview.data || preview.source.partial) throw new DocumentImportError("unreadable", file);
				data = withLinkTargets(preview.data, preview.source.links);
				lines = preview.source.lines;
				compared = true;
				partial = preview.source.partial;
			}
		} else throw new DocumentImportError("unsupported", file);
		check();
		onStep?.("review");
		return {
			kind: "resume",
			file,
			scope,
			data,
			summary: reviewImport(data, lines),
			language: data.metadata.page.locale,
			compared,
			partial,
			aiOperationIds,
		};
	} catch (cause) {
		if (cause instanceof DocumentImportError) throw cause;
		throw new DocumentImportError(signal.aborted ? "canceled" : "invalid", file, { cause });
	}
}
export async function createImportedResume(
	preview: ImportPreview,
	options: ImportOptions & { keepLeftovers?: boolean },
) {
	assertDataScope(preview.scope);
	options.signal.throwIfAborted();
	if (preview.kind === "backup") {
		options.onStep?.("restoring");
		await restoreQueued(preview.bundle);
		options.onStep?.("complete");
		return { type: "backup" as const };
	}
	options.onStep?.("creating");
	const data = options.keepLeftovers
		? withLeftoverSection(preview.data, preview.summary.notImported, t`More from your file`)
		: preview.data;
	const id = await dataClient.resume.import(
		{ data, aiOperationIds: preview.aiOperationIds },
		{ signal: options.signal, context: { scope: preview.scope } },
	);
	assertDataScope(preview.scope);
	options.onStep?.("complete");
	return { type: "resume" as const, id };
}
export function useDocumentImport() {
	const [file, setFile] = useState<DocumentPickerAsset>();
	const [step, setStep] = useState<ImportStep>();
	const [preview, setPreview] = useState<ImportPreview>();
	const [error, setError] = useState<unknown>();
	const controller = useRef<AbortController | undefined>(undefined);
	useEffect(() => () => controller.current?.abort(), []);
	return {
		file,
		step,
		preview,
		error,
		cancel: () => controller.current?.abort(),
		async read(asset: DocumentPickerAsset, options: Omit<ImportOptions, "signal" | "onStep"> = {}) {
			controller.current?.abort();
			const current = new AbortController();
			controller.current = current;
			setFile(asset);
			setPreview(undefined);
			setError(undefined);
			try {
				const result = await readImportFile(asset, {
					...options,
					signal: current.signal,
					onStep: (value) => {
						if (controller.current === current) setStep(value);
					},
				});
				if (controller.current === current) setPreview(result);
				return result;
			} catch (failure) {
				if (controller.current === current) setError(failure);
				throw failure;
			}
		},
		async create(keepLeftovers = true) {
			if (!preview) throw new Error(t`Review your file first.`);
			const current = new AbortController();
			controller.current = current;
			try {
				return await createImportedResume(preview, { keepLeftovers, signal: current.signal, onStep: setStep });
			} catch (failure) {
				setError(failure);
				throw failure;
			}
		},
	};
}
