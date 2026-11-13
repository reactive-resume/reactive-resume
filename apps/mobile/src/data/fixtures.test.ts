jest.mock("@reactive-resume/utils/string", () => ({ escapeHtml: (text: string) => text, generateId: () => "fixture" }));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: () => null, setItemSync: jest.fn(), removeItemSync: jest.fn(), getAllKeysSync: () => [] },
}));
import { computeOutcomes } from "@reactive-resume/schema/applications/outcomes";
import { savedItemDataSchema } from "@reactive-resume/schema/career";
import { coverLetterSchema } from "@reactive-resume/schema/cover-letter/data";
import { resumeDataSchema } from "@reactive-resume/schema/resume/data";
import { storyboardPdfCheck } from "./ats-fixture";
import { seed, fakeBackend, isBusy, invokeFake } from "./fixtures";
test("storyboard and empty-account share real resource shapes and exact displayed identities", async () => {
	seed("storyboard");
	const documents = await fakeBackend.read("documents", {});
	expect(documents.map((row) => row.name)).toEqual([
		"Product designer",
		"Product designer — Lumen",
		"Design lead",
		"Letter for Lumen",
		"Letter for Orbital Health",
	]);
	const resume = await fakeBackend.read("resume", { id: "resume-product" });
	expect(resumeDataSchema.parse(resume.data).basics.name).toBe("Alex Morgan");
	expect(coverLetterSchema.parse(await fakeBackend.read("letter", { id: "letter-0" })).recipientCompany).toBe("Lumen");
	expect(await fakeBackend.read("documents", { trashed: true })).toHaveLength(2);
	expect(isBusy()).toBe(false);
	const check = storyboardPdfCheck("resume.pdf", "");
	expect(check.fullText).toContain("Alex Morgan");
	expect(check.report.file.name).toBe("resume.pdf");
	expect(check.report.document.wordCount).toBeGreaterThan(0);
	seed("empty-account");
	expect(await fakeBackend.read("documents", {})).toEqual([]);
	expect(await fakeBackend.read("applications", {})).toEqual([]);
});

test("storyboard has scoped work, full fit evidence, providers and J4 outcomes", async () => {
	seed("storyboard");
	expect(await fakeBackend.read("account", {})).toMatchObject({ username: "alex", locale: "en-GB" });
	expect((await fakeBackend.read("resume", { id: "resume-product" })).data.sections.skills.items).toHaveLength(8);
	expect((await fakeBackend.read("resume", { id: "resume-product" })).tags).toEqual(["Design"]);
	expect(await fakeBackend.read("aiProviders", {})).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ label: "Ollama on my Mac", baseURL: "http://localhost:11434", testStatus: "failure" }),
		]),
	);
	const apps = await fakeBackend.read("applications", {});
	expect(apps).toHaveLength(18);
	expect(computeOutcomes(apps, () => false)).toMatchObject({
		sent: 18,
		heardBack: 7,
		medianDaysToReply: 6,
		funnel: [{ reached: 18 }, { reached: 7 }, { reached: 3 }, { reached: 1 }],
	});
	expect(
		["Referrals", "Company sites", "Job boards"].map((source) => apps.filter((row) => row.source === source).length),
	).toEqual([3, 6, 9]);
	const fit = await fakeBackend.read("library", { applicationId: "lumen", kind: "fit" });
	expect(fit).toHaveLength(1);
	const result = savedItemDataSchema.parse(fit[0]?.data);
	if (result.kind !== "fit") throw new Error("Expected fit");
	expect(result.requirements).toHaveLength(10);
	expect(result.requirements.filter((row) => row.status !== "missing")).toHaveLength(7);
	expect(await fakeBackend.read("facts", {})).toHaveLength(12);
	expect(await fakeBackend.read("library", { applicationId: "fieldnote", kind: "practice" })).toEqual([]);
	expect(await fakeBackend.read("library", { applicationId: "lumen", kind: "practice" })).toHaveLength(2);
	expect((await fakeBackend.read("library", { applicationId: "lumen", kind: "reply" }))[0]?.title).toBe(
		"Thank-you note to Priya",
	);
	await fakeBackend.write("career.saveWorkspace", { applicationId: "lumen", message: "private draft" }, "storyboard");
	expect((await fakeBackend.read("workspace", { applicationId: "lumen" })).message).toBe("private draft");
	expect((await fakeBackend.read("workspace", { applicationId: "fieldnote" })).message).toBe("");
	const daily = await fakeBackend.read("dailyVisitors", { id: "resume-product", days: 30 });
	expect(daily).toHaveLength(24);
	expect(daily.map((row) => row.views).slice(0, 4)).toEqual([26, 19, 38, 32]);
});

test("fact corrections preserve original and reject stale reviewed values", async () => {
	seed("storyboard");
	const fact = (await fakeBackend.read("facts", {}))[0];
	if (!fact) throw new Error("Missing fact");
	const input = {
		id: fact.id,
		before: { text: fact.text, category: fact.category, applicationId: fact.applicationId },
		text: "Corrected with care",
	};
	await fakeBackend.write("career.correctFact", input, "storyboard");
	expect((await fakeBackend.read("facts", {}))[0]).toMatchObject({
		text: input.text,
		source: fact.source,
		revisions: [{ text: fact.text }],
	});
	await expect(fakeBackend.write("career.correctFact", input, "storyboard")).rejects.toThrow("changed");
});

test("public fixture password gates visitor data and is cleared by fixture reset", async () => {
	seed("storyboard");
	const input = { username: "alex", slug: "product-designer" };
	await fakeBackend.write("resume.setPassword", { id: "resume-product", password: "sample-password" }, "storyboard");
	await expect(fakeBackend.read("publicResume", input)).rejects.toMatchObject({ code: "NEED_PASSWORD" });
	expect(await invokeFake("resume.verifyPassword", { ...input, password: "wrong" })).toBe(false);
	expect(await invokeFake("resume.verifyPassword", { ...input, password: "sample-password" })).toBe(true);
	expect(await fakeBackend.read("publicResume", input)).toMatchObject({ name: "" });
	seed("storyboard");
	expect(await fakeBackend.read("publicResume", input)).toMatchObject({ name: "" });
});
test("lane mutations require reviewed revision and preserve category when retiring", async () => {
	seed("storyboard");
	const pipeline = await fakeBackend.read("lanes", {});
	await fakeBackend.write(
		"applications.lanes.create",
		{
			expectedRevision: pipeline.revision,
			label: "Portfolio review",
			category: "interview",
			color: pipeline.lanes[0]?.color,
		},
		"storyboard",
	);
	await expect(
		fakeBackend.write("applications.lanes.reorder", { expectedRevision: 0, ids: [] }, "storyboard"),
	).rejects.toMatchObject({ code: "CONFLICT" });
	const next = await fakeBackend.read("lanes", {});
	const created = next.lanes.find((row) => row.label === "Portfolio review");
	await expect(
		fakeBackend.write(
			"applications.lanes.retire",
			{ expectedRevision: next.revision, id: created?.id, replacementId: "saved" },
			"storyboard",
		),
	).rejects.toThrow("matching");
	await fakeBackend.write(
		"applications.lanes.retire",
		{ expectedRevision: next.revision, id: created?.id, replacementId: "interview" },
		"storyboard",
	);
	expect((await fakeBackend.read("lanes", {})).lanes.find((row) => row.id === created?.id)?.retiredAt).toBeInstanceOf(
		Date,
	);
});
