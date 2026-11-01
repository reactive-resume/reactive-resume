import type { DbOrTx } from "@reactive-resume/db/client";
import type { ApplicationPacket, PacketSelection } from "@reactive-resume/schema/applications/autofill";
import { createHash, createHmac } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@reactive-resume/db/client";
import * as tables from "@reactive-resume/db/schema";
import { env } from "@reactive-resume/env/server";
import { getResumeExportData } from "@reactive-resume/resume/export-sections";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { packetReviewSchema } from "@reactive-resume/schema/applications/autofill";
import { consumePdfExportLimit } from "../../middleware/rate-limit";
import { applicationProfileService } from "../application-profile/service";
import { reviewedAnswers } from "../career/answers";
import { coverLetterService } from "../cover-letters/service";
import { writeLetterVersion } from "../cover-letters/versions";
import { fileResponse, letterExportData } from "../documents/exports";
import { lockUser } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { writeVersion } from "../resume/version-history";
import { htmlToText } from "../web-access/builtin";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
// Unselected private fields invalidate approval without exposing guessable hashes of their values.
const revision = (value: unknown) => createHmac("sha256", env.AUTH_SECRET).update(JSON.stringify(value)).digest("hex");
const changed = () =>
	new ORPCError("CONFLICT", {
		message: "Application, profile, documents or answer evidence changed. Reload and review the packet again.",
	});

/** Caller holds the existing owner mutex. Reads stay on its connection, including live letter links/evidence. */
async function snapshot(tx: DbOrTx, userId: string, selection: PacketSelection) {
	const [application] = await tx
		.select()
		.from(tables.application)
		.where(and(eq(tables.application.id, selection.applicationId), eq(tables.application.userId, userId)));
	if (!application) throw new ORPCError("NOT_FOUND");
	if (!application.resumeId)
		throw new ORPCError("BAD_REQUEST", { message: "Select a resume for this application first." });
	const [activeResume] = await tx
		.select({ id: tables.resume.id })
		.from(tables.resume)
		.where(
			and(
				eq(tables.resume.id, application.resumeId),
				eq(tables.resume.userId, userId),
				isNull(tables.resume.trashedAt),
			),
		)
		.for("share");
	if (!activeResume)
		throw new ORPCError("NOT_FOUND", {
			message: "Selected resume unavailable. Restore it or explicitly select another resume.",
		});
	const resume = await resumeService.getById({ id: application.resumeId, userId }, tx);
	let letter = null;
	if (application.coverLetterId) {
		const [activeLetter] = await tx
			.select({
				id: tables.coverLetter.id,
				sourceResumeId: tables.coverLetter.sourceResumeId,
				senderLinked: tables.coverLetter.senderLinked,
				designLinked: tables.coverLetter.designLinked,
			})
			.from(tables.coverLetter)
			.where(
				and(
					eq(tables.coverLetter.id, application.coverLetterId),
					eq(tables.coverLetter.userId, userId),
					isNull(tables.coverLetter.trashedAt),
				),
			)
			.for("share");
		if (!activeLetter)
			throw new ORPCError("NOT_FOUND", {
				message: "Selected letter unavailable. Restore it or explicitly change the selection.",
			});
		if (activeLetter.sourceResumeId && (activeLetter.senderLinked || activeLetter.designLinked)) {
			const [source] = await tx
				.select({ id: tables.resume.id })
				.from(tables.resume)
				.where(
					and(
						eq(tables.resume.id, activeLetter.sourceResumeId),
						eq(tables.resume.userId, userId),
						isNull(tables.resume.trashedAt),
					),
				)
				.for("share");
			if (!source)
				throw new ORPCError("NOT_FOUND", {
					message:
						"The letter's linked sender/design resume is unavailable. Restore it or unlink it explicitly before reviewing.",
				});
		}
		letter = await coverLetterService.getById({ id: application.coverLetterId, userId }, tx);
		if (!selection.letterWords || selection.letterWords.locale !== letter.style.metadata.page.locale)
			throw new ORPCError("CONFLICT", {
				message: "Reload the letter's document-language wording before reviewing this packet.",
			});
	}
	const profile = selection.includeContact ? await applicationProfileService.get(userId, tx) : null;
	if (selection.includeContact && !profile)
		throw new ORPCError("BAD_REQUEST", {
			message: "Save and review your private application profile first, or omit contact details.",
		});
	const available = selection.answerIds.length ? await reviewedAnswers.list(userId, application.id, tx) : [];
	const answers = selection.answerIds.map((id) => {
		const row = available.find((answer) => answer.id === id);
		if (!row) throw new ORPCError("NOT_FOUND", { message: "Selected saved answer unavailable." });
		if (!row.canReuse)
			throw new ORPCError("CONFLICT", {
				message: "A selected answer is outside this scope or its evidence needs review.",
			});
		return row;
	});
	const fingerprint = revision([userId, selection, application, profile, resume, letter, answers]);
	const experience = resume.data.sections.experience;
	const showExperience =
		!experience.hidden &&
		resume.data.metadata.layout.pages.some((page) => [...page.main, ...page.sidebar].includes("experience"));
	const review = packetReviewSchema.parse({
		selection,
		fingerprint,
		application: { id: application.id, company: application.company, role: application.role },
		contact: profile
			? {
					givenName: profile.data.givenName,
					familyName: profile.data.familyName,
					email: profile.data.email,
					phone: profile.data.phone,
				}
			: null,
		profileRevision: profile?.revision ?? null,
		profileReviewedAt: profile?.reviewedAt ?? null,
		experience: !showExperience
			? ""
			: experience.items
					.filter((item) => !item.hidden && item.company.trim())
					.map((item) =>
						[
							item.company,
							item.position,
							item.period,
							htmlToText(item.description),
							...item.roles.map((role) =>
								[role.position, role.period, htmlToText(role.description)].filter(Boolean).join(" — "),
							),
						]
							.filter(Boolean)
							.join(" — "),
					)
					.join("\n\n")
					.slice(0, 30000),
		letterText: letter ? buildMarkdown(letterExportData(letter, selection.letterWords ?? undefined)) : "",
		answers: answers.map((row) => ({
			id: row.id,
			revision: row.revision,
			question: row.question,
			answer: row.answer,
			source: row.source,
			scope: row.scope,
			reviewedAt: row.reviewedAt.toISOString(),
		})),
		documents: [
			{
				kind: "resume",
				id: resume.id,
				name: resume.name,
				revision: revision([resume.name, resume.data, resume.updatedAt]),
			},
			...(letter ? [{ kind: "letter", id: letter.id, name: letter.name, revision: revision(letter) }] : []),
		],
	});
	return { review, resume, letter };
}

function read(userId: string, selection: PacketSelection) {
	return db.transaction(async (tx) => {
		await lockUser(tx, userId);
		return snapshot(tx, userId, selection);
	});
}

export const applicationPackets = {
	review: async (userId: string, selection: PacketSelection) => (await read(userId, selection)).review,
	export: async (
		userId: string,
		input: { selection: PacketSelection; fingerprint: string; reviewed: true },
		resHeaders?: Headers,
	): Promise<ApplicationPacket> => {
		const captured = await read(userId, input.selection);
		if (captured.review.fingerprint !== input.fingerprint) throw changed();
		for (const document of captured.review.documents)
			await consumePdfExportLimit({ id: document.id, userId, ...(resHeaders ? { resHeaders } : {}) });
		const resumeFile = (
			await fileResponse(getResumeExportData(captured.resume.data, "resume"), captured.resume.name, "pdf", null)
		).body;
		const letterFile = captured.letter
			? (
					await fileResponse(
						letterExportData(captured.letter, input.selection.letterWords ?? undefined),
						captured.letter.name,
						"pdf",
						null,
						true,
						"cover-letter",
					)
				).body
			: null;
		if (resumeFile.size + (letterFile?.size ?? 0) > 2 * 1024 * 1024)
			throw new ORPCError("BAD_REQUEST", {
				message: "These PDFs exceed the 2 MiB packet limit. Download and attach the documents manually instead.",
			});
		const resumeBytes = new Uint8Array(await resumeFile.arrayBuffer());
		const letterBytes = letterFile ? new Uint8Array(await letterFile.arrayBuffer()) : null;
		return db.transaction(async (tx) => {
			await lockUser(tx, userId);
			const current = await snapshot(tx, userId, input.selection);
			if (current.review.fingerprint !== input.fingerprint) throw changed();
			const resumeVersion = await writeVersion(tx, {
				userId,
				resumeId: captured.resume.id,
				data: captured.resume.data,
				kind: "named",
				name: `Autofill packet — ${captured.review.application.company}`,
			});
			const documents: ApplicationPacket["documents"] = [
				{
					kind: "resume",
					id: captured.resume.id,
					versionId: resumeVersion.id,
					name: captured.resume.name,
					filename: `resume-${resumeVersion.id}.pdf`,
					sha256: digest(resumeBytes),
					base64: Buffer.from(resumeBytes).toString("base64"),
				},
			];
			if (captured.letter && letterBytes) {
				const version = await writeLetterVersion(tx, {
					userId,
					letter: captured.letter,
					kind: "named",
					name: `Autofill packet — ${captured.review.application.company}`,
				});
				documents.push({
					kind: "letter",
					id: captured.letter.id,
					versionId: version.id,
					name: captured.letter.name,
					filename: `letter-${version.id}.pdf`,
					sha256: digest(letterBytes),
					base64: Buffer.from(letterBytes).toString("base64"),
				});
			}
			return {
				format: "reactive-resume-application-packet",
				version: 1,
				approvedAt: new Date().toISOString(),
				review: captured.review,
				documents,
			};
		});
	},
};
