import { z } from "zod";

export const aiActionSchema = z.enum([
	"provider-test",
	"import-pdf",
	"import-docx",
	"writing-review",
	"improve",
	"parse-posting",
	"autofill-posting",
	"match-score",
	"tailor-resume",
	"draft-message",
	"draft-letter",
	"role-suggestions",
	"fit",
	"briefing",
	"practice",
	"debrief",
	"reply",
	"answer",
	"assistant",
	"career-chat",
	"transcription",
	"speech",
]);
export type AiAction = z.infer<typeof aiActionSchema>;
export const aiOperationIdsSchema = z.array(z.string().min(1).max(64)).max(1000);

export const aiUsageSummarySchema = z.object({
	requests: z.number().int().nonnegative(),
	models: z.array(z.object({ providerId: z.string(), label: z.string(), provider: z.string(), model: z.string() })),
});
export type AiUsageSummary = z.infer<typeof aiUsageSummarySchema>;

export function aiOperationIds(metadata: unknown): string[] {
	if (!metadata || typeof metadata !== "object" || !("aiOperationIds" in metadata)) return [];
	return Array.isArray(metadata.aiOperationIds)
		? metadata.aiOperationIds.filter((id): id is string => typeof id === "string")
		: [];
}

export const aiWeeklyUsageSchema = z.object({
	start: z.date(),
	end: z.date(),
	timezone: z.string(),
	requests: z.number().int().nonnegative(),
	groups: z.array(
		z.object({
			action: aiActionSchema,
			providerId: z.string(),
			label: z.string(),
			provider: z.string(),
			model: z.string(),
			requests: z.number().int().nonnegative(),
		}),
	),
});

export type AiWeeklyUsage = z.infer<typeof aiWeeklyUsageSchema>;

/** Connection totals retain every label/model snapshot, including deleted or renamed connections. */
export function groupAiUsage(report: AiWeeklyUsage) {
	const providers = new Map<
		string,
		{
			providerId: string;
			provider: string;
			labels: string[];
			requests: number;
			groups: AiWeeklyUsage["groups"];
		}
	>();
	for (const group of report.groups) {
		const key = JSON.stringify([group.providerId, group.provider]);
		const provider = providers.get(key) ?? {
			providerId: group.providerId,
			provider: group.provider,
			labels: [],
			requests: 0,
			groups: [],
		};
		if (!provider.labels.includes(group.label)) provider.labels.push(group.label);
		provider.requests += group.requests;
		provider.groups.push(group);
		providers.set(key, provider);
	}
	return [...providers.values()];
}
