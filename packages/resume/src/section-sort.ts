import type { ResumeDates } from "@reactive-resume/schema/resume/dates";
import type { PeriodEndpoint } from "@reactive-resume/schema/resume/period";
import { resumeDatesToPeriod } from "@reactive-resume/schema/resume/dates";
import { isReversedPeriod, parsePeriod } from "@reactive-resume/schema/resume/period";

type SectionItemWithPeriod = {
	id: string;
	period?: string | undefined;
	/** Single-date sections (awards, certifications, publications) keep their legacy text here. */
	date?: string | undefined;
	dates?: ResumeDates | undefined;
};

export type SortSectionItemsByPeriodResult<T> = {
	items: T[];
	unresolvedIds: string[];
};

type SortGroup = "ongoing" | "ended" | "unresolved";

type RankedItem<T> = {
	item: T;
	index: number;
	group: SortGroup;
	start?: PeriodEndpoint;
	end?: PeriodEndpoint;
};

function compareEndpointDescending(left: PeriodEndpoint | undefined, right: PeriodEndpoint | undefined): number {
	if (!left && !right) return 0;
	if (!left) return 1;
	if (!right) return -1;
	if (left.year !== right.year) return right.year - left.year;
	return (right.month ?? 0) - (left.month ?? 0);
}

function rankItem<T extends SectionItemWithPeriod>(item: T, index: number, locale: string): RankedItem<T> {
	const period = item.dates ? resumeDatesToPeriod(item.dates) : parsePeriod(item.period ?? item.date ?? "", locale);
	if (!period?.start || (period.end && isReversedPeriod(period.start, period.end))) {
		return { item, index, group: "unresolved" };
	}

	return {
		item,
		index,
		group: period.ongoing ? "ongoing" : "ended",
		start: period.start,
		...(period.end ? { end: period.end } : {}),
	};
}

const GROUP_RANK: Readonly<Record<SortGroup, number>> = {
	ongoing: 0,
	ended: 1,
	unresolved: 2,
};

function compareRankedItems<T>(left: RankedItem<T>, right: RankedItem<T>): number {
	const groupOrder = GROUP_RANK[left.group] - GROUP_RANK[right.group];
	if (groupOrder !== 0) return groupOrder;

	if (left.group === "ongoing" && right.group === "ongoing") {
		return compareEndpointDescending(left.start, right.start) || left.index - right.index;
	}

	if (left.group === "ended" && right.group === "ended") {
		return (
			compareEndpointDescending(left.end, right.end) ||
			compareEndpointDescending(left.start, right.start) ||
			left.index - right.index
		);
	}

	return left.index - right.index;
}

export function sortSectionItemsByPeriod<T extends SectionItemWithPeriod>(
	items: readonly T[],
	locale: string,
): SortSectionItemsByPeriodResult<T> {
	const rankedItems = items.map((item, index) => rankItem(item, index, locale));

	return {
		items: rankedItems.toSorted(compareRankedItems).map(({ item }) => item),
		unresolvedIds: rankedItems.filter(({ group }) => group === "unresolved").map(({ item }) => item.id),
	};
}
