// Kept apart from ./new-document-dialog.tsx, so the library loads without the importers that dialog needs.
import type { Template } from "@reactive-resume/schema/templates";
import type { Locale } from "@reactive-resume/utils/locale";
import { t } from "@lingui/core/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "@reactive-resume/ui/components/toast";
import { useNewDocumentsStore } from "./new-documents";
import { useDialogStore } from "@/dialogs/store";
import { toastError } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

/** The files the importer reads: the New dialog's picker and first run's "Choose a file". */
export const IMPORT_ACCEPT = ".pdf,.docx,.json,.zip,application/pdf,application/json,application/zip";

// One create at a time across every caller: a click repeated, or a dialog reopened, while one is in flight does nothing.
let starting = false;

/** `base`, or `base 2`, `base 3`… whichever no name in `taken` uses. */
function freeName(base: string, taken: readonly string[]) {
	const names = new Set(taken.map((name) => name.toLowerCase()));
	let name = base;
	for (let number = 2; names.has(name.toLowerCase()); number++) name = `${base} ${number}`;
	return name;
}

/** Start blank, try a sample, or a new letter: each creates the document at once and opens it. */
export function useStartDocument(applicationId?: string, locale?: Locale) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const closeDialog = useDialogStore((state) => state.closeDialog);
	const markNew = useNewDocumentsStore((state) => state.markNew);
	const [creating, setCreating] = useState(false);
	const { mutateAsync: createResume } = useMutation(orpc.resume.create.mutationOptions());
	const { mutateAsync: createLetter } = useMutation(orpc.coverLetters.create.mutationOptions());

	const created = async (id: string, type: "resume" | "letter") => {
		// `create` links a new letter to its application in the same transaction; only resumes need this call.
		if (applicationId && type === "resume") await client.documents.linkApplication({ type, id, applicationId });
		markNew(id);
		void queryClient.invalidateQueries({ queryKey: orpc.documents.key() });
		if (applicationId) void queryClient.invalidateQueries({ queryKey: orpc.applications.key() });
		closeDialog();
	};
	/** Whether the document was created; a click while another create is in flight creates nothing. */
	const start = async (task: () => Promise<void>) => {
		if (starting) return false;
		starting = true;
		setCreating(true);
		try {
			await task();
			return true;
		} catch (error) {
			toastError(error, t`Couldn't create the document. Try again.`);
			return false;
		} finally {
			starting = false;
			setCreating(false);
		}
	};

	return {
		creating,
		/** A blank resume; with `template`, in that template (chosen in the gallery before signing up). */
		startBlank: (template?: Template) =>
			start(async () => {
				const resumeId = await createResume({
					name: t`Untitled resume`,
					tags: [],
					autoName: true,
					withSampleData: false,
					...(locale ? { locale } : {}),
					...(template ? { template } : {}),
				});
				await created(resumeId, "resume");
				void navigate({ to: "/builder/$resumeId", params: { resumeId } });
			}),
		trySample: () =>
			start(async () => {
				// Named as what it is, not a random slug, so it's never mistaken for the person's own resume.
				const resumes = await client.documents.list({ type: "resume", q: t`Sample resume` });
				const name = freeName(
					t`Sample resume`,
					resumes.map((resume) => resume.name),
				);
				const resumeId = await createResume({ name, tags: [], withSampleData: true, ...(locale ? { locale } : {}) });
				await created(resumeId, "resume");
				toast.add({ description: t`Sample resume added. Delete it anytime.` });
				void navigate({ to: "/builder/$resumeId", params: { resumeId } });
			}),
		newLetter: (resumeId: string | null = null, sourceLetterId: string | null = null) =>
			start(async () => {
				const base = t`Untitled letter`;
				const letters = await client.documents.list({ type: "letter", q: base });
				const input = {
					name: freeName(
						base,
						letters.map((letter) => letter.name),
					),
					recipient: "",
					content: "",
					...(resumeId ? { resumeId } : {}),
					// The application fills the recipient and links the letter in the create transaction.
					...(applicationId ? { applicationId } : {}),
					// The server copies the selected letter's body and keeps both letters' histories separate.
					...(sourceLetterId ? { sourceLetterId } : {}),
				};
				const letter = await createLetter(input);
				await created(letter.id, "letter");
				void navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: letter.id } });
			}),
	};
}
