import { expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
const saveStory = vi.fn();
vi.mock("./service", () => ({ careerService: { saveStory }, modelFact: vi.fn() }));
const { buildCareerInstructions, buildCareerTools } = await import("./tools");

it("names the application's role and company only when the user shares the application", () => {
	const context = {
		application: { role: "Staff Engineer", company: "Acme Robotics" },
		profile: { memoryMode: "off" },
		facts: [],
		stories: [],
	} as unknown as Parameters<typeof buildCareerInstructions>[0]["context"];
	const instructions = (shareApplication: boolean) =>
		buildCareerInstructions({ context, shareApplication, shareMemory: false, tab: undefined });

	expect(instructions(false)).not.toMatch(/Staff Engineer|Acme Robotics/);
	expect(instructions(true)).toContain("Staff Engineer at Acme Robotics");
});

it("keeps placeholder-like text in a value as plain text", () => {
	const context = {
		application: { role: "Engineer {{CONTEXT}}", company: "Acme $& Co" },
		profile: { memoryMode: "off" },
		facts: [],
		stories: [],
	} as unknown as Parameters<typeof buildCareerInstructions>[0]["context"];
	const instructions = buildCareerInstructions({ context, shareApplication: true, shareMemory: false, tab: undefined });

	expect(instructions).toContain("Engineer {{CONTEXT}} at Acme $& Co");
});

it("gives the coach this application's answers, newest offer and last replies only when it is shared", () => {
	const context = {
		application: { id: "a1", role: "Staff Engineer", company: "Acme Robotics" },
		profile: { memoryMode: "off" },
		facts: [],
		stories: [],
	} as unknown as Parameters<typeof buildCareerInstructions>[0]["context"];
	const items = [
		{ id: "r1", applicationId: "a1", createdAt: new Date("2026-10-30"), data: { kind: "reply", title: "Invite" } },
		{ id: "r2", applicationId: "a1", createdAt: new Date("2026-10-29"), data: { kind: "reply", title: "Older" } },
		{ id: "r3", applicationId: "a1", createdAt: new Date("2026-10-28"), data: { kind: "reply", title: "Oldest" } },
		{ id: "o1", applicationId: "a1", createdAt: new Date("2026-10-27"), data: { kind: "offer", base: 82000 } },
	] as unknown as NonNullable<Parameters<typeof buildCareerInstructions>[0]["items"]>;
	const answers = [{ question: "Describe reliability work", answer: "I ran SLO reviews." }];

	const shared = buildCareerInstructions({
		context,
		shareApplication: true,
		shareMemory: false,
		tab: "apply",
		items,
		answers,
	});
	expect(shared).toContain("Describe reliability work");
	expect(shared).toContain("I ran SLO reviews.");
	expect(shared).toContain('"base":82000');
	expect(shared).toContain("Invite");
	expect(shared).toContain("Older");
	expect(shared).not.toContain("Oldest");

	const hidden = buildCareerInstructions({
		context,
		shareApplication: false,
		shareMemory: false,
		tab: "apply",
		items,
		answers,
	});
	expect(hidden).not.toContain("Describe reliability work");
	expect(hidden).not.toContain('"base":82000');
});

it("updates a saved story only when it hasn't changed since the proposal read it", async () => {
	const updatedAt = new Date("2026-11-01T10:00:00Z");
	const context = {
		application: null,
		profile: { memoryMode: "off" },
		facts: [],
		stories: [{ id: "story-1", applicationId: null, updatedAt, data: {} }],
		memoryVersion: "v1",
	} as unknown as Parameters<typeof buildCareerTools>[0]["context"];
	const tools = buildCareerTools({
		userId: "alice",
		context,
		shareApplication: false,
		shareMemory: true,
		tab: undefined,
		sourceMessageId: undefined,
	});
	const execute = tools.save_story?.execute as (input: Record<string, unknown>, options: unknown) => Promise<unknown>;
	const story = {
		title: "Checkout",
		situation: "S",
		task: "T",
		action: "A",
		result: "",
		reflection: "",
		tags: [],
		factIds: ["fact-1"],
	};
	saveStory.mockResolvedValue({ id: "story-1", applicationId: null, updatedAt: new Date(), data: story });

	await expect(execute({ ...story, id: "story-1", basedOn: "2026-10-30T09:00:00.000Z" }, {})).rejects.toThrow(
		/changed after this proposal/,
	);
	await expect(execute({ ...story, id: "story-1" }, {})).rejects.toThrow(/changed after this proposal/);
	expect(saveStory).not.toHaveBeenCalled();

	await execute({ ...story, id: "story-1", basedOn: updatedAt.toISOString() }, {});
	expect(saveStory).toHaveBeenCalledWith("alice", { ...story, applicationId: null }, "story-1", "v1");
});
