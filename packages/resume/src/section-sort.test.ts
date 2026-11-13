import { describe, expect, it } from "vite-plus/test";
import { sortSectionItemsByPeriod } from "./section-sort";

type Item = {
	id: string;
	period: string;
};

type DatedItem = {
	id: string;
	date?: string;
	dates?: { start: string | null; end: string | null; present: boolean };
};

const item = (id: string, period: string): Item => ({ id, period });
const dateItem = (id: string, date: string): DatedItem => ({ id, date });
const ids = (items: readonly { id: string }[]) => items.map(({ id }) => id);

describe("sortSectionItemsByPeriod", () => {
	it("orders ongoing, ended, equal, and unresolved periods by the documented total order", () => {
		const equalFirst = item("equal-first", "2020 - 2023");
		const equalSecond = item("equal-second", "2020 - 2023");
		const input = [
			item("blank", ""),
			equalFirst,
			item("ended-2024", "2020 - 2024"),
			item("ongoing-2020", "2020 - Present"),
			item("prose", "A long time ago"),
			item("ended-2025", "2022 - 2025"),
			equalSecond,
			item("ongoing-2024", "January 2024 - Present"),
			item("reversed", "2025 - 2024"),
		];

		const result = sortSectionItemsByPeriod(input, "en-US");

		expect(ids(result.items)).toEqual([
			"ongoing-2024",
			"ongoing-2020",
			"ended-2025",
			"ended-2024",
			"equal-first",
			"equal-second",
			"blank",
			"prose",
			"reversed",
		]);
		expect(result.unresolvedIds).toEqual(["blank", "prose", "reversed"]);
	});

	it("uses locale-aware months and ranks year precision below a known month in the same year", () => {
		const input = [
			item("year-only-end", "2020 - 2024"),
			item("localized-march", "janvier 2020 - mars 2024"),
			item("localized-february", "janvier 2020 - février 2024"),
		];

		const result = sortSectionItemsByPeriod(input, "fr-FR");

		expect(ids(result.items)).toEqual(["localized-march", "localized-february", "year-only-end"]);
		expect(result.unresolvedIds).toEqual([]);
	});

	it("ranks missing end points after known end points, then compares known starts", () => {
		const input = [item("single-2025", "2025"), item("ended-2020", "2019 - 2020"), item("single-2024", "2024")];

		const result = sortSectionItemsByPeriod(input, "en-US");

		expect(ids(result.items)).toEqual(["ended-2020", "single-2025", "single-2024"]);
	});

	it("sorts single-date entries from their date text when structured dates are missing", () => {
		const input = [dateItem("older", "2018"), dateItem("newest", "March 2021"), dateItem("middle", "2020")];

		const result = sortSectionItemsByPeriod(input, "en-US");

		expect(ids(result.items)).toEqual(["newest", "middle", "older"]);
		expect(result.unresolvedIds).toEqual([]);
	});

	it("keeps single-date entries with unreadable dates at the end and reports them", () => {
		const input = [dateItem("blank", ""), dateItem("newer", "2024"), dateItem("prose", "Forthcoming")];

		const result = sortSectionItemsByPeriod(input, "en-US");

		expect(ids(result.items)).toEqual(["newer", "blank", "prose"]);
		expect(result.unresolvedIds).toEqual(["blank", "prose"]);
	});

	it("uses structured dates over legacy text, keeps ties stable, and leaves input untouched", () => {
		const input: DatedItem[] = [
			{ id: "older", date: "2026", dates: { start: "2020", end: null, present: false } },
			{ id: "cleared", date: "2026", dates: { start: null, end: null, present: false } },
			dateItem("first-march", "mars 2024"),
			{ id: "second-march", dates: { start: "2024-03", end: null, present: false } },
			dateItem("year-only", "2024"),
		];
		const before = structuredClone(input);

		const result = sortSectionItemsByPeriod(input, "fr-FR");

		expect(ids(result.items)).toEqual(["first-march", "second-march", "year-only", "older", "cleared"]);
		expect(result.unresolvedIds).toEqual(["cleared"]);
		expect(input).toEqual(before);
		expect(result.items[0]).toBe(input[2]);
	});
});
