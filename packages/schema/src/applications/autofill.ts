import type { FormFillPlan } from "@reactive-resume/utils/form-fill";
import z from "zod";

export const packetContactSchema = z.strictObject({
	givenName: z.string().max(200),
	familyName: z.string().max(200),
	email: z.string().max(320),
	phone: z.string().max(200),
});
export const packetTargetSchema = z
	.url()
	.max(2048)
	.refine((value) => {
		const url = new URL(value);
		return (
			!url.username &&
			!url.password &&
			!url.hash &&
			(url.protocol === "https:" ||
				(url.protocol === "http:" && ["localhost", "127.0.0.1", "10.0.2.2"].includes(url.hostname)))
		);
	}, "Use an HTTPS form URL without credentials or a fragment (HTTP loopback for testing).");
export const packetSelectionSchema = z.strictObject({
	applicationId: z.string().min(1),
	targetUrl: packetTargetSchema,
	includeContact: z.boolean(),
	answerIds: z
		.array(z.string().min(1))
		.max(20)
		.refine((ids) => new Set(ids).size === ids.length),
	letterWords: z
		.strictObject({
			locale: z.string().max(50),
			greeting: z.string().max(500),
			teamGreeting: z.string().max(500),
			hiringTeam: z.string().max(500),
			signOff: z.string().max(500),
		})
		.nullable()
		.default(null),
});
const answer = z.strictObject({
	id: z.string(),
	revision: z.number().int().positive(),
	question: z.string().max(2000),
	answer: z.string().max(6000),
	source: z.enum(["manual", "application", "ai-assisted"]),
	scope: z.enum(["application", "employer", "reusable"]),
	reviewedAt: z.iso.datetime(),
});
export const packetReviewSchema = z.strictObject({
	selection: packetSelectionSchema,
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	application: z.strictObject({ id: z.string(), company: z.string(), role: z.string() }),
	contact: packetContactSchema.nullable(),
	profileRevision: z.string().nullable(),
	profileReviewedAt: z.string().nullable(),
	experience: z.string().max(30000),
	letterText: z.string().max(130000),
	answers: z.array(answer).max(20),
	documents: z
		.array(
			z.strictObject({ kind: z.enum(["resume", "letter"]), id: z.string(), name: z.string(), revision: z.string() }),
		)
		.max(2),
});
export const applicationPacketSchema = z.strictObject({
	format: z.literal("reactive-resume-application-packet"),
	version: z.literal(1),
	approvedAt: z.iso.datetime(),
	review: packetReviewSchema,
	documents: z
		.array(
			z.strictObject({
				kind: z.enum(["resume", "letter"]),
				id: z.string(),
				versionId: z.string(),
				name: z.string(),
				filename: z.string().max(200),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
				base64: z
					.string()
					.max(3_000_000)
					.regex(/^[A-Za-z0-9+/]*={0,2}$/),
			}),
		)
		.max(2),
});
export const approvePacketSchema = z.strictObject({
	selection: packetSelectionSchema,
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
	reviewed: z.literal(true),
});
export type PacketSelection = z.infer<typeof packetSelectionSchema>;
export type PacketReview = z.infer<typeof packetReviewSchema>;
export type ApplicationPacket = z.infer<typeof applicationPacketSchema>;
export const formFillReportSchema = z.object({
	targetUrl: z.string().max(2048),
	results: z
		.array(
			z.object({
				field: z.string().max(2000),
				status: z.enum(["filled", "skipped", "manual", "error"]),
				source: z.string().max(3000),
				detail: z.string().max(2000),
			}),
		)
		.max(500),
	handoffs: z.array(z.string().max(2000)).max(10),
});

/** Conservative candidate adapters. Only their synthetic native-control subset has been measured. */
export function packetFillPlan(packet: ApplicationPacket): FormFillPlan | null {
	const url = new URL(packet.review.selection.targetUrl);
	const kind = /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/.test(url.hostname)
		? "greenhouse"
		: /^jobs\.(?:eu\.)?lever\.co$/.test(url.hostname)
			? "lever"
			: url.hostname === "jobs.ashbyhq.com"
				? "ashby"
				: ["127.0.0.1", "localhost", "10.0.2.2"].includes(url.hostname)
					? url.pathname.split("/").find((part) => ["greenhouse", "lever", "ashby"].includes(part))
					: null;
	if (!kind) return null;
	const review = packet.review;
	const contact = review.contact;
	const fields: FormFillPlan["fields"] = [];
	const source = `Reviewed profile ${review.profileRevision} (${review.profileReviewedAt})`;
	if (contact) {
		if (kind === "greenhouse")
			fields.push(
				{ selector: '#first_name,input[name="job_application[first_name]"]', value: contact.givenName, source },
				{ selector: '#last_name,input[name="job_application[last_name]"]', value: contact.familyName, source },
			);
		else
			fields.push({
				selector: kind === "lever" ? 'input[name="name"]' : 'input[name="_systemfield_name"]',
				value: `${contact.givenName} ${contact.familyName}`.trim(),
				source,
			});
		fields.push(
			{
				selector: kind === "ashby" ? 'input[name="_systemfield_email"]' : '#email,input[name="email"]',
				value: contact.email,
				source,
			},
			{
				selector: kind === "ashby" ? 'input[name="_systemfield_phone"]' : '#phone,input[name="phone"]',
				value: contact.phone,
				source,
			},
		);
	}
	fields.push({
		selector: 'textarea#experience,textarea[name="work_history"]',
		value: review.experience,
		source: `Resume ${packet.documents.find((document) => document.kind === "resume")?.versionId ?? "unavailable"}`,
	});
	for (const answer of review.answers)
		fields.push({
			question: answer.question,
			value: answer.answer,
			source: `${answer.source}; ${answer.scope}; answer ${answer.id} revision ${answer.revision}; reviewed ${answer.reviewedAt}`,
		});
	return {
		targetUrl: review.selection.targetUrl,
		fields,
		files: packet.documents.map((document) => ({
			selector:
				document.kind === "resume"
					? 'input[type="file"][name="resume"],input[type="file"]#resume'
					: 'input[type="file"][name="letter"],input[type="file"][name="cover_letter"],input[type="file"]#cover_letter',
			filename: document.filename,
			base64: document.base64,
			sha256: document.sha256,
			source: `${document.kind} ${document.id} version ${document.versionId}; SHA-256 ${document.sha256}`,
		})),
	};
}
