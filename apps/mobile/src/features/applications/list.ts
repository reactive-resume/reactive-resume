import type { ApplicationLane } from "./lanes";
import type { OfferHint } from "./next-step";
import type { ApplicationSummary as Application } from "./types";
import { createDefaultApplicationLanes, resolveLane, visibleLanes } from "./lanes";
import { compareNextStepSortKeys, nextStepSortKey } from "./next-step";
import { LIST_ORDER } from "./stages";

export type ApplicationSort = "updated" | "role" | "next";
export type ApplicationFilters = { search: string; tag: string; showClosed: boolean };

export function filterApplications(applications: readonly Application[], filters: ApplicationFilters) {
	const search = filters.search.trim().toLocaleLowerCase();
	return applications.filter(
		(application) =>
			(filters.showClosed || application.status !== "closed") &&
			(!filters.tag || application.tags.includes(filters.tag)) &&
			(!search ||
				[
					application.role,
					application.company,
					...application.contacts.flatMap((contact) => [contact.name, contact.email]),
				].some((value) => value.toLocaleLowerCase().includes(search))),
	);
}

export function groupApplications(
	applications: readonly Application[],
	sort: ApplicationSort,
	direction: "asc" | "desc",
	now = new Date(),
	lanes: ApplicationLane[] = createDefaultApplicationLanes().map((lane) => ({
		...lane,
		position: LIST_ORDER.indexOf(lane.category),
	})),
	timeZone = "UTC",
	offers?: ReadonlyMap<string, OfferHint>,
) {
	// Next step reads the same keys as web: dated steps soonest first, then the longest wait in the stage.
	const keys = new Map(
		sort === "next"
			? applications.map((application) => [
					application.id,
					nextStepSortKey(
						application,
						now,
						timeZone,
						offers === undefined ? undefined : (offers.get(application.id) ?? null),
					),
				])
			: [],
	);
	const compare = (a: Application, b: Application) => {
		let order: number;
		if (sort === "role") order = a.role.localeCompare(b.role) || a.company.localeCompare(b.company);
		else if (sort === "next") {
			const [rankA, timeA] = keys.get(a.id) ?? [1, 0];
			const [rankB, timeB] = keys.get(b.id) ?? [1, 0];
			return compareNextStepSortKeys([rankA, timeA], [rankB, timeB], a.id, b.id, direction);
		} else order = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
		return (direction === "asc" ? order : -order) || a.id.localeCompare(b.id);
	};
	return visibleLanes(lanes, applications)
		.sort((a, b) => LIST_ORDER.indexOf(a.category) - LIST_ORDER.indexOf(b.category) || a.position - b.position)
		.map((lane) => ({
			status: lane.id,
			lane,
			data: applications.filter((application) => resolveLane(lanes, application).id === lane.id).sort(compare),
		}))
		.filter((group) => group.data.length > 0);
}

/** Hidden/collapsed rows never remain selected for destructive bulk actions. */
export function visibleSelection(
	groups: { status: string; data: Application[] }[],
	collapsed: ReadonlySet<string>,
	selected: ReadonlySet<string>,
) {
	return groups.flatMap((group) =>
		collapsed.has(group.status) ? [] : group.data.filter((item) => selected.has(item.id)).map((item) => item.id),
	);
}
