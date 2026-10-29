import z from "zod";
import { searchRegionsSchema } from "@reactive-resume/utils/region";
import { timezoneSchema } from "@reactive-resume/utils/timezone";

/** The workspace tabs of one application, in the order a search happens. */
export const WORKSPACE_TABS = ["fit", "apply", "prepare", "practise", "debrief", "messages", "saved"] as const;
export const workspaceTabSchema = z.enum(WORKSPACE_TABS);
export type WorkspaceTab = z.infer<typeof workspaceTabSchema>;

export const careerScopeSchema = z.object({ applicationId: z.string().min(1).nullable().default(null) });

export const careerSourceSchema = z.object({
	kind: z.enum([
		"user-message",
		"resume",
		"letter",
		"resume-version",
		"letter-version",
		"attachment",
		"manual",
		"debrief",
	]),
	id: z.string().max(255),
	quote: z.string().max(4000),
});
export type CareerSource = z.infer<typeof careerSourceSchema>;

export const factCategorySchema = z.enum(["accomplishment", "experience", "skill", "preference"]);
export type FactCategory = z.infer<typeof factCategorySchema>;

export const memoryModeSchema = z.enum(["ask", "auto", "off"]);
export type MemoryMode = z.infer<typeof memoryModeSchema>;

const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const payPeriodSchema = z.enum(["hour", "month", "year"]);

/** Preferences: what the user is looking for, used by discovery, Fit, Offers and the coach. */
export const careerProfileDataSchema = z.object({
	targetRoles: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
	locations: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
	/** "What matters to you", in the user's own words. */
	priorities: z.string().max(4000).default(""),
	minBase: z
		.object({ amount: z.number().nonnegative().nullable(), currency: currencySchema, period: payPeriodSchema })
		.default({ amount: null, currency: "USD", period: "year" }),
	/** 0 is fully remote. */
	maxOfficeDays: z.number().int().min(0).max(5).nullable().default(null),
	noticeWeeks: z.number().int().min(0).max(52).nullable().default(null),
	memoryMode: memoryModeSchema.default("ask"),
	/**
	 * Countries web searches target, first is primary. Absent or null is automatic (from the account
	 * time zone), [] is anywhere. No default, so a save that leaves it out keeps the stored value.
	 */
	searchRegions: searchRegionsSchema,
});
export type CareerProfileData = z.infer<typeof careerProfileDataSchema>;

export const careerFactInputSchema = careerScopeSchema.extend({
	text: z.string().trim().min(1).max(2000),
	category: factCategorySchema,
	source: careerSourceSchema,
});

export const careerStoryInputSchema = careerScopeSchema.extend({
	title: z.string().trim().min(1).max(200),
	situation: z.string().trim().min(1).max(4000),
	task: z.string().trim().min(1).max(4000),
	action: z.string().trim().min(1).max(6000),
	result: z.string().trim().max(4000).default(""),
	reflection: z.string().trim().max(4000).default(""),
	factIds: z.array(z.string().min(1)).max(30).default([]),
	tags: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
});
export type CareerStoryData = z.infer<typeof careerStoryInputSchema>;

/** Offer terms in their own currency and pay period. Unknown amounts are null, never zero. */
export const offerTermsSchema = z.object({
	version: z.enum(["written", "verbal"]).default("written"),
	currency: currencySchema,
	period: payPeriodSchema,
	base: z.number().nonnegative().nullable(),
	variable: z.number().nonnegative().nullable(),
	/** What the bonus depends on, or "" when unconditional or unknown. */
	variableConditions: z.string().max(1000).default(""),
	equity: z.string().max(1000).default(""),
	location: z.string().max(500).default(""),
	officeDays: z.number().int().min(0).max(5).nullable().default(null),
	leave: z.string().max(500).default(""),
	learning: z.number().nonnegative().nullable().default(null),
	other: z.string().max(1000).default(""),
	respondBy: z.iso.datetime({ offset: true }).nullable().default(null),
});
export type OfferTerms = z.infer<typeof offerTermsSchema>;

/** Manually entered terms use the same saved offer shape as confirmed message proposals. */
export const careerOfferInputSchema = offerTermsSchema.extend({ applicationId: z.string().min(1) });

const text = (max = 2000) => z.string().trim().max(max);

/**
 * What the coach wrote for an application, by kind. Each one is produced by `career.generate` from a fixed shape,
 * so tabs render it without parsing prose, and it still opens when the provider is down.
 */
export const savedItemDataSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("fit"),
		headline: text(200),
		summary: text(600),
		requirements: z
			.array(
				z.object({
					text: text(300),
					origin: z.enum(["posting", "inferred"]),
					status: z.enum(["supported", "partial", "missing"]),
					evidence: text(600),
					factIds: z.array(z.string()).max(10).default([]),
				}),
			)
			.max(20),
		/** Checks against Preferences: salary, office days, location. `met: null` is "needs confirming". */
		checks: z.array(z.object({ label: text(60), met: z.boolean().nullable(), text: text(300) })).max(5),
		ask: z.object({ person: text(100), text: text(400) }).nullable(),
	}),
	z.object({
		kind: z.literal("briefing"),
		headline: text(200),
		summary: text(300),
		plan: z
			.array(
				z.object({
					minutes: z.number().int().min(1).max(60),
					title: text(120),
					detail: text(400),
					action: z.enum(["story", "draft-story", "questions", "practise", "none"]),
					storyId: z.string().nullable().default(null),
				}),
			)
			.max(8),
		questions: z.array(z.object({ text: text(400), origin: text(60) })).max(8),
		focus: text(500),
		opening: text(600),
		stories: z.array(text(300)).max(3),
		honesty: text(400),
		storyIds: z.array(z.string()).max(5).default([]),
		/** A story the interviewer asked for that Knowledge doesn't have yet. */
		missingStory: text(300).nullable().default(null),
		practiceQuestions: z.array(text(300)).max(5).default([]),
	}),
	z.object({
		kind: z.literal("practice"),
		question: text(500),
		origin: z.enum(["simulated", "recalled"]),
		mode: z.enum(["typed", "spoken"]),
		answer: text(6000),
		title: text(200),
		works: text(500),
		strengthen: text(500),
		opening: text(800),
		/** A three-word result note for the attempts rail, e.g. "Contribution unclear". */
		note: text(60),
	}),
	z.object({
		kind: z.literal("debrief"),
		round: text(100),
		question: text(500),
		answer: text(6000),
		landed: z.enum(["well", "mixed", "not"]),
		title: text(200),
		verdicts: z.array(z.object({ tag: z.enum(["supported", "observation"]), text: text(400) })).max(6),
		nextRound: text(600),
		priority: text(400),
		/** Something the interviewer asked for, worth remembering for this application only. */
		remember: text(400).nullable().default(null),
		plan: z
			.array(
				z.object({
					day: z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
					minutes: z.number().int().min(5).max(120),
					task: text(300),
				}),
			)
			.max(5),
	}),
	z.object({
		kind: z.literal("answers"),
		answers: z.array(z.object({ question: text(), answer: text(6000) })).max(30),
	}),
	z.object({
		kind: z.literal("reply"),
		message: text(20_000),
		title: text(200),
		asks: z.array(text(300)).max(5),
		unconfirmed: z.array(text(300)).max(5),
		reply: text(4000),
		changes: z
			.array(
				z.discriminatedUnion("type", [
					z.object({
						type: z.literal("stage"),
						// Never "applied": marking a submission is Apply's job, with the versions sent.
						stage: z.enum(["screening", "interview", "offer", "closed"]),
					}),
					/** The application's next step, with a reminder when a reply is due. */
					z.object({ type: z.literal("follow-up"), at: z.iso.datetime({ offset: true }).nullable(), note: text(300) }),
					z.object({ type: z.literal("offer") }),
				]),
			)
			.max(4),
		offer: offerTermsSchema.nullable().default(null),
		/** Set when the user applied the proposal: which changes, and when. */
		applied: z
			.object({ at: z.iso.datetime({ offset: true }), changes: z.array(z.number().int()) })
			.nullable()
			.default(null),
	}),
	z.object({ kind: z.literal("offer"), ...offerTermsSchema.shape }),
]);
export type SavedItemData = z.infer<typeof savedItemDataSchema>;
export type SavedItemKind = SavedItemData["kind"];

/**
 * Live, user-owned state of one application's workspace. Each widget owns one key and saves the whole value, so
 * the fields have no defaults: a partial save must not reset the keys it leaves out. Start from `EMPTY_WORKSPACE`.
 */
export const careerWorkspaceSchema = z.object({
	answers: z
		.array(
			z.object({
				id: z.string().min(1).max(64),
				question: text(),
				answer: text(6000),
				factIds: z.array(z.string()).max(10),
			}),
		)
		.max(30),
	/** Indexes of the ticked "Before you submit" items. */
	checklist: z.array(z.number().int().min(0).max(10)).max(10),
	/** Questions to ask, added from Fit or the coach. */
	questions: z.array(z.object({ text: text(400), origin: text(60) })).max(20),
	/** Fit requirements closed with "Add evidence": requirement text → the new fact's id. */
	evidence: z.record(z.string().max(300), z.string().max(64)),
	/** Ticked rows per list: "plan:{savedItemId}", "now:{interviewId}", "week:{savedItemId}". */
	ticks: z.record(z.string().max(100), z.array(z.string().max(20)).max(20)),
	/** The employer message pasted into Messages, kept with the application. */
	message: text(20_000),
});
export type CareerWorkspace = z.infer<typeof careerWorkspaceSchema>;
export const EMPTY_WORKSPACE: CareerWorkspace = {
	answers: [],
	checklist: [],
	questions: [],
	evidence: {},
	ticks: {},
	message: "",
};

/** What a tab asks the coach to write. */
export const generateTaskSchema = z.discriminatedUnion("task", [
	z.object({ task: z.literal("fit") }),
	z.object({ task: z.literal("briefing"), interviewId: z.string().min(1) }),
	z.object({
		task: z.literal("practice"),
		storyId: z.string().min(1).optional(),
		interviewId: z.string().min(1).nullable(),
		question: text(500).min(1),
		origin: z.enum(["simulated", "recalled"]),
		mode: z.enum(["typed", "spoken"]),
		answer: text(6000).min(10),
	}),
	z.object({
		task: z.literal("debrief"),
		interviewId: z.string().min(1).nullable(),
		question: text(500).min(1),
		answer: text(6000).min(1),
		landed: z.enum(["well", "mixed", "not"]),
	}),
	z.object({ task: z.literal("reply"), message: text(20_000).min(1) }),
	/** Not saved: a shorter answer, or a first draft when `answer` is empty. */
	z.object({
		task: z.literal("answer"),
		question: text().min(1),
		answer: text(6000),
	}),
]);
export type GenerateTask = z.infer<typeof generateTaskSchema>;

/**
 * A notification, stored as what happened rather than as words. The server writes its English title and body when it's
 * read, so a later release can show the same notices in the reader's language (and any times in their timezone).
 */
export const careerNoticeSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("opportunities"), count: z.number().int().min(1), query: z.string() }),
	z.object({ type: z.literal("briefing"), company: z.string(), role: z.string() }),
	z.object({ type: z.literal("followup"), company: z.string(), role: z.string() }),
	z.object({ type: z.literal("schedule-failed"), reason: z.enum(["stopped", "failed"]) }),
	z.object({ type: z.literal("email-failed") }),
	z.object({ type: z.literal("briefing-paused") }),
]);
export type CareerNotice = z.infer<typeof careerNoticeSchema>;

export const careerScheduleInputSchema = careerScopeSchema.extend({
	kind: z.enum(["discovery", "prepare", "follow-up"]),
	query: z.string().trim().max(500).default(""),
	interviewId: z.string().nullable().default(null),
	/** Prepare only: when the briefing runs relative to the interview. */
	lead: z.enum(["24h", "2h", "morning"]).nullable().default(null),
	enabled: z.boolean().default(true),
	email: z.boolean().default(false),
	nextRunAt: z.coerce.date(),
	timezone: timezoneSchema,
	intervalDays: z.number().int().min(1).max(30).nullable().default(null),
	aiProviderId: z.string().min(1).nullable().default(null),
	/** The interface language; a scheduled briefing is written in it. Kept when left out. */
	locale: z.string().min(2).max(20).optional(),
});
