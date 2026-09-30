import { describe, expect, it } from "vitest";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { redactResumeForViewer } from "../features/resume/access-policy";
import { resumeDto } from "./resume";

describe("resume DTO output validation", () => {
	it.each([false, true])("accepts showDownloadButtons=%s in a partial update", (showDownloadButtons) => {
		expect(resumeDto.update.input.parse({ id: "resume-id", showDownloadButtons })).toEqual({
			id: "resume-id",
			showDownloadButtons,
		});
	});

	it("leaves the download preference absent from unrelated updates", () => {
		expect(resumeDto.update.input.parse({ id: "resume-id", name: "Renamed" })).not.toHaveProperty(
			"showDownloadButtons",
		);
	});

	it("normalizes ordinary PUT data without losing compatible custom-section overlap", () => {
		const parsed = resumeDto.update.input.parse({
			id: "resume-id",
			data: {
				...structuredClone(defaultResumeData),
				customSections: [
					{
						id: "custom-experience",
						type: "experience",
						title: "Experience",
						icon: "",
						columns: 1,
						hidden: false,
						keepTogether: false,
						startOnNewPage: false,
						items: [
							{
								id: "experience-item",
								hidden: false,
								company: "Analytical Engines",
								position: "Programmer",
								location: "London",
								period: "1842–1843",
								description: "<p>Wrote the first algorithm.</p>",
								content: "<p>Compatible overlap</p>",
							},
						],
					},
				],
			},
		});

		expect(parsed.data?.customSections[0]?.items[0]).toMatchObject({
			content: "<p>Compatible overlap</p>",
			roles: [],
			website: { url: "", label: "", inlineLink: false },
		});
	});

	it("rejects renderer-unsafe custom sections before update or import persistence", () => {
		const data = {
			...defaultResumeData,
			customSections: [
				{
					id: "custom-experience",
					type: "experience",
					title: "Experience",
					icon: "",
					columns: 1,
					hidden: false,
					keepTogether: false,
					startOnNewPage: false,
					items: [{ id: "summary-item", hidden: false, content: "<p>Not an experience item</p>" }],
				},
			],
		};

		expect(resumeDto.update.input.safeParse({ id: "resume-id", data }).success).toBe(false);
		expect(resumeDto.import.input.safeParse({ data }).success).toBe(false);
	});

	it("rejects invalid imported stylesheet structure at the schema boundary", () => {
		expect(
			resumeDto.import.input.safeParse({
				data: {
					...defaultResumeData,
					metadata: {
						...defaultResumeData.metadata,
						stylesheet: { invalid: true },
					},
				},
			}).success,
		).toBe(false);
	});

	it("does not let otherwise-invalid imports bypass validation without a stylesheet field", () => {
		expect(resumeDto.import.input.safeParse({ data: { metadata: {} } }).success).toBe(false);
	});

	it("accepts public resume responses after owner-only fields are redacted", () => {
		const dbResume = {
			id: "019e128d-0598-75d2-ae6a-771e2eb84614",
			userId: "019bef93-a165-72cb-9c0e-d96e00000000",
			name: "Armed Amaranth Catshark",
			slug: "armed-amaranth-catshark",
			tags: [],
			data: {
				...defaultResumeData,
				metadata: {
					...defaultResumeData.metadata,
					notes: "owner-only notes",
				},
			},
			isPublic: true,
			isLocked: false,
			showDownloadButtons: true,
			hasPassword: false,
		};

		const publicResume = {
			...redactResumeForViewer(dbResume, false),
			hasPassword: dbResume.hasPassword,
		};

		expect(publicResume.name).toBe("Resume");
		expect(publicResume.data.metadata.notes).toBe("");
		expect(resumeDto.getBySlug.output.safeParse(publicResume).success).toBe(true);
	});

	it("exposes canonical stylesheet source in authorized public data", () => {
		const source = { languageVersion: 1, text: "@version 1;\nresume { color: red; }\n" };
		const parsed = resumeDto.getBySlug.output.parse({
			id: "019e128d-0598-75d2-ae6a-771e2eb84614",
			name: "Resume",
			slug: "resume",
			tags: [],
			data: redactResumeForViewer(
				{
					name: "Owner title",
					data: {
						...defaultResumeData,
						metadata: {
							...defaultResumeData.metadata,
							stylesheet: { mode: "semantic", source },
						},
					},
				},
				false,
			).data,
			isPublic: true,
			isLocked: false,
			showDownloadButtons: true,
			hasPassword: false,
		});

		expect(parsed.data.metadata.stylesheet).toEqual({ mode: "semantic", source });
	});

	it("returns the ordinary resume contract on version restore", () => {
		const resume = {
			id: "019e128d-0598-75d2-ae6a-771e2eb84614",
			name: "Resume",
			slug: "resume",
			tags: [],
			data: defaultResumeData,
			isPublic: false,
			isLocked: false,
			showDownloadButtons: true,
			updatedAt: new Date("2026-01-01T00:00:00Z"),
			critiqueEnabled: false,
			hasPassword: false,
			hasCritiquePassword: false,
		};
		expect(resumeDto.restoreVersion.output.parse(resume)).toEqual(resume);
	});
});

describe("resume DTO write bounds", () => {
	it.each(["update", "import"] as const)("rejects invalid template in %s input before normalization", (operation) => {
		const data = { ...defaultResumeData, metadata: { ...defaultResumeData.metadata, template: "unknown-template" } };
		expect(resumeDto[operation].input.safeParse({ id: "resume-id", data }).success).toBe(false);
	});

	it("continues to accept metadata-only updates without resume data", () => {
		expect(resumeDto.update.input.parse({ id: "resume-id", name: "Renamed" })).toEqual({
			id: "resume-id",
			name: "Renamed",
		});
	});
});
