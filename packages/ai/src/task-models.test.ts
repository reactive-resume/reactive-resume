import { describe, expect, it } from "vite-plus/test";
import { aiConfiguredModels, aiModelForTask, aiTaskForOperation } from "./task-models";

describe("task models", () => {
	it("keeps an existing single model for every task", () => {
		const provider = { model: "gpt-6-luna" };
		expect(aiModelForTask(provider, "fast")).toBe("gpt-6-luna");
		expect(aiModelForTask(provider, "capable")).toBe("gpt-6-luna");
		expect(aiConfiguredModels(provider)).toEqual(["gpt-6-luna"]);
	});

	it("uses a task model only when one was explicitly saved", () => {
		const provider = { model: "gpt-6-luna", fastModel: "gpt-6-nano", capableModel: "gpt-6-astra" };
		expect(aiModelForTask(provider, "fast")).toBe("gpt-6-nano");
		expect(aiModelForTask(provider, "capable")).toBe("gpt-6-astra");
	});

	it("falls back to the main model for the task that has no override", () => {
		const provider = { model: "gpt-6-luna", fastModel: "", capableModel: "gpt-6-astra" };
		expect(aiModelForTask(provider, "fast")).toBe("gpt-6-luna");
		expect(aiModelForTask(provider, "capable")).toBe("gpt-6-astra");
	});

	it("tests every distinct configured model, not repeated ones", () => {
		expect(aiConfiguredModels({ model: "base", fastModel: "fast", capableModel: "capable" })).toEqual([
			"base",
			"fast",
			"capable",
		]);
		expect(aiConfiguredModels({ model: "base", fastModel: "base", capableModel: "capable" })).toEqual([
			"base",
			"capable",
		]);
	});

	it("names the same task for consent as the server routes", () => {
		expect(aiTaskForOperation("ai.improve")).toBe("fast");
		expect(aiTaskForOperation("ai.parsePdf")).toBe("fast");
		expect(aiTaskForOperation("applications.ai.parsePosting")).toBe("fast");
		expect(aiTaskForOperation("agent.messages.send")).toBe("capable");
		expect(aiTaskForOperation("coverLetters.draft")).toBe("capable");
		expect(aiTaskForOperation("applications.ai.draftMessage")).toBe("capable");
		expect(aiTaskForOperation("ai.atsReview")).toBeUndefined();
	});
});
