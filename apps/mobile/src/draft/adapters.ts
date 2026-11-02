import type { DraftAdapter } from "./store";
import type { LetterDocument, ResumeDocument } from "./types";
import type { RouterInput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { ORPCError } from "@orpc/client";
import { produce } from "immer";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { syncResumeDates } from "@reactive-resume/schema/resume/dates";
import { client } from "@/api/client";

function dates(value: unknown) {
	if (!value || typeof value !== "object") throw new Error("Invalid stored draft.");
	const document = value as { createdAt?: string; updatedAt?: string };
	return { ...value, createdAt: new Date(document.createdAt ?? ""), updatedAt: new Date(document.updatedAt ?? "") };
}

function resumeFields(document: ResumeDocument) {
	return {
		name: document.name,
		slug: document.slug,
		tags: document.tags,
		isPublic: document.isPublic,
		showDownloadButtons: document.showDownloadButtons,
		data: document.data,
	};
}

/** Only editable API fields; server-owned IDs, locks and revisions never travel through undo. */
function letterFields(document: LetterDocument) {
	return {
		name: document.name,
		recipient: document.recipient,
		content: document.content,
		greeting: document.greeting,
		signOff: document.signOff,
		recipientName: document.recipientName,
		recipientCompany: document.recipientCompany,
		letterDate: document.letterDate,
		sourceResumeId: document.sourceResumeId,
		sourceApplicationId: document.sourceApplicationId,
		senderLinked: document.senderLinked,
		designLinked: document.designLinked,
		style: document.style,
	};
}

function changedFields<T extends object>(current: T, baseline: T): Partial<T> {
	const changes: Partial<T> = {};
	for (const key of Object.keys(current) as (keyof T)[]) {
		if (JSON.stringify(current[key]) !== JSON.stringify(baseline[key])) changes[key] = current[key];
	}
	return changes;
}

export const resumeAdapter: DraftAdapter<ResumeDocument, ResumeDocument["data"]> = {
	kind: "resume",
	delay: 500,
	read: (id) => client.resume.getById({ id }),
	data: (document) => document.data,
	withData: (document, data) => ({
		...document,
		data: produce(data, (draft) => {
			syncResumeDates(draft);
		}),
	}),
	version: (document) => document.updatedAt.getTime(),
	matches: (left, right) => Object.keys(changedFields(resumeFields(left), resumeFields(right))).length === 0,
	merge: (saved, submitted, current) => ({
		...saved,
		...changedFields(resumeFields(current), resumeFields(submitted)),
		// Keep authored data and its references stable across the server's normalized echo.
		data: current.data,
	}),
	parse: (value) => {
		const document = dates(value) as ResumeDocument;
		if (
			typeof document.id !== "string" ||
			typeof document.name !== "string" ||
			typeof document.isLocked !== "boolean" ||
			typeof document.slug !== "string" ||
			!Array.isArray(document.tags) ||
			!document.tags.every((tag) => typeof tag === "string") ||
			typeof document.isPublic !== "boolean" ||
			typeof document.showDownloadButtons !== "boolean" ||
			!Number.isFinite(document.updatedAt.getTime())
		)
			throw new Error("Invalid stored resume.");
		return { ...document, data: resumeDataSchema.parse(document.data) };
	},
	save: async (document, baseline, sessionId, force, scope, proposalApplications, proposalSafety) => ({
		...document,
		...(await client.resume.update(
			{
				id: document.id,
				...changedFields(resumeFields(document), resumeFields(baseline)),
				sessionId,
				// Only for drafts this app kept (see the draft store's proposalSafety).
				...(proposalSafety ? { proposalSafety } : {}),
				...(proposalApplications && Object.keys(proposalApplications).length
					? { proposalApplications: { ...proposalApplications } }
					: {}),
				...(!force ? { expectedUpdatedAt: baseline.updatedAt } : {}),
			},
			{ context: { scope } },
		)),
	}),
	copy: async (document, copyId, remember, scope) => {
		const name = t`${document.name} (mine)`.slice(0, 100);
		const id = copyId ?? (await client.resume.import({ data: document.data }, { context: { scope } }));
		remember(id);
		await client.resume.update({ id, name, tags: document.tags, data: document.data }, { context: { scope } });
	},
	isConflict: (error) => error instanceof ORPCError && error.code === "RESUME_VERSION_CONFLICT",
};

export const letterAdapter: DraftAdapter<LetterDocument, LetterDocument> = {
	kind: "letter",
	delay: 800,
	read: (id) => client.coverLetters.getById({ id }),
	data: (document) => document,
	withData: (document, data) => ({ ...document, ...letterFields(data) }),
	version: (document) => document.revision,
	matches: (left, right) => Object.keys(changedFields(letterFields(left), letterFields(right))).length === 0,
	merge: (saved, submitted, current) => ({
		...saved,
		...changedFields(letterFields(current), letterFields(submitted)),
		// Unlinking resolves fresh resume details; retain only fields edited while that request was pending.
		style: {
			...saved.style,
			basics: { ...saved.style.basics, ...changedFields(current.style.basics, submitted.style.basics) },
			picture: { ...saved.style.picture, ...changedFields(current.style.picture, submitted.style.picture) },
			metadata: { ...saved.style.metadata, ...changedFields(current.style.metadata, submitted.style.metadata) },
		},
	}),
	parse: (value) => coverLetterSchema.parse(dates(value)),
	save: (document, baseline, sessionId, _force, scope, proposalApplications, proposalSafety) => {
		const changes = changedFields(letterFields(document), letterFields(baseline));
		const input: RouterInput["coverLetters"]["update"] = {
			id: document.id,
			expectedRevision: baseline.revision,
			sessionId,
			...(proposalSafety ? { proposalSafety } : {}),
			...(proposalApplications && Object.keys(proposalApplications).length
				? { proposalApplications: { ...proposalApplications } }
				: {}),
			...("name" in changes ? { name: document.name } : {}),
			...("recipient" in changes ? { recipient: document.recipient } : {}),
			...("content" in changes ? { content: document.content } : {}),
			...("greeting" in changes ? { greeting: document.greeting } : {}),
			...("signOff" in changes ? { signOff: document.signOff } : {}),
			...("recipientName" in changes ? { recipientName: document.recipientName } : {}),
			...("recipientCompany" in changes ? { recipientCompany: document.recipientCompany } : {}),
			...("letterDate" in changes ? { letterDate: document.letterDate } : {}),
			...("sourceResumeId" in changes ? { resumeId: document.sourceResumeId } : {}),
			...("sourceApplicationId" in changes ? { applicationId: document.sourceApplicationId } : {}),
			...("senderLinked" in changes ? { senderLinked: document.senderLinked } : {}),
			...("designLinked" in changes ? { designLinked: document.designLinked } : {}),
		};
		if (!document.senderLinked) {
			const sender: NonNullable<typeof input.sender> = changedFields(document.style.basics, baseline.style.basics);
			if (document.style.picture.hidden !== baseline.style.picture.hidden)
				sender.picture = { hidden: document.style.picture.hidden };
			if (Object.keys(sender).length) input.sender = sender;
		}
		const metadata = changedFields(document.style.metadata, baseline.style.metadata);
		if ("template" in metadata) input.template = document.style.metadata.template;
		// Language is the letter's own: send it alone so a shared design stays linked, as web's Design does.
		const page = document.style.metadata.page;
		const previousPage = baseline.style.metadata.page;
		const localeChanged = Boolean(page && previousPage && page.locale !== previousPage.locale);
		const otherPageChanged =
			Boolean(page && previousPage) &&
			(page.format !== previousPage.format ||
				page.marginX !== previousPage.marginX ||
				page.marginY !== previousPage.marginY ||
				page.hideIcons !== previousPage.hideIcons ||
				page.gapX !== previousPage.gapX ||
				page.gapY !== previousPage.gapY);
		if (localeChanged && page) input.locale = page.locale;
		if ("typography" in metadata || "design" in metadata || otherPageChanged)
			input.metadata = {
				...("typography" in metadata ? { typography: document.style.metadata.typography } : {}),
				...("design" in metadata ? { design: document.style.metadata.design } : {}),
				...("page" in metadata && otherPageChanged ? { page } : {}),
			};
		return client.coverLetters.update(input, { context: { scope } });
	},
	copy: async (document, copyId, remember, scope) => {
		if (copyId) return;
		const copy = await client.coverLetters.import(
			{
				document: {
					format: "reactive-resume-cover-letter",
					version: 1,
					name: t`${document.name} (mine)`.slice(0, 100),
					recipient: document.recipient,
					content: document.content,
					greeting: document.greeting,
					signOff: document.signOff,
					style: document.style,
					layout: document.layout,
					recipientName: document.recipientName,
					recipientCompany: document.recipientCompany,
					letterDate: document.letterDate,
				},
			},
			{ context: { scope } },
		);
		remember(copy.id);
	},
	isConflict: (error) => error instanceof ORPCError && error.code === "CONFLICT",
};
