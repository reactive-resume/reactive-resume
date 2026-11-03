import { expect, it } from "vite-plus/test";
import { groupAiUsage } from "./ai-usage";

it("totals stable connections across renamed labels without merging another connection", () => {
	const row = {
		action: "reply" as const,
		providerId: "a",
		provider: "openai",
		label: "Old",
		model: "fast",
		requests: 2,
	};
	const groups = [
		row,
		{ ...row, label: "Renamed", model: "capable", requests: 3 },
		{ ...row, providerId: "b", requests: 1 },
	];
	const providers = groupAiUsage({ start: new Date(), end: new Date(), timezone: "UTC", requests: 6, groups });
	expect(providers.map(({ requests, labels }) => ({ requests, labels }))).toEqual([
		{ requests: 5, labels: ["Old", "Renamed"] },
		{ requests: 1, labels: ["Old"] },
	]);
	expect(providers[0]?.groups).toEqual(groups.slice(0, 2));
});
