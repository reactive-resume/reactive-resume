import type { AiUsage } from "../ai/usage";
import { ORPCError } from "@orpc/client";
import { generateId } from "@reactive-resume/utils/string";
import { agentService } from "../agent/service";
import { aiProvidersService } from "../ai-providers/service";
import { assertAgentEnvironment } from "../ai/credentials";
import { assertDocumentVersion } from "../documents/ownership";
import { documentsService } from "../documents/service";
import { resumeService } from "../resume/service";
import { applicationService, assertApplicationVersion } from "./service";

type ResumeReviewInput = {
	userId: string;
	id: string;
	signal?: AbortSignal | undefined;
	request?: string | undefined;
	alwaysCopy?: boolean | undefined;
	check?: AiUsage["check"];
};

/** Application entry points share the existing copy, assistant and guarded proposal owners. */
export async function reviewApplicationResume(input: ResumeReviewInput) {
	const application = await applicationService.getById({ id: input.id, userId: input.userId });
	if (!application.resumeId)
		throw new ORPCError("BAD_REQUEST", { message: "Link a resume to this application first." });
	if (!application.jobDescription && application.requirements.length === 0)
		throw new ORPCError("BAD_REQUEST", { message: "Paste the job description into this application first." });
	const resume = await resumeService.getById({ id: application.resumeId, userId: input.userId });
	const check: AiUsage["check"] = async (tx) => {
		await input.check?.(tx);
		await assertApplicationVersion(tx, input.userId, application);
		await assertDocumentVersion(tx, input.userId, { kind: "resume", ...resume });
	};
	assertAgentEnvironment();
	const provider = await aiProvidersService.getDefaultRunnable({ userId: input.userId });
	if (!provider) throw new ORPCError("BAD_REQUEST", { message: "Set up an enabled, tested AI provider first." });
	await aiProvidersService.authorize({ userId: input.userId, id: provider.id }, check);
	input.signal?.throwIfAborted();
	const copy = input.alwaysCopy || resume.applicationId !== application.id;
	const name = copy ? `Tailored — ${application.company} · ${application.role}`.slice(0, 60) : resume.name;
	const resumeId = copy
		? await documentsService.copyForJob({
				userId: input.userId,
				resumeId: resume.id,
				applicationId: application.id,
				name,
			})
		: resume.id;
	let threadId: string | undefined;
	let interrupted = false;
	try {
		input.signal?.throwIfAborted();
		const thread = await agentService.threads.start({ userId: input.userId, resumeId, aiProviderId: provider.id });
		threadId = thread.id;
		const stream = await agentService.messages.send({
			userId: input.userId,
			threadId,
			usageAction: "tailor-resume",
			usageCheck: input.check,
			knowledgeReview: input.check !== undefined,
			signal: input.signal,
			message: {
				id: generateId(),
				role: "user",
				parts: [
					{
						type: "text",
						text:
							input.request ??
							"Propose truthful edits to tailor this resume copy for the linked job posting. Ask before assuming missing facts. Keep every edit pending for my review.",
					},
				],
			},
			context: { document: true, posting: true, applicationId: application.id, memory: false, web: false },
		});
		for await (const _chunk of stream) input.signal?.throwIfAborted();
	} catch {
		input.signal?.throwIfAborted();
		// A failed reply must not delete a copy the user may already be editing.
		interrupted = true;
	}
	const conversation = threadId ? await agentService.threads.get({ userId: input.userId, id: threadId }) : undefined;
	return {
		resumeId,
		name,
		reviewRequired: true as const,
		generationStatus: interrupted || conversation?.interrupted.length ? ("interrupted" as const) : ("ready" as const),
		...(conversation ? { conversation } : {}),
	};
}
