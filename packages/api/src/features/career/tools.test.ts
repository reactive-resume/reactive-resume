import { expect, it, vi } from "vite-plus/test";

vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("./service", () => ({ careerService: {}, modelFact: vi.fn() }));
const { buildCareerInstructions } = await import("./tools");

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
