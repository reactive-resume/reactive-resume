import z from "zod";

// Pipeline stages are a fixed enum. If per-user custom stages are ever needed, promote this to a table.
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

export const applicationClosedReasonSchema = z.enum(["not-selected", "withdrew", "accepted-other", "no-response"]);

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

export const INTERVIEW_KINDS = [
	{ value: "screening", label: "Screening", color: "oklch(0.45 0.08 195)" },
	{ value: "technical", label: "Technical", color: "oklch(0.52 0.19 285)" },
	{ value: "behavioral", label: "Behavioral", color: "oklch(0.5 0.1 70)" },
	{ value: "onsite", label: "Onsite", color: "oklch(0.55 0.15 152)" },
	{ value: "other", label: "Other", color: "oklch(0.62 0 0)" },
] as const satisfies ReadonlyArray<{ value: InterviewKind; label: string; color: string }>;

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
});

export type InterviewDetails = z.infer<typeof interviewDetailsSchema>;

export const applicationTimelineEntrySchema = z.discriminatedUnion("type", [
	timelineBaseSchema.extend({
		type: z.literal("stage"),
		stage: applicationStatusSchema,
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

// Reserved for AI enrichment output (autofill / match-score). Free-form so the shape can
// evolve without a migration. See the AI roadmap in the applications feature.
export const aiMetadataSchema = z.record(z.string(), z.unknown());

export type AiMetadata = z.infer<typeof aiMetadataSchema>;
