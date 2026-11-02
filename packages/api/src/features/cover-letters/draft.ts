import type { CoverLetterDraftInput } from "../../dto/cover-letter";
import { ORPCError } from "@orpc/client";
import { streamText } from "ai";
import { letterDraftSystemPrompt } from "@reactive-resume/ai/prompts";
import { buildMarkdown } from "@reactive-resume/resume/markdown";
import { aiProvidersService } from "../ai-providers/service";
import { dataBlock } from "../ai/data-block";
import { getModel } from "../ai/service";
import { applicationService, assertApplicationVersion } from "../applications/service";
import { assertDocumentVersion } from "../documents/ownership";
import { resumeService } from "../resume/service";
import { coverLetterService } from "./service";

type Variant = CoverLetterDraftInput["variant"];

const REQUESTS: Record<Variant, string> = {
	draft: "Write the body of the letter.",
	shorter: "Shorter: revise the previous draft.",
	personal: "More personal: revise the previous draft.",
};

type PromptInput = {
	variant: Variant;
	locale: string;
	job?: string | undefined;
	posting?: string | undefined;
	resume?: string | undefined;
	previous?: string | undefined;
};

/** The request, the letter's language, the job, the posting, the resume and, for a revision, the draft. */
function buildLetterDraftPrompt(input: PromptInput): string {
	const previous = input.variant === "draft" ? undefined : input.previous?.trim();
	return [
		previous ? REQUESTS[input.variant] : REQUESTS.draft,
		`## The letter's language\n\nWrite in ${input.locale}. The greeting, sign-off and date on the page are written in it too.`,
		input.job && `## The job\n\n${input.job}`,
		input.posting && `## The posting\n\n${dataBlock("POSTING", input.posting)}`,
		input.resume && `## The resume\n\n${dataBlock("RESUME", input.resume)}`,
		previous && `## The previous draft\n\n${dataBlock("DRAFT", previous)}`,
	]
		.filter(Boolean)
		.join("\n\n");
}

/**
 * Streams a draft of the letter's body from its resume and its application's posting. Nothing is saved: the client
 * shows the draft until it's kept or discarded, so a failure leaves the letter as it was.
 */
export async function draftLetterBody(
	input: CoverLetterDraftInput & { userId: string; signal?: AbortSignal | undefined },
): Promise<AsyncGenerator<string>> {
	const { userId } = input;
	const letter = await coverLetterService.getById({ id: input.id, userId });
	const [resume, application] = await Promise.all([
		letter.sourceResumeId ? resumeService.getById({ id: letter.sourceResumeId, userId }).catch(() => null) : null,
		letter.sourceApplicationId
			? applicationService.getById({ id: letter.sourceApplicationId, userId }).catch(() => null)
			: null,
	]);
	if (!resume && !application) {
		throw new ORPCError("BAD_REQUEST", { message: "Link the letter to a resume or an application first." });
	}

	const provider = await aiProvidersService.getDefaultRunnable({ userId });
	if (!provider) {
		throw new ORPCError("BAD_REQUEST", { message: "No AI provider is set up. Add one in Settings to draft letters." });
	}

	const posting =
		application?.jobDescription?.trim() ||
		(application?.requirements.length ? application.requirements.map((item) => `- ${item}`).join("\n") : undefined);
	const model = getModel({
		provider: provider.provider,
		model: provider.model,
		apiKey: provider.apiKey,
		...(provider.baseURL ? { baseURL: provider.baseURL } : {}),
	});
	const prompt = buildLetterDraftPrompt({
		variant: input.variant,
		locale: letter.style.metadata.page.locale,
		job: application ? `${application.role} at ${application.company}` : undefined,
		posting,
		resume: resume ? buildMarkdown(resume.data) : undefined,
		previous: input.previous,
	});
	await aiProvidersService.authorize({ userId, id: provider.id }, async (tx) => {
		await assertDocumentVersion(tx, userId, { kind: "letter", ...letter });
		if (resume) await assertDocumentVersion(tx, userId, { kind: "resume", ...resume });
		if (application) await assertApplicationVersion(tx, userId, application);
	});
	input.signal?.throwIfAborted();
	const result = streamText({
		model,
		prompt,
		system: letterDraftSystemPrompt,
		maxRetries: 0,
		...(input.signal ? { abortSignal: input.signal } : {}),
	});

	// The client names the provider in "Drafting stopped: … didn't respond".
	const unreachable = (cause?: unknown) =>
		new ORPCError("BAD_GATEWAY", {
			message: "Couldn't reach the AI provider. Check its settings and try again.",
			data: { provider: provider.label },
			cause,
		});

	// Resolve and authorize inside the request scope; oRPC iterates the result after that scope has ended.
	return (async function* () {
		try {
			for await (const part of result.stream) {
				if (part.type === "text-delta") yield part.text;
				else if (part.type === "error") throw unreachable(part.error);
			}
		} catch (error) {
			if (input.signal?.aborted) return;
			throw error instanceof ORPCError ? error : unreachable(error);
		}
	})();
}
