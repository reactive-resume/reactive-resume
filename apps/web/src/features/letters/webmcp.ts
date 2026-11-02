import type { LetterEdits } from "./store";
import type { WebMcpTool } from "@/libs/webmcp";
import { t } from "@lingui/core/macro";
import { useMemo } from "react";
import z from "zod";
import { toast } from "@reactive-resume/ui/components/toast";
import { useLetterEditorStore } from "./store";
import { defineWebMcpTool, useWebMcpTools } from "@/libs/webmcp";

const letterFieldsSchema = z.strictObject({
	name: z.string().trim().min(1).max(100).optional().describe("The letter's name in the document library."),
	content: z
		.string()
		.max(100_000)
		.optional()
		.describe("The body as HTML (<p>, <ul><li>, <strong>, <a>). Structured letters add the greeting and sign-off."),
	recipient: z
		.string()
		.max(20_000)
		.optional()
		.describe("Freeform letters only: the recipient block as HTML. Structured letters use the fields below."),
	recipientName: z
		.string()
		.trim()
		.max(200)
		.optional()
		.describe('Structured letters: who it\'s to, a person or a team. The greeting follows it ("Dear Dana,").'),
	recipientCompany: z.string().trim().max(200).optional().describe("Structured letters: the recipient's company."),
	letterDate: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
		.nullable()
		.optional()
		.describe("Structured letters: the letter's date as YYYY-MM-DD, or null for none."),
	greeting: z
		.string()
		.trim()
		.max(2_000)
		.nullable()
		.optional()
		.describe("Structured letters: a custom greeting; null restores the default, empty leaves it out."),
	signOff: z
		.string()
		.trim()
		.max(2_000)
		.nullable()
		.optional()
		.describe(
			"Structured letters: a custom sign-off with the name and any contact details; null restores the default, empty leaves it out.",
		),
});

const FREEFORM_FIELDS = ["recipient"] as const;
const STRUCTURED_FIELDS = ["recipientName", "recipientCompany", "letterDate", "greeting", "signOff"] as const;

/** The letter this editor has open, as on screen: with edits that haven't reached the server yet. */
function getOpenLetter(coverLetterId: string) {
	const letter = useLetterEditorStore.getState().letter;
	if (letter?.id !== coverLetterId) throw new Error("The cover letter is no longer open in the editor.");
	return letter;
}

function createLetterTools(coverLetterId: string): readonly WebMcpTool[] {
	const readCoverLetter = defineWebMcpTool({
		name: "read_cover_letter",
		title: "Read cover letter",
		description: [
			"Get the cover letter open in this editor, exactly as on screen (including edits not saved yet).",
			"`layout` is structured (recipient name, company, date, greeting, body, sign-off) or freeform (a recipient",
			"block and the body as written). The body and recipient block are HTML. A null greeting or sign-off uses the",
			"document language default.",
		].join(" "),
		input: z.object({}),
		annotations: { readOnlyHint: true, untrustedContentHint: true },
		execute: () => {
			const letter = getOpenLetter(coverLetterId);
			return {
				id: letter.id,
				name: letter.name,
				layout: letter.layout,
				isLocked: letter.isLocked,
				recipient: letter.recipient,
				recipientName: letter.recipientName,
				recipientCompany: letter.recipientCompany,
				letterDate: letter.letterDate,
				greeting: letter.greeting,
				content: letter.content,
				signOff: letter.signOff,
				sourceResumeId: letter.sourceResumeId,
				sourceApplicationId: letter.sourceApplicationId,
			};
		},
	});

	const updateCoverLetter = defineWebMcpTool({
		name: "update_cover_letter",
		title: "Edit cover letter",
		description: [
			"Change fields of the cover letter open in this editor. Fields left out keep their values; each field given",
			"replaces the whole field. The page updates at once and the change is saved before this returns.",
			"Read the letter first with read_cover_letter. Locked letters can't be edited: ask the user to unlock it.",
		].join(" "),
		input: letterFieldsSchema,
		execute: async (fields) => {
			const letter = getOpenLetter(coverLetterId);
			if (letter.isLocked) throw new Error("This cover letter is locked. Ask the user to unlock it before editing.");

			const edits = Object.fromEntries(
				Object.entries(fields).filter(([, value]) => value !== undefined),
			) as LetterEdits;
			if (Object.keys(edits).length === 0) throw new Error("Give at least one field to change.");
			// A field the layout doesn't show would be stored where nobody sees it, so refuse it instead.
			const hidden = (letter.layout === "structured" ? FREEFORM_FIELDS : STRUCTURED_FIELDS).filter(
				(field) => field in edits,
			);
			if (hidden.length > 0)
				throw new Error(
					letter.layout === "structured"
						? "This letter is structured: use recipientName and recipientCompany instead of recipient."
						: `This letter is freeform: put the recipient in recipient, and leave out ${hidden.join(", ")}.`,
				);

			const store = useLetterEditorStore.getState();
			store.edit(edits);
			toast.add({ id: "webmcp-letter-edit", description: t`Your browser's AI agent edited this letter.` });

			if (await store.flush()) return "Changed and saved.";
			if (useLetterEditorStore.getState().status === "conflict")
				return "Changed on the page, but not saved: the letter was changed somewhere else. Ask the user to reload it.";
			return "Changed on the page, but saving failed. The editor keeps the change and the user can retry.";
		},
	});

	return [readCoverLetter, updateCoverLetter];
}

/** Offers the open cover letter to the browser's AI agent while the letter editor is mounted. */
export function useLetterWebMcpTools(coverLetterId: string) {
	const tools = useMemo(() => createLetterTools(coverLetterId), [coverLetterId]);
	useWebMcpTools(tools);
}
