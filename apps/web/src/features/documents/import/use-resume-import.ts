import type { ImportKind } from "@/features/resume/import/read-file";
import type { ImportReview } from "@reactive-resume/import/review";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Locale } from "@reactive-resume/utils/locale";
import { plural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { reviewImport, withLeftoverSection, withLinkTargets } from "@reactive-resume/import/review";
import { toast } from "@reactive-resume/ui/components/toast";
import { localeSchema } from "@reactive-resume/utils/locale";
import { useNewDocumentsStore } from "../new-documents";
import {
	detectImportKind,
	ImportError,
	readImportSource,
	readResumeFile,
	summarizeImport,
} from "@/features/resume/import/read-file";
import { useHasUsableAiProvider } from "@/features/settings/integrations/hooks/use-has-usable-ai-provider";
import { getAccountGeneration, getAccountId } from "@/libs/auth/account-scope";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

export type ImportStep =
	| { name: "idle" }
	/** A file that arrived with the page (dropped on Documents): nothing is read until it's confirmed. */
	| { name: "ready"; file: File }
	| { name: "choice"; file: File; kind: "pdf" | "docx" }
	| { name: "importing"; file: File; stage: number; notes: string[] }
	| {
			name: "review";
			file: File;
			kind: "pdf" | "docx";
			/** Where the file was read: in this browser, or by the account's AI connection. */
			readWith: "device" | "ai";
			data: ResumeData;
			aiOperationIds: string[];
			owner: { accountId: string; generation: number };
			review: ImportReview;
			/** How much of the file's own text the import was compared with. */
			comparison: "full" | "partial" | "none";
	  }
	| { name: "imported"; file: File; resumeId: string; sections: number; entries: number; flagged: number }
	| { name: "failed"; file: File; message: string };

export type ImportReviewStep = Extract<ImportStep, { name: "review" }>;

function requireImportKind(kind: ImportKind | null, file: File): ImportKind {
	if (!kind) {
		// JSON is a supported type: say what's wrong with this JSON, not that the type is.
		if (file.name.toLowerCase().endsWith(".json"))
			throw new ImportError(t`This JSON isn't a Reactive Resume or JSON Resume file.`);
		throw new ImportError(
			t`This file type can't be imported. Use a PDF, Word, Reactive Resume or JSON Resume file, or a LinkedIn export (.zip).`,
		);
	}
	return kind;
}

type ResumeImportOptions = {
	/** A file handed over by another page; the import opens on it, unread. */
	initialFile?: File | undefined;
	/** A cover letter file comes in as a letter and opens at once. */
	openLetter: (coverLetterId: string) => void;
	/** The imported resume is linked to this application. */
	applicationId?: string | undefined;
	/** The resume language chosen on the page; the interface language (or the file's own) when left alone. */
	locale?: Locale | undefined;
};

/** Runs an import and reports each stage as a step; a newer run or a cancel drops the older one's updates. */
export function useResumeImport({ initialFile, openLetter, applicationId, locale }: ResumeImportOptions) {
	const { i18n } = useLingui();
	const queryClient = useQueryClient();
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const providerState = useHasUsableAiProvider();
	const { hasUsableProvider } = providerState;
	const [step, setStep] = useState<ImportStep>(() =>
		initialFile ? { name: "ready", file: initialFile } : { name: "idle" },
	);
	const run = useRef(0);
	const account = useRef({ id: getAccountId(), generation: getAccountGeneration() });
	const controller = useRef<AbortController | null>(null);
	useEffect(
		() => () => {
			run.current++;
			controller.current?.abort();
		},
		[],
	);
	const refreshDocuments = () => queryClient.invalidateQueries({ queryKey: orpc.documents.key() });

	const importFile = async (file: File, mode?: "local" | "ai") => {
		const accountId = getAccountId();
		if (!accountId || account.current.id !== accountId || account.current.generation !== getAccountGeneration()) return;
		const owner = { accountId, generation: getAccountGeneration() };
		controller.current?.abort();
		controller.current = new AbortController();
		const signal = controller.current.signal;
		const attempt = ++run.current;
		const current = () =>
			run.current === attempt &&
			!signal.aborted &&
			getAccountId() === owner.accountId &&
			getAccountGeneration() === owner.generation;
		const advance = (stage: number, note: string) => {
			const index = stage - 1;
			setStep((previous) =>
				previous.name === "importing" && current()
					? { ...previous, stage, notes: Object.assign([...previous.notes], { [index]: note }) }
					: previous,
			);
		};

		setStep({ name: "importing", file, stage: 0, notes: [] });
		try {
			const kind = requireImportKind(await detectImportKind(file), file);
			if (!current()) return;
			let chosen = mode;
			if ((kind === "pdf" || kind === "docx") && !chosen) {
				// With no connection there is nothing to choose for a PDF: it is read on this device.
				if (kind === "pdf" && !providerState.isUnavailable && !hasUsableProvider) chosen = "local";
				else {
					setStep({ name: "choice", file, kind });
					return;
				}
			}

			if (kind === "cover-letter-json") {
				const document = JSON.parse(await file.text());
				if (!current()) return;
				const letter = await client.coverLetters.import({ document }, { signal, context: { accountId } });
				if (!current()) return;
				markNew(letter.id);
				void refreshDocuments();
				toast.add({ description: t`Cover letter imported` });
				openLetter(letter.id);
				return;
			}

			let aiAvailable = chosen === "ai" && hasUsableProvider;
			if (chosen === "ai" && (kind === "docx" || kind === "pdf") && providerState.isUnavailable) {
				try {
					const providers = await queryClient.fetchQuery({ ...orpc.aiProviders.list.queryOptions(), staleTime: 0 });
					aiAvailable = providers.some((provider) => provider.enabled && provider.testStatus === "success");
				} catch {
					// PDFs have a browser-only reader; a connection outage must not block that local path.
					if (kind !== "pdf")
						throw new ImportError(t`Couldn't load AI connections. Try again before importing this file.`);
					aiAvailable = false;
				}
			}
			if (!current()) return;
			let aiOperationIds: string[] = [];
			const resume = await readResumeFile(file, kind, {
				aiAvailable,
				signal,
				accountId,
				onProvenance: (ids) => {
					aiOperationIds = ids;
				},
				onRead: (note) => advance(1, note),
			});
			if (!current()) return;
			// A PDF or Word file is read by a model or a heuristic: the user sees what came in, and what didn't,
			// before anything is created. Structured files (JSON, LinkedIn) come in as they are.
			if (kind === "pdf" || kind === "docx") {
				advance(1, t`file read`);
				const source = await readImportSource(file, kind);
				if (!current()) return;
				const data = source ? withLinkTargets(resume, source.links) : resume;
				setStep({
					name: "review",
					file,
					kind,
					readWith: aiAvailable ? "ai" : "device",
					data,
					aiOperationIds,
					owner,
					review: reviewImport(data, source?.lines),
					comparison: !source?.lines.length ? "none" : source.partial ? "partial" : "full",
				});
				return;
			}
			await create(file, resume, owner, aiOperationIds, kind === "reactive-resume-json", attempt);
		} catch (error) {
			if (current()) fail(file, error);
		}
	};

	const fail = (file: File, error: unknown) => {
		const message =
			error instanceof ImportError
				? error.message
				: getOrpcErrorMessage(error, {
						byCode: {
							BAD_GATEWAY: t`Couldn't reach the AI provider. Try again in a moment.`,
						},
						// The server says why a file couldn't be read ("The AI returned resume data in the wrong format…").
						allowServerMessage: true,
						fallback: t`The file couldn't be read as a resume.`,
					});
		setStep({ name: "failed", file, message });
	};

	const create = async (
		file: File,
		resume: ResumeData,
		owner: { accountId: string; generation: number },
		aiOperationIds: string[],
		preserveLocale = false,
		attempt = ++run.current,
	) => {
		const signal = controller.current?.signal;
		const current = () =>
			run.current === attempt &&
			!signal?.aborted &&
			getAccountId() === owner.accountId &&
			getAccountGeneration() === owner.generation;
		if (!current()) return;
		const options = { ...(signal ? { signal } : {}), context: { accountId: owner.accountId } };
		const selectedLocale = locale ?? (preserveLocale ? resume.metadata.page.locale : localeSchema.parse(i18n.locale));
		const data = {
			...resume,
			metadata: { ...resume.metadata, page: { ...resume.metadata.page, locale: selectedLocale } },
		};
		const summary = summarizeImport(data);
		setStep({
			name: "importing",
			file,
			stage: 2,
			notes: [t`file read`, plural(summary.sections, { one: "# section", other: "# sections" })],
		});
		try {
			const resumeId = await client.resume.import({ data, aiOperationIds }, options);
			if (!current()) return;
			if (applicationId)
				await client.documents.linkApplication({ type: "resume", id: resumeId, applicationId }, options);
			if (!current()) return;
			markNew(resumeId);
			void refreshDocuments();
			setStep({ name: "imported", file, resumeId, ...summary });
		} catch (error) {
			if (current()) fail(file, error);
		}
	};

	/** Creates the reviewed resume, with what the reader couldn't place kept as a section when the user chose to. */
	const confirm = (review: ImportReviewStep, keepLeftovers: boolean) =>
		create(
			review.file,
			keepLeftovers ? withLeftoverSection(review.data, review.review.notImported, t`More from your file`) : review.data,
			review.owner,
			review.aiOperationIds,
		);

	const cancel = () => {
		run.current++;
		controller.current?.abort();
		setStep({ name: "idle" });
	};

	return { step, importFile, confirm, cancel, providerState };
}
