import z from "zod";
import { reviewedAnswerInputSchema, reuseAnswerInputSchema } from "@reactive-resume/schema/application-answers";
import { protectedProcedure } from "../../context";
import { reviewedAnswerSchema, reviewedAnswerViewSchema } from "../../dto/career";
import { reviewedAnswers } from "./answers";

export const answerRouter = {
	list: protectedProcedure
		.route({
			method: "GET",
			path: "/career/answers",
			tags: ["Career"],
			operationId: "listReviewedAnswers",
			summary: "List reviewed answers with current evidence and reuse eligibility",
		})
		.input(z.object({ applicationId: z.string().min(1) }))
		.output(z.array(reviewedAnswerViewSchema))
		.handler(({ context, input }) => reviewedAnswers.list(context.user.id, input.applicationId)),
	save: protectedProcedure
		.route({
			method: "POST",
			path: "/career/answers",
			tags: ["Career"],
			operationId: "saveReviewedAnswer",
			summary: "Explicitly review and save reusable wording",
		})
		.input(reviewedAnswerInputSchema)
		.output(reviewedAnswerSchema)
		.handler(({ context, input }) => reviewedAnswers.save(context.user.id, input)),
	reuse: protectedProcedure
		.route({
			method: "POST",
			path: "/career/answers/{id}/reuse",
			tags: ["Career"],
			operationId: "reuseReviewedAnswer",
			summary: "Review a scoped answer and return an independent draft copy",
		})
		.input(reuseAnswerInputSchema)
		.output(z.object({ text: z.string(), factIds: z.array(z.string()) }))
		.handler(({ context, input }) => reviewedAnswers.reuse(context.user.id, input)),
	delete: protectedProcedure
		.route({
			method: "DELETE",
			path: "/career/answers/{id}",
			tags: ["Career"],
			operationId: "deleteReviewedAnswer",
			summary: "Delete a saved answer without changing submitted copies",
		})
		.input(z.object({ id: z.string().min(1), expectedRevision: z.number().int().positive() }))
		.output(z.void())
		.handler(({ context, input }) => reviewedAnswers.delete(context.user.id, input.id, input.expectedRevision)),
};
