// Shared typed contracts for the assistant's tools. Zod is the only runtime import — the
// "ai" package is a devDependency used with `import type` only, so this file stays
// runtime-universal (consumed by both the API tool definitions and the web chat UI).
import type { UIDataTypes, UIMessage } from "ai";
import z from "zod";
import { UNSUPPORTED_CLAIM_KINDS } from "@reactive-resume/resume/proposals";
import { resumeChangeSchema } from "@reactive-resume/resume/structural-proposals";
import { careerStoryInputSchema } from "@reactive-resume/schema/career";

export const askUserQuestionInputSchema = z.object({
	question: z.string().trim().min(1),
	choices: z.array(z.string().trim().min(1)).min(1).max(4).optional(),
	recommendedChoice: z.string().trim().optional(),
});

export const searchWebInputSchema = z.object({
	query: z.string().trim().min(1).max(500),
});
export const readPageInputSchema = z.object({ url: z.url().max(2_048) });
export const searchWebOutputSchema = z.array(
	z.object({
		url: z.string(),
		title: z.string(),
		snippet: z.string().optional(),
	}),
);
export const readPageOutputSchema = z.object({
	requestedUrl: z.string(),
	resolvedUrl: z.string().optional(),
	content: z.string(),
	format: z.enum(["text", "markdown"]),
	retrievedAt: z.iso.datetime({ offset: true }),
	providerFetchedAt: z.iso.datetime({ offset: true }).optional(),
	method: z.enum(["builtin", "firecrawl", "tavily", "exa"]),
	truncated: z.boolean(),
	completeness: z.enum(["unknown", "incomplete"]),
	fallbackReason: z.string().optional(),
});
export type SearchWebOutput = z.infer<typeof searchWebOutputSchema>;
export type ReadPageOutput = z.infer<typeof readPageOutputSchema>;

const approvalPartSchema = z.object({
	type: z.enum(["tool-search_web", "tool-save_story"]),
	state: z.literal("approval-requested"),
	approval: z.object({ id: z.string() }),
	input: z.unknown(),
});

type ApprovalRequest =
	| { id: string; kind: "search"; text: string }
	| { id: string; kind: "story"; text: string; story: z.infer<typeof proposedStorySchema> };

const proposedStorySchema = careerStoryInputSchema.omit({ applicationId: true });

/**
 * Exact arguments awaiting a user decision; model prose cannot create an approval control. A story comes with its
 * parts and the fact IDs it claims to rest on, so it can be reviewed part by part; `text` keeps the flat form.
 */
export function agentApprovalRequests(message: UIMessage): ApprovalRequest[] {
	return message.parts.flatMap<ApprovalRequest>((part) => {
		const parsed = approvalPartSchema.safeParse(part);
		if (!parsed.success) return [];
		const { type, input, approval } = parsed.data;
		if (type === "tool-search_web") {
			const query = searchWebInputSchema.safeParse(input);
			return query.success ? [{ id: approval.id, kind: "search" as const, text: query.data.query }] : [];
		}
		const story = proposedStorySchema.safeParse(input);
		if (!story.success) return [];
		const { title, situation, task, action, result, reflection, tags } = story.data;
		return [
			{
				id: approval.id,
				kind: "story" as const,
				text: [title, situation, task, action, result, reflection, tags.join(", ")].filter(Boolean).join("\n\n"),
				story: story.data,
			},
		];
	});
}

/**
 * Why a reply failed, as the server words it. Plain English so older clients still read it; current clients look the
 * message up and show their own translation. Provider failures are the ones a different connection can fix.
 */
export const AGENT_REPLY_ERRORS = {
	providerKey: "The AI provider rejected the saved key. Check the key in Settings, or change the connection.",
	providerModel: "The AI provider doesn't offer this model. Choose another model, or change the connection.",
	providerLimit:
		"The AI provider is limiting requests (rate limit or quota). Wait a minute and try again, or change the connection.",
	providerDown: "The AI provider is unavailable right now. Try again in a moment, or change the connection.",
	provider: "The AI provider couldn't finish this reply. Try again, or change the connection.",
	failed: "This reply couldn't finish. Try again.",
} as const;
export type AgentReplyError = keyof typeof AGENT_REPLY_ERRORS;

/** The reply error a message names, or null for any other message (a safe server reason or a browser error). */
export const agentReplyError = (message: string): AgentReplyError | null =>
	(Object.keys(AGENT_REPLY_ERRORS) as AgentReplyError[]).find((key) => AGENT_REPLY_ERRORS[key] === message) ?? null;

const knowledgeOutputSchema = z.object({
	facts: z.array(z.object({ id: z.string(), text: z.string() })).catch([]),
	stories: z.array(z.object({ id: z.string(), data: z.object({ title: z.string() }) })).catch([]),
});

/** The facts and stories a reply's Knowledge searches returned: what it actually read, once each. */
export function agentKnowledgeUsed(message: UIMessage) {
	const facts = new Map<string, string>();
	const stories = new Map<string, string>();
	for (const part of message.parts) {
		const toolPart = part as { state?: string; output?: unknown };
		if (
			!["tool-search_career_knowledge", "tool-read_knowledge"].includes(part.type) ||
			toolPart.state !== "output-available"
		)
			continue;
		const parsed = knowledgeOutputSchema.safeParse(toolPart.output);
		if (!parsed.success) continue;
		for (const fact of parsed.data.facts) facts.set(fact.id, fact.text);
		for (const story of parsed.data.stories) stories.set(story.id, story.data.title);
	}
	return {
		facts: [...facts].map(([id, text]) => ({ id, text })),
		stories: [...stories].map(([id, title]) => ({ id, title })),
	};
}

export type AgentWebSource = {
	url: string;
	title: string;
	kind: "native" | "search" | "page";
};

// Link validation only; the server reader additionally checks DNS and redirects before fetching.
function publicSourceUrl(value: string): string | null {
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/\.$/, "");
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
		// Source links use public hostnames. Reject IP literals and local names instead of guessing IP ranges in the browser.
		if (
			!host.includes(".") ||
			/^[\d.]+$/.test(host) ||
			host.includes(":") ||
			/(?:^|\.)(?:localhost|local|internal|lan)$/.test(host) ||
			host.endsWith(".home.arpa")
		)
			return null;
		url.hash = "";
		return url.toString();
	} catch {
		return null;
	}
}

/** Sources from successful retrieval and native source parts, never links invented in response text. */
export function agentWebSources(message: UIMessage): AgentWebSource[] {
	const sources = new Map<string, AgentWebSource>();
	const add = (value: string, title: string, kind: AgentWebSource["kind"]) => {
		const url = publicSourceUrl(value);
		if (url && !sources.has(url)) sources.set(url, { url, title: title.trim() || url, kind });
	};
	for (const part of message.parts) {
		if (part.type === "source-url") {
			add(part.url, part.title ?? "", "native");
			continue;
		}
		const toolPart = part as { state?: string; output?: unknown };
		if (toolPart.state !== "output-available") continue;
		if (part.type === "tool-search_web") {
			const parsed = searchWebOutputSchema.safeParse(toolPart.output);
			if (parsed.success) for (const result of parsed.data) add(result.url, result.title, "search");
		} else if (part.type === "tool-read_page") {
			const parsed = readPageOutputSchema.safeParse(toolPart.output);
			if (parsed.success) add(parsed.data.resolvedUrl ?? parsed.data.requestedUrl, "", "page");
		}
	}
	return [...sources.values()];
}

/** Review fields any proposed change may carry when tailoring: what it addresses, what backs it, what nothing backs. */
const reviewInput = {
	requirement: z
		.string()
		.trim()
		.min(1)
		.max(240)
		.optional()
		.describe("When tailoring to the posting: the posting requirement this edit addresses, in its words."),
	evidence: z
		.array(z.string().trim().min(1))
		.max(4)
		.optional()
		.describe("Ids of passages already in the document that say what the new text says. Cite only real support."),
	factIds: z
		.array(z.string().trim().min(1))
		.max(4)
		.optional()
		.describe("Ids of Knowledge facts from read_knowledge that say what the new text says, when Knowledge is shared."),
	unsupported: z
		.array(z.object({ kind: z.enum(UNSUPPORTED_CLAIM_KINDS), text: z.string().trim().min(1).max(120) }))
		.max(6)
		.optional()
		.describe(
			"Anything the new text claims that no cited passage or fact says: an employer, title, date, figure, skill or responsibility the user told you or must confirm. Leave none out.",
		),
};

/** One edit: rewrite a passage of the document, or add a new passage after it. */
export const proposedEditInputSchema = z.object({
	passageId: z.string().trim().min(1).describe("The id of a passage from read_resume or read_letter."),
	text: z
		.string()
		.trim()
		.min(1)
		.max(2_000)
		.describe("The passage as it should read, in plain text: the rewrite, or the new passage to add."),
	why: z.string().trim().min(1).max(240).describe("One short line on why."),
	add: z.boolean().optional().describe("Add `text` as a new passage after this one, instead of replacing it."),
	...reviewInput,
});

const citationsInput = {
	passageIds: z.array(z.string().trim().min(1)).max(4).optional(),
	factIds: z.array(z.string().trim().min(1)).max(4).optional(),
};

const requirementsInput = z
	.array(
		z.object({
			text: z.string().trim().min(1).max(240),
			status: z
				.enum(["edited", "cited", "missing"])
				.describe(
					"edited: an edit in this set addresses it. cited: the document or Knowledge already shows it (cite where). missing: nothing shows it, so it stays a gap.",
				),
			...citationsInput,
		}),
	)
	.max(20)
	.optional()
	.describe(
		"When tailoring to the posting: every requirement in it, in its words, including the ones nothing addresses.",
	);

export const proposeEditsInputSchema = z.object({
	title: z.string().trim().min(1).max(80).describe('What the edits do together, e.g. "Tailor to the Lumen posting".'),
	edits: z.array(proposedEditInputSchema).min(1).max(12),
	requirements: requirementsInput,
});

const [textChange, fieldChange, entryChange, sectionChange] = resumeChangeSchema.options;

/** Typed resume changes (see resumeChangeSchema), each with the same review fields as a passage edit. */
export const proposeResumeEditsInputSchema = z.strictObject({
	title: z.string().trim().min(1).max(80),
	changes: z
		.array(
			z.discriminatedUnion("kind", [
				textChange.extend(reviewInput),
				fieldChange.extend(reviewInput),
				entryChange.extend(reviewInput),
				sectionChange.extend(reviewInput),
			]),
		)
		.min(1)
		.max(24),
	requirements: requirementsInput,
});
export type ProposeResumeEditsInput = z.infer<typeof proposeResumeEditsInputSchema>;

const proposalTargetSchema = z.object({
	sectionId: z.string(),
	itemId: z.string().optional(),
	roleId: z.string().optional(),
	field: z.string(),
});

/** A citation, resolved: a passage's place and words, or a Knowledge fact by id (its text is never stored here). */
const evidenceSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("passage"), location: z.string(), text: z.string() }),
	z.object({ kind: z.literal("fact"), id: z.string() }),
]);

/** An edit as proposed, resolved against the document: it replaces `before` with `after`. */
export const proposedEditSchema = z.object({
	id: z.string(),
	target: proposalTargetSchema,
	location: z.string(),
	before: z.string(),
	after: z.string(),
	why: z.string(),
	status: z.enum(["pending", "accepted", "rejected"]),
	snapshot: z.object({ before: z.string(), after: z.string() }).optional(),
	// Optional: edits proposed before review evidence existed keep rendering.
	requirement: z.string().optional(),
	evidence: z.array(evidenceSchema).optional(),
	unresolved: z.number().optional(),
	unsupported: z
		.array(z.object({ kind: z.union([z.enum(UNSUPPORTED_CLAIM_KINDS), z.literal("term")]), text: z.string() }))
		.optional(),
	edited: z.boolean().optional(),
});

export const requirementCoverageSchema = z.object({
	text: z.string(),
	status: z.enum(["edited", "cited", "missing", "unassessed"]),
	evidence: z.array(evidenceSchema),
	unresolved: z.number().optional(),
});

export const proposeEditsOutputSchema = z.looseObject({
	title: z.string(),
	edits: z.array(proposedEditSchema),
	/** Edits that couldn't be placed: the passage wasn't found (the document changed since it was read). */
	skipped: z.array(z.object({ passageId: z.string(), reason: z.string() })),
	/** The posting's requirements as the assistant read them, gaps included; absent outside tailoring. */
	requirements: z.array(requirementCoverageSchema).optional(),
	/** The application whose copy these edits tailor (null: no posting shared); only that copy may accept them. */
	tailoredFor: z.string().nullable().optional(),
	/** Set when the server withheld these edits from acceptance here (see tailoringAllows). */
	revoked: z.boolean().optional(),
});

/**
 * Whether a set of resume edits may be accepted on a resume made for `madeFor` (null: a base resume other jobs can
 * share). Newer sets record the application they tailor to, or null when no posting was shared. An older set without
 * that record is refused unless its reply left the posting out: a resume's current link can't show which posting the
 * reply used, so that set is asked for again on the job's copy instead.
 */
export function tailoringAllows(message: UIMessage, output: unknown, madeFor: string | null) {
	const record = output as { tailoredFor?: unknown } | null | undefined;
	if (record && typeof record === "object" && "tailoredFor" in record)
		return record.tailoredFor === null || record.tailoredFor === madeFor;
	// The server records [document, posting] per reply.
	const scope = (message.metadata as { contextScope?: unknown } | undefined)?.contextScope;
	return typeof scope === "string" && scope.endsWith(",false]");
}

/** The `before` of a pending edit that can't be accepted here: no document contains it, so every app shows it out of date. */
export const REVOKED_PASSAGE = '<p data-revoked=""></p>';

/** Whether a propose_edits result cites a Knowledge fact, whose text the app looks up while it's still switched on. */
export function citesKnowledge(output: unknown) {
	const { edits = [], requirements = [] } = (output ?? {}) as Partial<ProposeEditsOutput>;
	return [...edits.flatMap((edit) => edit.evidence ?? []), ...requirements.flatMap((item) => item.evidence)].some(
		(item) => item.kind === "fact",
	);
}

// All-optional and loose: legacy rows have no metadata and must keep rendering.
// The usage shape mirrors the AI SDK's LanguageModelUsage (nested token details).
export const agentMessageMetadataSchema = z
	.looseObject({
		model: z.string().optional(),
		provider: z.string().optional(),
		usage: z
			.looseObject({
				inputTokens: z.number().optional(),
				outputTokens: z.number().optional(),
				totalTokens: z.number().optional(),
				inputTokenDetails: z
					.looseObject({
						noCacheTokens: z.number().optional(),
						cacheReadTokens: z.number().optional(),
						cacheWriteTokens: z.number().optional(),
					})
					.optional(),
				outputTokenDetails: z
					.looseObject({
						textTokens: z.number().optional(),
						reasoningTokens: z.number().optional(),
					})
					.optional(),
			})
			.optional(),
	})
	.optional();

export type AskUserQuestionInput = z.infer<typeof askUserQuestionInputSchema>;
export type ProposeEditsInput = z.infer<typeof proposeEditsInputSchema>;
export type ProposedEdit = z.infer<typeof proposedEditSchema>;
export type ProposeEditsOutput = z.infer<typeof proposeEditsOutputSchema>;
export type AgentMessageMetadata = z.infer<typeof agentMessageMetadataSchema>;

export type AgentTools = {
	ask_user_question: { input: AskUserQuestionInput; output: string };
	read_resume: { input: Record<string, never>; output: unknown };
	read_letter: { input: Record<string, never>; output: unknown };
	read_attachment: { input: { attachmentId: string }; output: unknown };
	propose_edits: { input: ProposeEditsInput | ProposeResumeEditsInput; output: ProposeEditsOutput };
	read_knowledge: { input: { query: string }; output: unknown };
	search_web: {
		input: z.infer<typeof searchWebInputSchema>;
		output: SearchWebOutput;
	};
	read_page: {
		input: z.infer<typeof readPageInputSchema>;
		output: ReadPageOutput;
	};
	// Provider-native search names remain readable in existing conversations.
	web_search: { input: unknown; output: unknown };
	google_search: { input: unknown; output: unknown };
};

export type AgentUIMessage = UIMessage<AgentMessageMetadata, UIDataTypes, AgentTools>;
