import type { ResumeData } from "./data";
import { describe, expect, it } from "vite-plus/test";
import { parseResumeData } from "./data";
import {
	formatResumeDates,
	formatYearMonth,
	getPresentLabel,
	inferDateFormat,
	readLegacyDates,
	syncResumeDates,
} from "./dates";
import { defaultResumeData } from "./default";

const range = (text: string, locale = "en-US") => readLegacyDates(text, { locale, single: false });
const single = (text: string, locale = "en-US") => readLegacyDates(text, { locale, single: true });

describe("readLegacyDates", () => {
	it.each([
		["March 2022 - Present", { start: "2022-03", end: null, present: true }],
		["Mar 2020 – Dec 2021", { start: "2020-03", end: "2021-12", present: false }],
		["2014 - 2018", { start: "2014", end: "2018", present: false }],
		["03/2020 - 06/2021", { start: "2020-03", end: "2021-06", present: false }],
		["2020-03 to 2021-06", { start: "2020-03", end: "2021-06", present: false }],
		["2024 - 2020", { start: "2024", end: "2020", present: false }],
		["2019", { start: "2019", end: null, present: false }],
	])("reads %j exactly, with no review flag", (text, expected) => {
		expect(range(text)).toEqual(expected);
	});

	it("reads month names and 'Present' in the resume's own locale", () => {
		expect(range("janvier 2020 - aujourd'hui", "fr-FR")).toEqual({ start: "2020-01", end: null, present: true });
		expect(range("März 2021 – heute", "de-DE")).toEqual({ start: "2021-03", end: null, present: true });
	});

	it.each([
		["Summer 2016 - 2018", { start: "2016-06", end: "2018", present: false }],
		["15/03/2020 - 2021", { start: "2020-03", end: "2021", present: false }],
		["March 3, 2020 - Present", { start: "2020-03", end: null, present: true }],
	])("keeps approximate text %j for a review", (text, expected) => {
		expect(range(text)).toEqual({ ...expected, raw: text });
	});

	it("keeps unreadable text as written, with no dates", () => {
		expect(range("Sometime in college")).toEqual({
			start: null,
			end: null,
			present: false,
			raw: "Sometime in college",
		});
	});

	it("reads nothing from empty text and doesn't flag it", () => {
		expect(range("   ")).toEqual({ start: null, end: null, present: false });
	});

	it("reads single dates for awards, certifications and publications", () => {
		expect(single("June 2021")).toEqual({ start: "2021-06", end: null, present: false });
		expect(single("2021-06-14")).toEqual({ start: "2021-06", end: null, present: false, raw: "2021-06-14" });
		expect(single("Spring term")).toEqual({ start: null, end: null, present: false, raw: "Spring term" });
	});
});

describe("inferDateFormat", () => {
	it("follows how most dates were typed", () => {
		expect(inferDateFormat(["March 2020 - Present", "January 2018 - February 2020"], "en-US")).toBe("long");
		expect(inferDateFormat(["Mar 2020 - Present", "Sept 2019 - Dec 2019"], "en-US")).toBe("short");
		expect(inferDateFormat(["03/2020 - 06/2021"], "en-US")).toBe("numeric");
		expect(inferDateFormat(["2020-03 - 2021-06"], "en-US")).toBe("iso");
	});
});

describe("getPresentLabel", () => {
	it("uses the translation when there is one, else the language's usual word", () => {
		expect(getPresentLabel("en-US")).toBe("Present");
		expect(getPresentLabel("de-DE")).toBe("Heute");
		expect(getPresentLabel("xx-XX")).toBe("Present");
	});

	it("reads a malformed locale tag by its language instead of throwing", () => {
		expect(getPresentLabel("de-DE-")).toBe("Heute");
	});
});

describe("upgradeResumeDates", () => {
	const withExperience = (period: string) => {
		const data = structuredClone(defaultResumeData);
		// Saved before structured dates: no date format yet.
		delete data.metadata.page.dateFormat;
		data.sections.experience.items = [
			{
				id: "job",
				hidden: false,
				company: "Lumen",
				position: "Designer",
				location: "",
				period,
				website: { url: "", label: "", inlineLink: false },
				description: "",
				roles: [{ id: "role", position: "Lead", period: "Jan 2023 - Present", description: "" }],
			},
		];
		return data;
	};

	it("fills dates on entries and their roles, and the format from how they were typed", () => {
		const data = parseResumeData(withExperience("January 2020 - March 2022"));
		const [job] = data.sections.experience.items;

		expect(job?.dates).toEqual({ start: "2020-01", end: "2022-03", present: false });
		expect(job?.roles[0]?.dates).toEqual({ start: "2023-01", end: null, present: true });
		expect(data.metadata.page.dateFormat).toBe("long");
	});

	it("is idempotent and never overwrites existing dates", () => {
		const once = parseResumeData(withExperience("2020 - 2022"));
		const [job] = once.sections.experience.items;
		if (!job) throw new Error("Missing entry.");
		job.dates = { start: "2019-05", end: null, present: true };

		const twice = parseResumeData(JSON.parse(JSON.stringify(once)));
		const thrice = parseResumeData(JSON.parse(JSON.stringify(twice)));

		expect(twice.sections.experience.items[0]).toMatchObject({
			dates: { start: "2019-05", end: null, present: true },
			period: "May 2019 – Present",
		});
		expect(thrice).toEqual(twice);
	});
});

describe("formatYearMonth", () => {
	it.each([
		["short", "en-US", "Mar 2022"],
		["long", "en-US", "March 2022"],
		["numeric", "en-US", "03/2022"],
		["iso", "en-US", "2022-03"],
		["long", "de-DE", "März 2022"],
		["short", "fr-FR", "mars 2022"],
	] as const)("prints 2022-03 as %s in %s", (format, locale, expected) => {
		expect(formatYearMonth("2022-03", { locale, format })).toBe(expected);
	});

	it.each([
		["ar-SA", "short", "٢٠١٩"],
		["fa-IR", "long", "۲۰۱۹"],
		["ja-JP", "short", "2019"],
		["en-US", "long", "2019"],
		["ar-SA", "iso", "2019"],
		["ar-SA", "numeric", "2019"],
	] as const)("prints a year-only date in %s (%s) in its month dates' digits", (locale, format, expected) => {
		expect(formatYearMonth("2019", { locale, format })).toBe(expected);
	});
});

describe("formatResumeDates", () => {
	const options = { locale: "en-US", format: "short" } as const;

	it("prints ranges, ongoing entries and single dates", () => {
		expect(formatResumeDates({ start: "2022-03", end: null, present: true }, options)).toBe("Mar 2022 – Present");
		expect(formatResumeDates({ start: "2014", end: "2018", present: false }, options)).toBe("2014 – 2018");
		expect(formatResumeDates({ start: "2021-06", end: null, present: false }, options)).toBe("Jun 2021");
		expect(formatResumeDates({ start: null, end: null, present: false }, options)).toBe("");
	});
});

describe("syncResumeDates", () => {
	const resume = (period: string) => {
		const data = structuredClone(defaultResumeData);
		data.metadata.page.dateFormat = "short";
		data.sections.experience.items = [
			{
				id: "job",
				hidden: false,
				company: "Lumen",
				position: "Designer",
				location: "",
				period,
				website: { url: "", label: "", inlineLink: false },
				description: "",
				roles: [],
			},
		];
		data.sections.awards.items = [
			{
				id: "award",
				hidden: false,
				title: "Best in show",
				awarder: "",
				date: "June 2021",
				website: { url: "", label: "", inlineLink: false },
				description: "",
			},
		];
		return data;
	};

	const job = (data: ResumeData) => data.sections.experience.items[0];

	it("gives entries without dates their dates, and rewrites the text from them", () => {
		const data = resume("March 2022 - Present");
		syncResumeDates(data);

		expect(job(data)?.dates).toEqual({ start: "2022-03", end: null, present: true });
		expect(job(data)?.period).toBe("Mar 2022 – Present");
		expect(data.sections.awards.items[0]).toMatchObject({ date: "Jun 2021", dates: { start: "2021-06" } });
	});

	it("rewrites the text when the dates change (dates are the source of truth)", () => {
		const previous = parseResumeData(resume("2020 - 2022"));
		syncResumeDates(previous);
		const next = structuredClone(previous);
		const entry = job(next);
		if (!entry) throw new Error("Missing entry.");
		entry.dates = { start: "2019-04", end: null, present: true };

		syncResumeDates(next);

		expect(job(next)?.period).toBe("Apr 2019 – Present");
	});

	it("overwrites an edit to the text alone: the dates are the only source", () => {
		const previous = parseResumeData(resume("2020 - 2022"));
		syncResumeDates(previous);
		const next = structuredClone(previous);
		const entry = job(next);
		if (!entry) throw new Error("Missing entry.");
		entry.period = "Jan 2018 - Present";

		syncResumeDates(next);

		expect(job(next)?.dates).toEqual({ start: "2020", end: "2022", present: false });
		expect(job(next)?.period).toBe("2020 – 2022");
	});

	it("reformats every entry when the locale or format changes, without reading the text again", () => {
		const previous = parseResumeData(resume("March 2022 - Present"));
		syncResumeDates(previous);
		const next = structuredClone(previous);
		next.metadata.page.locale = "ja-JP";
		next.metadata.page.dateFormat = "long";

		syncResumeDates(next);

		expect(job(next)?.dates).toEqual({ start: "2022-03", end: null, present: true });
		expect(job(next)?.period).toBe(
			`2022年3月 – ${formatResumeDates({ start: null, end: null, present: true }, { locale: "ja-JP" })}`,
		);
	});

	it.each(["During university / bis heute", "March 2022 - Present", "  Frühjahr — heute  "])(
		"preserves custom text %j through save/reopen and locale/format changes",
		(raw) => {
			const data = parseResumeData(resume("2020 - 2022"));
			const entry = job(data);
			if (!entry) throw new Error("Missing entry.");
			entry.dates = { ...readLegacyDates(raw, { locale: "en-US", single: false }), raw };
			const award = data.sections.awards.items[0];
			if (!award) throw new Error("Missing award.");
			award.dates = { start: null, end: null, present: false, raw };
			data.metadata.page.locale = "de-DE";
			data.metadata.page.dateFormat = "iso";
			const reopened = parseResumeData(JSON.parse(JSON.stringify(data)));
			expect(job(reopened)?.period).toBe(raw);
			expect(job(reopened)?.dates).toEqual(entry.dates);
			expect(reopened.sections.awards.items[0]?.date).toBe(raw);
		},
	);

	it("leaves text it couldn't read untouched, and is idempotent", () => {
		const data = resume("Summer 2016 - 2018");
		syncResumeDates(data);
		const once = structuredClone(data);
		syncResumeDates(data);

		expect(job(data)?.period).toBe("Summer 2016 - 2018");
		expect(job(data)?.dates?.raw).toBe("Summer 2016 - 2018");
		expect(data).toEqual(once);
	});
});
