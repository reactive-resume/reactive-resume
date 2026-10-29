import { beforeAll, describe, expect, it } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { strFromU8, unzipSync } from "fflate";
import { copyCoverLetterStyle } from "@reactive-resume/resume/cover-letter";
import { coverLetterDocumentSchema } from "@reactive-resume/schema/cover-letter/data";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildAccountZip } from "./export";
import { detectImportKind, detectJsonImportKind, parseResumeJson } from "@/features/resume/import/read-file";

beforeAll(() => i18n.loadAndActivate({ locale: "en-US", messages: {} }));

const emptyCareer = {
	profile: { targetRoles: [], locations: [], priorities: "", constraints: "", automaticMemory: true },
	facts: [],
	stories: [],
	artifacts: [],
	schedules: [],
	notifications: [],
	threads: [],
	messages: [],
	attachments: [],
	opportunities: [],
	jobs: [],
	transcripts: [],
};

describe("buildAccountZip", () => {
	it("includes application stage definitions so lane references in applications resolve", () => {
		const pipeline = {
			revision: 2,
			lanes: [{ id: "ghosted", category: "closed", label: "Ghosted", closedReason: "no-response", retiredAt: null }],
		};
		const base = {
			user: {},
			resumes: [],
			coverLetters: [],
			applications: [],
			career: emptyCareer,
			aiContentReports: [],
		};
		const files = unzipSync(buildAccountZip({ ...base, applicationPipeline: pipeline } as never));
		expect(JSON.parse(strFromU8(files["application-stages.json"] ?? new Uint8Array()))).toEqual(pipeline);
		expect(unzipSync(buildAccountZip(base as never))).not.toHaveProperty("application-stages.json");
	});

	it("explains how to restore documents instead of treating an account zip as LinkedIn", async () => {
		const archive = buildAccountZip({
			user: {},
			resumes: [],
			coverLetters: [],
			applications: [],
			career: emptyCareer,
			aiContentReports: [],
		} as never);
		await expect(detectImportKind(new File([new Uint8Array(archive)], "reactive-resume.zip"))).rejects.toThrow(
			"Extract this account archive",
		);
	});
	it("exports individual documents that the importer accepts", () => {
		const files = unzipSync(
			buildAccountZip({
				exportedAt: "2026-09-30T00:00:00.000Z",
				user: {},
				applications: [],
				career: emptyCareer,
				aiContentReports: [],
				resumes: [{ id: "r1", name: "Resume", data: defaultResumeData }],
				coverLetters: [
					{
						id: "l1",
						name: "Letter",
						recipient: "Lumen",
						content: "<p>I am applying.</p>",
						style: copyCoverLetterStyle(defaultResumeData),
					},
				],
			} as never),
		);
		const resumeText = strFromU8(files["resumes/resume-r1.json"] as Uint8Array);
		expect(detectJsonImportKind(JSON.parse(resumeText))).toBe("reactive-resume-json");
		expect(parseResumeJson(resumeText, "reactive-resume-json").basics).toEqual(defaultResumeData.basics);
		const letter = JSON.parse(strFromU8(files["letters/letter-l1.json"] as Uint8Array));
		expect(detectJsonImportKind(letter)).toBe("cover-letter-json");
		expect(coverLetterDocumentSchema.parse(letter).content).toBe("<p>I am applying.</p>");
	});
	it("keeps documents separate and preserves career provenance, conversations and attachment references", () => {
		const zip = buildAccountZip({
			exportedAt: "2026-09-29T00:00:00.000Z",
			user: { id: "u1", name: "Dana" },
			// UUIDv7 ids created seconds apart share their leading (timestamp) characters.
			resumes: [
				{ id: "01a0ec71-03e8-77b1-a5e4-ce04be126204", name: "Product Designer" },
				{ id: "01a0ec71-32c8-728b-b43b-b760a673b825", name: "Product Designer" },
			],
			coverLetters: [{ id: "01a0ec71-a410-71da-9156-b347210cf72b", name: "Product Designer" }],
			applications: [{ id: "app-1", company: "Lumen", role: "Designer" }],
			aiContentReports: [{ id: "report-1", content: "Unsafe generated content", reason: "dangerous" }],
			career: {
				...emptyCareer,
				facts: [
					{
						id: "fact-1",
						text: "I mentored two designers.",
						source: { kind: "user-message", id: "message-1", quote: "I mentored three designers." },
						revisions: [{ text: "I mentored three designers.", at: "2026-09-28T09:00:00Z" }],
					},
				],
				threads: [{ id: "thread-1", scope: "application", applicationId: "app-1" }],
				messages: [
					{
						id: "message-1",
						threadId: "thread-1",
						uiMessage: { role: "user", parts: [{ type: "text", text: "I mentored three designers." }] },
					},
				],
				attachments: [
					{
						id: "attachment-1",
						threadId: "thread-1",
						filename: "notes.txt",
						storageKey: "uploads/u1/agent/thread-1/notes",
						mediaType: "text/plain",
						size: 42,
					},
				],
			},
		} as never);

		const files = unzipSync(zip);
		expect(Object.keys(files).sort()).toEqual([
			"account.json",
			"ai-content-reports.json",
			"applications.json",
			"career.json",
			"letters/product-designer-01a0ec71-a410-71da-9156-b347210cf72b.json",
			"resumes/product-designer-01a0ec71-03e8-77b1-a5e4-ce04be126204.json",
			"resumes/product-designer-01a0ec71-32c8-728b-b43b-b760a673b825.json",
		]);
		expect(JSON.parse(strFromU8(files["account.json"] as Uint8Array))).toEqual({
			exportedAt: "2026-09-29T00:00:00.000Z",
			user: { id: "u1", name: "Dana" },
		});
		expect(JSON.parse(strFromU8(files["applications.json"] as Uint8Array))).toEqual([
			{ id: "app-1", company: "Lumen", role: "Designer" },
		]);
		const career = JSON.parse(strFromU8(files["career.json"] as Uint8Array));
		expect(JSON.parse(strFromU8(files["ai-content-reports.json"] as Uint8Array))).toEqual([
			{ id: "report-1", content: "Unsafe generated content", reason: "dangerous" },
		]);
		expect(career.facts).toEqual([
			{
				id: "fact-1",
				text: "I mentored two designers.",
				source: { kind: "user-message", id: "message-1", quote: "I mentored three designers." },
				revisions: [{ text: "I mentored three designers.", at: "2026-09-28T09:00:00Z" }],
			},
		]);
		expect(career.threads).toEqual([{ id: "thread-1", scope: "application", applicationId: "app-1" }]);
		expect(career.messages[0].uiMessage).toEqual({
			role: "user",
			parts: [{ type: "text", text: "I mentored three designers." }],
		});
		expect(career.attachments).toEqual([
			{
				id: "attachment-1",
				threadId: "thread-1",
				filename: "notes.txt",
				storageKey: "uploads/u1/agent/thread-1/notes",
				mediaType: "text/plain",
				size: 42,
			},
		]);
	});
});
