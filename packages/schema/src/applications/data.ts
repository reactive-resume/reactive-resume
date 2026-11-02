import z from "zod";
import { timezoneSchema } from "@reactive-resume/utils/timezone";

// Canonical workflow categories stay fixed; user-owned lanes map to these categories.
// `closed` is the terminal stage, with a reason; it replaced the old `rejected` stage and the `archived` flag.
export const APPLICATION_STATUSES = ["saved", "applied", "screening", "interview", "offer", "closed"] as const;

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);

export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;

/** How the bounded posting snapshot was obtained; retrieval time is not an origin freshness claim. */
export const postingSourceSchema = z.object({
	method: z.enum(["paste", "builtin", "firecrawl", "tavily", "exa"]),
	format: z.enum(["text", "markdown"]),
	requestedUrl: z.url({ protocol: /^https?$/ }).optional(),
	resolvedUrl: z.url({ protocol: /^https?$/ }).optional(),
	retrievedAt: z.iso.datetime({ offset: true }).optional(),
	providerFetchedAt: z.iso.datetime({ offset: true }).optional(),
	truncated: z.boolean(),
	completeness: z.enum(["unknown", "incomplete"]),
	/** The posting's language (BCP-47), from the page or its structured data; never guessed from the interface. */
	language: z.string().max(35).optional(),
	fallbackReason: z
		.enum([
			"unsafe-url",
			"unreachable",
			"not-a-page",
			"too-large",
			"auth",
			"quota",
			"malformed",
			"empty",
			"challenge",
			"timeout",
			"unavailable",
			"rate-limit",
		])
		.optional(),
});

export type PostingSource = z.infer<typeof postingSourceSchema>;

export const applicationClosedReasonSchema = z.enum([
	"accepted",
	"not-selected",
	"withdrew",
	"accepted-other",
	"no-response",
]);

export type ApplicationClosedReason = z.infer<typeof applicationClosedReasonSchema>;

// Ordered stage metadata shared by the API (validation) and the web board (columns/colors).
export const STAGES = [
	{ value: "saved", label: "Saved", color: "oklch(0.64 0.02 95)" },
	{ value: "applied", label: "Applied", color: "oklch(0.64 0.11 250)" },
	{ value: "screening", label: "Screening", color: "oklch(0.64 0.11 200)" },
	{ value: "interview", label: "Interview", color: "oklch(0.64 0.11 80)" },
	{ value: "offer", label: "Offer", color: "oklch(0.64 0.11 150)" },
	{ value: "closed", label: "Closed", color: "oklch(0.64 0.11 27)" },
] as const satisfies ReadonlyArray<{ value: ApplicationStatus; label: string; color: string }>;

export const contactSchema = z.object({
	name: z.string().trim().min(1),
	role: z.string().trim().default(""),
	// Free-form label shown as a pill: "Recruiter", "Referral", "Hiring Manager"…
	type: z.string().trim().default(""),
	email: z
		.string()
		.trim()
		.refine((value) => value === "" || z.email().safeParse(value).success, "Invalid email address.")
		.default(""),
	phone: z.string().trim().default(""),
});

export type Contact = z.infer<typeof contactSchema>;

const timelineBaseSchema = z.object({
	id: z.string().min(1),
	at: z.coerce.date(),
});

export const interviewKindSchema = z.enum(["screening", "technical", "behavioral", "onsite", "other"]);

export type InterviewKind = z.infer<typeof interviewKindSchema>;

// Colours are the design system's stage tokens (CSS custom properties), not a palette of their own.
export const INTERVIEW_KINDS = [
	{ value: "screening", label: "Screening", color: "var(--stage-screening)" },
	{ value: "technical", label: "Technical", color: "var(--stage-applied)" },
	{ value: "behavioral", label: "Behavioral", color: "var(--stage-interview)" },
	{ value: "onsite", label: "Onsite", color: "var(--stage-offer)" },
	{ value: "other", label: "Other", color: "var(--ink-3)" },
] as const satisfies ReadonlyArray<{ value: InterviewKind; label: string; color: string }>;

export const interviewParticipantSchema = z.object({
	name: z.string().trim().min(1).max(200),
	role: z.string().trim().max(200).default(""),
	profileUrl: z
		.url({ protocol: /^https$/ })
		.max(2048)
		.refine((value) => {
			try {
				const url = new URL(value);
				const host = url.hostname.toLowerCase().replace(/\.$/, "");
				// Public hostnames only; the web reader also validates DNS and redirects before fetching.
				return (
					!url.username &&
					!url.password &&
					host.includes(".") &&
					!/^[\d.]+$/.test(host) &&
					!host.includes(":") &&
					!/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) &&
					!host.endsWith(".home.arpa")
				);
			} catch {
				return false;
			}
		}, "Use a public HTTPS profile URL.")
		.optional(),
});

export const interviewAudienceSchema = z.enum(["recruiter", "hiring-manager", "practitioner", "panel", "other"]);

export const interviewTimezoneSchema = z
	.string()
	.trim()
	.min(1)
	.max(100)
	// Modern Intl accepts offsets such as "+05:00"; interviews need a named zone.
	.refine((value) => !/^[+-]/.test(value) && timezoneSchema.safeParse(value).success, "Choose a valid IANA timezone.");

// Interview details editable by the user. `at` on the timeline entry is the scheduled start
// (full timestamp, unlike stage/note entries which are day-granular).
export const interviewDetailsSchema = z.object({
	kind: interviewKindSchema,
	durationMinutes: z
		.number()
		.int()
		.min(5)
		.max(24 * 60)
		.default(60),
	location: z.string().trim().max(500).default(""),
	notes: z.string().trim().max(5000).default(""),
	participants: z.array(interviewParticipantSchema).max(20).default([]),
	audience: interviewAudienceSchema.default("other"),
	timezone: interviewTimezoneSchema.default("UTC"),
});

export type InterviewDetails = z.infer<typeof interviewDetailsSchema>;

export const applicationTimelineEntrySchema = z.discriminatedUnion("type", [
	timelineBaseSchema.extend({
		type: z.literal("stage"),
		stage: applicationStatusSchema,
		laneId: z.string().optional(),
		laneLabel: z.string().max(80).nullable().optional(),
		closedReason: applicationClosedReasonSchema.nullable().optional(),
		canonicalTransition: z.boolean().optional(),
		/** Imported state with no known entry date; `at` records the import, not the stage transition. */
		dateUnknown: z.boolean().optional(),
		/** Server-assigned write order, independent of the editable display date. Absent on legacy entries. */
		writeSequence: z.number().int().positive().optional(),
	}),
	timelineBaseSchema.extend({
		type: z.literal("note"),
		text: z.string().trim().min(1),
	}),
	timelineBaseSchema.extend({
		type: z.literal("interview"),
		...interviewDetailsSchema.shape,
	}),
]);

export type ApplicationTimelineEntry = z.infer<typeof applicationTimelineEntrySchema>;
export type InterviewTimelineEntry = Extract<ApplicationTimelineEntry, { type: "interview" }>;

/**
 * Latest stage write, independent of display dates and API timeline sorting. Sequenced writes supersede legacy
 * entries; a legacy-only history keeps its date-based fallback until its next move.
 */
export function latestStageEntryId(
	activity: readonly (Pick<ApplicationTimelineEntry, "id" | "type" | "at"> & { writeSequence?: number | undefined })[],
): string | null {
	let latest: (typeof activity)[number] | undefined;
	for (const entry of activity)
		if (
			entry.type === "stage" &&
			(!latest ||
				(entry.writeSequence ?? 0) > (latest.writeSequence ?? 0) ||
				(entry.writeSequence === undefined &&
					latest.writeSequence === undefined &&
					new Date(entry.at).getTime() >= new Date(latest.at).getTime()))
		)
			latest = entry;
	return latest?.id ?? null;
}

// Reserved for AI enrichment output (autofill / match-score). Free-form so the shape can
// evolve without a migration. See the AI roadmap in the applications feature.
export const aiMetadataSchema = z.record(z.string(), z.unknown());

export type AiMetadata = z.infer<typeof aiMetadataSchema>;

/** Active post-submission stages confirm sending; closing a saved job alone does not. */
export function hasApplicationSubmission(application: {
	status: ApplicationStatus;
	activity: readonly ApplicationTimelineEntry[];
}): boolean {
	const sent = (status: ApplicationStatus) => status !== "saved" && status !== "closed";
	return (
		sent(application.status) ||
		(application.status === "closed" &&
			application.activity.some(
				(entry) => entry.type === "stage" && entry.canonicalTransition !== false && sent(entry.stage),
			))
	);
}

const INTERVIEW_SEQUENCE: readonly InterviewKind[] = ["screening", "technical", "behavioral", "onsite"];

/**
 * The type a new interview most likely is: the step after the furthest one already on the timeline, or Other past an
 * onsite. With none yet, a screening, or a technical round once the application has moved to the Interview stage.
 */
export function nextInterviewKind(existing: readonly InterviewKind[], pastScreening = false): InterviewKind {
	const furthest = Math.max(-1, ...existing.map((kind) => INTERVIEW_SEQUENCE.indexOf(kind)));
	if (furthest === -1) return existing.length > 0 ? "other" : pastScreening ? "technical" : "screening";
	return INTERVIEW_SEQUENCE[furthest + 1] ?? "other";
}
