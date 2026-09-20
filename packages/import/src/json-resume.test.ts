// biome-ignore-all lint/style/noNonNullAssertion: These tests assert imported section lengths before inspecting the first item.
import { describe, expect, it } from "vitest";
import { parseJSONResume } from "./json-resume";

describe("parseJSONResume", () => {
	it("throws when input is not valid JSON", () => {
		expect(() => parseJSONResume("not json")).toThrow();
	});

	it("throws a serialized validation error for an obviously invalid shape", () => {
		// Email field is validated; a non-email string should fail the loose schema.
		const invalid = JSON.stringify({ basics: { email: "not-an-email" } });
		expect(() => parseJSONResume(invalid)).toThrow();
	});

	it.each(["2024-00", "2024-13", "2024-19", "2024-01-00", "2024-01-32", "2024-1", "2024-1-5"])(
		"rejects the out-of-range date %s instead of importing it as an 'undefined' month",
		(startDate) => {
			const json = JSON.stringify({ work: [{ name: "Acme", position: "Engineer", startDate }] });
			expect(() => parseJSONResume(json)).toThrow(/Must be a valid ISO 8601 date/);
		},
	);

	it.each(["2024", "2024-01", "2024-12", "2024-02-29", "1999-12-31"])(
		"still accepts the valid date %s",
		(startDate) => {
			const json = JSON.stringify({ work: [{ name: "Acme", position: "Engineer", startDate }] });
			expect(() => parseJSONResume(json)).not.toThrow();
		},
	);
	it("imports an empty JSON Resume into a baseline ResumeData", () => {
		const result = parseJSONResume("{}");
		// Defaults preserve a name field even when unset by input.
		expect(typeof result.basics.name).toBe("string");
	});

	it("imports basics fields into ResumeData", () => {
		const json = JSON.stringify({
			basics: {
				name: "Jane Doe",
				label: "Engineer",
				email: "jane@example.com",
				phone: "+1 555 123 4567",
				url: "https://janedoe.dev",
				summary: "Software engineer with 10+ years building products.",
				location: { city: "Berlin", region: "BE", countryCode: "DE" },
			},
		});

		const result = parseJSONResume(json);
		expect(result.basics.name).toBe("Jane Doe");
		expect(result.basics.headline).toBe("Engineer");
		expect(result.basics.email).toBe("jane@example.com");
		expect(result.basics.phone).toBe("+1 555 123 4567");
		expect(result.basics.location).toBe("Berlin, BE, DE");
		expect(result.summary.content).toContain("Software engineer");
		expect(result.summary.hidden).toBe(false);
	});

	it("maps work entries into the experience section", () => {
		const json = JSON.stringify({
			work: [
				{
					name: "Acme Corp",
					position: "Senior Engineer",
					location: "Berlin",
					startDate: "2020-01-15",
					endDate: "2024",
					url: "https://acme.example",
					summary: "Built cool stuff.",
					highlights: ["Shipped X", "Improved Y by 30%"],
				},
				// Entry with neither name nor position is filtered out.
				{ startDate: "2010", endDate: "2015" },
			],
		});

		const result = parseJSONResume(json);
		expect(result.sections.experience.items).toHaveLength(1);

		const item = result.sections.experience.items[0]!;
		expect(item.company).toBe("Acme Corp");
		expect(item.position).toBe("Senior Engineer");
		expect(item.location).toBe("Berlin");
		expect(item.period.length).toBeGreaterThan(0);
		expect(item.description).toContain("Shipped X");
	});

	it("maps education entries (filters when institution is missing)", () => {
		const json = JSON.stringify({
			education: [
				{
					institution: "MIT",
					studyType: "BS",
					area: "Computer Science",
					startDate: "2010",
					endDate: "2014",
					score: "3.9",
					courses: ["Algorithms", "Distributed Systems"],
				},
				{ studyType: "BS" }, // no institution → filtered
			],
		});

		const result = parseJSONResume(json);
		expect(result.sections.education.items).toHaveLength(1);

		const edu = result.sections.education.items[0]!;
		expect(edu.school).toBe("MIT");
		expect(edu.degree).toBe("BS in Computer Science");
		expect(edu.description).toContain("Algorithms");
	});

	it("maps skills with level parsing", () => {
		const json = JSON.stringify({
			skills: [{ name: "TypeScript", level: "Master", keywords: ["node", "react"] }],
		});

		const result = parseJSONResume(json);
		const skill = result.sections.skills.items[0]!;

		expect(skill.name).toBe("TypeScript");
		expect(skill.keywords).toEqual(["node", "react"]);
		expect(skill.level).toBeGreaterThan(0);
	});

	it("maps profiles from basics.profiles into the profiles section", () => {
		const json = JSON.stringify({
			basics: {
				profiles: [
					{ network: "GitHub", username: "janedoe", url: "https://github.com/janedoe" },
					{ username: "no-network" }, // missing network → filtered
				],
			},
		});

		const result = parseJSONResume(json);
		expect(result.sections.profiles.items).toHaveLength(1);

		const profile = result.sections.profiles.items[0]!;
		expect(profile.network).toBe("GitHub");
		expect(profile.username).toBe("janedoe");
	});

	it("imports a picture URL from basics.image", () => {
		const json = JSON.stringify({
			basics: { image: "https://example.com/pic.jpg" },
		});

		const result = parseJSONResume(json);
		expect(result.picture.url).toBe("https://example.com/pic.jpg");
		expect(result.picture.hidden).toBe(false);
	});

	it("leaves the summary content empty when basics.summary is absent", () => {
		const result = parseJSONResume(JSON.stringify({ basics: { name: "Jane" } }));
		expect(result.summary.content).toBe("");
	});

	it("imports projects with description and period", () => {
		const json = JSON.stringify({
			projects: [
				{
					name: "Open source CLI",
					description: "Built a CLI tool",
					highlights: ["10k stars", "Used in production"],
					startDate: "2022",
					endDate: "2023",
					url: "https://github.com/x/y",
				},
				{ description: "no name" }, // filtered
			],
		});

		const result = parseJSONResume(json);
		expect(result.sections.projects.items).toHaveLength(1);

		const project = result.sections.projects.items[0]!;
		expect(project.name).toBe("Open source CLI");
		expect(project.description).toContain("10k stars");
	});
});
