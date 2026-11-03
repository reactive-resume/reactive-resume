import { ORPCError } from "@orpc/client";
import z from "zod";
import { applicationReviewSchema } from "@reactive-resume/ai/application-review";
import { proposeEditsOutputSchema } from "@reactive-resume/ai/tools/agent-tool-contracts";
import { aiOperationIds } from "@reactive-resume/schema/ai-usage";
import { generateCareer } from "../career/generate";
import { draftLetterBody } from "../cover-letters/draft";
import { coverLetterService } from "../cover-letters/service";
import { resumeService } from "../resume/service";
import { reviewApplicationResume } from "./resume-review";
import { applicationService } from "./service";

export const prepareInput = z.object({
	id: z.string(),
	questions: z.array(z.string().trim().min(1).max(2000)).max(5),
});
export const prepareOutput = applicationReviewSchema;

/** One consented operation, existing draft owners; no employer write and no document content mutation. */
export async function prepareApplication(
	input: z.infer<typeof prepareInput> & { userId: string; locale: string; signal?: AbortSignal | undefined },
) {
	const signal = AbortSignal.any([AbortSignal.timeout(240_000), ...(input.signal ? [input.signal] : [])]);
	const tailoring = await reviewApplicationResume({ userId: input.userId, id: input.id, signal });
	const [application, resume] = await Promise.all([
		applicationService.getById({ id: input.id, userId: input.userId }),
		resumeService.getById({ id: tailoring.resumeId, userId: input.userId }),
	]);
	const sets = (tailoring.conversation?.messages ?? []).flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== "tool-propose_edits" || !("state" in part) || part.state !== "output-available") return [];
			const parsed = proposeEditsOutputSchema.safeParse("output" in part ? part.output : undefined);
			return parsed.success
				? [
						{
							...parsed.data,
							messageId: message.id,
							toolCallId: "toolCallId" in part && typeof part.toolCallId === "string" ? part.toolCallId : "",
							aiOperationIds: aiOperationIds(message.metadata),
						},
					]
				: [];
		}),
	);
	const failed: string[] = tailoring.generationStatus === "interrupted" ? ["tailoring"] : [];
	let selectedLetter = application.coverLetterId
		? await coverLetterService.getById({ id: application.coverLetterId, userId: input.userId })
		: null;
	// A selectedLetter linked to a different source keeps its original context; prepare an empty job-specific draft instead.
	if (
		!selectedLetter ||
		selectedLetter.sourceResumeId !== resume.id ||
		selectedLetter.sourceApplicationId !== application.id
	)
		selectedLetter = await coverLetterService.create({
			userId: input.userId,
			name: `${application.company} — ${application.role}`.slice(0, 100),
			content: "",
			applicationId: application.id,
			resumeId: resume.id,
		});
	const draftLetter = selectedLetter;
	const letterResult = async () => {
		const stream = await draftLetterBody({
			userId: input.userId,
			id: draftLetter.id,
			variant: "draft",
			includeProvenance: true,
			signal,
		});
		let text = "";
		const ids: string[] = [];
		for await (const part of stream) {
			if (typeof part === "string") text += part;
			else ids.push(part.aiOperationId);
		}
		signal.throwIfAborted();
		return { document: draftLetter, text: text.trim(), aiOperationIds: ids };
	};
	const [letter, answers] = await Promise.all([
		letterResult().catch(() => {
			signal.throwIfAborted();
			failed.push("letter");
			return null;
		}),
		Promise.all(
			input.questions.map(async (question, index) => {
				try {
					const result = await generateCareer({
						userId: input.userId,
						applicationId: input.id,
						locale: input.locale,
						task: { task: "answer", question, answer: "" },
						signal,
					});
					if (!result.answer) throw new ORPCError("BAD_GATEWAY");
					return {
						question,
						answer: {
							answer: result.answer.text,
							factIds: result.answer.factIds,
							aiOperationIds: result.answer.aiOperationIds,
						},
						note: result.answer.note,
					};
				} catch {
					signal.throwIfAborted();
					failed.push(`question:${index + 1}`);
					return null;
				}
			}),
		),
	]);
	signal.throwIfAborted();
	return {
		threadId: tailoring.conversation?.thread.id ?? null,
		generationStatus: tailoring.generationStatus,
		resume,
		sets,
		letter,
		answers: answers.filter((answer) => answer !== null),
		failed,
	};
}
