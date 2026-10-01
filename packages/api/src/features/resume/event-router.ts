import { eventIterator } from "@orpc/server";
import z from "zod";
import { protectedProcedure } from "../../context";
import { subscribeResumeUpdated } from "./events";
import { resumeService } from "./service";

export const updatesRouter = {
	subscribe: protectedProcedure
		.route({
			method: "GET",
			path: "/resumes/{id}/updates",
			tags: ["Resumes"],
			operationId: "subscribeResumeUpdates",
			summary: "Subscribe to resume updates",
			description:
				"Streams lightweight invalidation events when the specified resume changes. The event payload contains metadata only; clients should refetch the resume for canonical data.",
			successDescription: "A stream of resume update invalidation events.",
		})
		.input(z.object({ id: z.string().describe("The unique identifier of the resume.") }))
		.output(
			eventIterator(
				z.object({
					type: z.literal("resume.updated"),
					resumeId: z.string(),
					userId: z.string(),
					updatedAt: z.string(),
					mutation: z.enum(["sync", "create", "update", "patch", "lock", "password", "delete"]),
				}),
			),
		)
		.handler(async function* ({ context, input, signal }) {
			const resume = await resumeService.getById({ id: input.id, userId: context.user.id });

			yield {
				type: "resume.updated" as const,
				resumeId: input.id,
				userId: context.user.id,
				updatedAt: resume.updatedAt.toISOString(),
				mutation: "sync" as const,
			};

			yield* subscribeResumeUpdated({
				resumeId: input.id,
				userId: context.user.id,
				...(signal ? { signal } : {}),
			});
		}),
};
