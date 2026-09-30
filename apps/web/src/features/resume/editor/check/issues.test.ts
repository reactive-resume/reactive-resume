import type { CheckIssue } from "./issues";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { produce } from "immer";
import { lintResumeForAts } from "@reactive-resume/resume/ats";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { buildIssues } from "./issues";

const NOW = new Date("2026-09-28T00:00:00Z");

beforeAll(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

function makeResume(mutate: (data: ResumeData) => void = () => undefined): ResumeData {
	return produce(defaultResumeData, (data) => {
		data.basics.name = "Jordan Reyes";
		data.basics.email = "jordan@reyes.design";
		data.basics.phone = "+49 151 2345 6789";
		data.basics.location = "Berlin";
		data.sections.experience.items = [
			{
				id: "kettle",
				hidden: false,
				company: "Studio Kettle",
				position: "Junior Designer",
				location: "Lisbon",
				period: "2016 - 2019",
				website: { url: "", label: "", inlineLink: false },
				description: "<p>Designed identities for small businesses.</p>",
				roles: [],
			} as ResumeData["sections"]["experience"]["items"][number],
		];
		data.metadata.template = "onyx";
		data.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: [] }];
		mutate(data);
	});
}

const issuesOf = (data: ResumeData) => buildIssues(lintResumeForAts(data, { now: NOW }), data);

const only = (data: ResumeData, code: string): CheckIssue => {
	const issue = issuesOf(data).find((entry) => entry.finding.code === code);
	if (!issue) throw new Error(`No ${code} issue`);
	return issue;
};

/** Applies an issue's one-step fix to the data and returns the result. */
function applyFix(data: ResumeData, issue: CheckIssue) {
	if (issue.fix.kind !== "apply") throw new Error(`${issue.finding.code} has no one-step fix`);
	const { apply } = issue.fix;
	return produce(data, (draft) => {
		apply(draft);
	});
}

describe("buildIssues", () => {
	it("numbers open issues in the report's order and places each on its block", () => {
		const data = makeResume((resume) => {
			resume.basics.email = "";
			const entry = resume.sections.experience.items[0];
			if (entry) entry.period = "a while back";
		});
		const issues = issuesOf(data);

		expect(issues.map((issue) => [issue.number, issue.finding.code])).toEqual([
			[1, "MISSING_EMAIL"],
			[2, "UNPARSEABLE_PERIOD"],
		]);
		expect(issues[0]?.target).toEqual({ kind: "header" });
		expect(issues[1]?.target).toEqual({ kind: "item", sectionId: "experience", itemId: "kettle" });
		expect(issues[1]?.category).toBe("dates");
		expect(issues[1]?.fix).toMatchObject({ kind: "write", target: issues[1]?.target });
	});

	it("adds https:// to a link in one step, and sends links with another scheme to Write", () => {
		const bare = makeResume((resume) => (resume.basics.website.url = "reyes.design"));
		const fixed = applyFix(bare, only(bare, "MALFORMED_URL"));
		expect(fixed.basics.website.url).toBe("https://reyes.design");
		expect(issuesOf(fixed).map((issue) => issue.finding.code)).not.toContain("MALFORMED_URL");

		const odd = makeResume((resume) => (resume.basics.website.url = "ftp:/reyes.design"));
		expect(only(odd, "MALFORMED_URL").fix.kind).toBe("write");
	});

	it("switches a two-column page to one column without losing its sidebar sections", () => {
		const data = makeResume((resume) => {
			resume.metadata.template = "azurill";
			resume.sections.skills.items = [
				{ id: "s1", hidden: false, icon: "", iconColor: "", name: "Figma", proficiency: "", level: 0, keywords: [] },
			];
			resume.metadata.layout.pages = [{ fullWidth: false, main: ["experience"], sidebar: ["skills"] }];
		});
		const issue = only(data, "TWO_COLUMN_LAYOUT");
		expect(issue.keepLabel).toBe(true);
		expect(issue.target).toBeNull();

		const fixed = applyFix(data, issue);
		expect(fixed.metadata.layout.pages).toEqual([{ fullWidth: true, main: ["experience", "skills"], sidebar: [] }]);
		expect(issuesOf(fixed)).toEqual([]);
	});
});
