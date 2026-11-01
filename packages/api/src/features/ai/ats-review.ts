import { z } from "zod";
import { atsReviewSystemPrompt, atsReviewUserPromptTemplate } from "@reactive-resume/ai/prompts";
import { dataBlock, inertMarkers } from "./data-block";
import { generateJson } from "./generate-json";
import { getModel } from "./service";

/** Roughly a very long resume. The client truncates the extracted text to this before sending. */
const MAX_EXTRACTED_TEXT_CHARS = 50_000;
/** Matches the cap the applications feature already uses for a pasted posting. */
const MAX_JOB_DESCRIPTION_CHARS = 20_000;
const MAX_FINDINGS = 120;
/** A long resume's bullets and paragraphs. */
const MAX_PASSAGES = 120;

export const atsReviewInputSchema = z.object({
	aiProviderId: z.string().optional(),
	resumeId: z.string().optional(),
	extractedText: z.string().trim().min(1).max(MAX_EXTRACTED_TEXT_CHARS),
	findings: z
		.array(
			z.object({
				code: z.string().max(64),
				severity: z.string().max(16),
				message: z.string().max(300),
			}),
		)
		.max(MAX_FINDINGS)
		.default([]),
	jobDescription: z.string().trim().max(MAX_JOB_DESCRIPTION_CHARS).optional(),
	passages: z
		.array(
			z.object({
				id: z.string().trim().min(1).max(16).describe("The client's id for the passage, echoed back as `passageId`."),
				where: z.string().max(200).describe("Where the passage sits, e.g. “Experience · Lumen · bullet 2”."),
				text: z.string().max(1_000),
			}),
		)
		.max(MAX_PASSAGES)
		.default([])
		.describe(
			"Bullets and paragraphs the review may rewrite. A suggestion that rewrites one names it in `passageId`, with the whole new passage in `rewrite`.",
		),
});

type AtsReviewInput = z.infer<typeof atsReviewInputSchema>;

const impactSchema = z.enum(["high", "medium", "low"]).catch("medium");

/**
 * Tolerant by design: a provider that returns one malformed suggestion should cost the user that
 * suggestion, not the whole review. Lists are capped by slicing rather than rejecting.
 *
 * There is deliberately no score anywhere in this shape. The deterministic report owns the only
 * number in this feature, and an AI-adjusted score would make it mean less.
 */
export const atsReviewOutputSchema = z.object({
	summary: z.string().catch(""),
	suggestions: z
		.array(
			z.object({
				section: z.string().nullable().catch(null),
				passageId: z.string().nullable().catch(null),
				issue: z.string().catch(""),
				rewrite: z.string().nullable().catch(null),
				impact: impactSchema,
			}),
		)
		.catch([])
		.transform((entries) => entries.filter((entry) => entry.issue.trim().length > 0).slice(0, 12)),
	strengths: z
		.array(z.string())
		.catch([])
		.transform((entries) => entries.filter(Boolean).slice(0, 8)),
	jdAlignment: z
		.object({
			verdict: z.string().catch(""),
			missingConcepts: z
				.array(z.string())
				.catch([])
				.transform((entries) => entries.filter(Boolean).slice(0, 15)),
			strengths: z
				.array(z.string())
				.catch([])
				.transform((entries) => entries.filter(Boolean).slice(0, 10)),
		})
		.nullable()
		.catch(null),
});

export type AtsReviewOutput = z.infer<typeof atsReviewOutputSchema>;

type AtsReviewServiceInput = AtsReviewInput & {
	signal?: AbortSignal | undefined;
	provider: Parameters<typeof getModel>[0]["provider"];
	model: string;
	apiKey: string;
	baseURL: string;
};

function renderFindings(findings: AtsReviewInput["findings"]): string {
	if (findings.length === 0) return "None reported.";
	return findings.map((finding) => `- [${finding.severity}] ${finding.code}: ${finding.message}`).join("\n");
}

function renderJobDescriptionSection(jobDescription: string | undefined): string {
	if (!jobDescription) return "";

	return ["", "## Job description", "", dataBlock("JOB_DESCRIPTION", jobDescription)].join("\n");
}

function renderPassagesSection(passages: AtsReviewInput["passages"]): string {
	if (passages.length === 0) return "";

	return [
		"",
		"## Passages you may rewrite",
		"",
		"Each line is `[id] where: text`. When a suggestion rewrites one of these, set `passageId` to its id and `rewrite` to the whole new passage.",
		"",
		dataBlock(
			"PASSAGES",
			passages.map((passage) => `[${passage.id}] ${passage.where}: ${passage.text.replace(/\s+/g, " ")}`).join("\n"),
		),
	].join("\n");
}

function buildUserPrompt(input: AtsReviewServiceInput): string {
	// One pass over the template, so text inside the resume that happens to look like a placeholder stays as it is.
	const sections: Record<string, string> = {
		EXTRACTED_TEXT: inertMarkers(input.extractedText),
		FINDINGS: renderFindings(input.findings),
		JOB_DESCRIPTION_SECTION: renderJobDescriptionSection(input.jobDescription),
		PASSAGES_SECTION: renderPassagesSection(input.passages ?? []),
	};

	return atsReviewUserPromptTemplate.replace(
		/\{\{([A-Z_]+)\}\}/g,
		(placeholder, name: string) => sections[name] ?? placeholder,
	);
}

/** Qualitative review of the writing. Never returns a score — see {@link atsReviewOutputSchema}. */
export function reviewResumeText(input: AtsReviewServiceInput): Promise<AtsReviewOutput> {
	const model = getModel(input);

	return generateJson(
		model,
		{ system: atsReviewSystemPrompt, prompt: buildUserPrompt(input) },
		atsReviewOutputSchema,
		input.signal,
		0,
	);
}
