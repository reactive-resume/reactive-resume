import z from "zod";
import { publicProcedure } from "../../context";
import { statisticsService } from "./service";

const githubRouter = {
	getStarCount: publicProcedure
		.route({
			method: "GET",
			path: "/statistics/github/stars",
			tags: ["Platform Statistics"],
			operationId: "getGitHubStarCount",
			summary: "Get GitHub star count",
			description:
				"Returns the number of GitHub stars for the Reactive Resume repository. The count is cached for up to 6 hours and falls back to a last-known value if the GitHub API is unavailable. No authentication required.",
			successDescription: "The number of GitHub stars for the Reactive Resume repository.",
		})
		.input(z.object({}).optional())
		.output(z.number().describe("The number of GitHub stars."))
		.handler(() => statisticsService.github.getStarCount()),
};

export const statisticsRouter = {
	getTotals: publicProcedure
		.route({
			method: "GET",
			path: "/statistics",
			tags: ["Platform Statistics"],
			operationId: "getStatisticsTotals",
			summary: "Get user and resume totals with their cache timestamp",
		})
		.input(z.object({}).optional())
		.output(
			z.object({
				users: z.number(),
				resumes: z.number(),
				cachedAt: z
					.number()
					.nullable()
					.describe("Oldest count's cache timestamp in Unix milliseconds, or null for fallback totals."),
			}),
		)
		.handler(() => statisticsService.getTotals()),
	github: githubRouter,
};
