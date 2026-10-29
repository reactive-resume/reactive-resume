import type { ApplicationLane } from "./lanes";
import type { ApplicationSummary as Application } from "./types";
import { createDefaultApplicationLanes, resolveLane, visibleLanes } from "./lanes";
import { getNextStep } from "./next-step";
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
) {
	const nextTime = (application: Application) => {
		const step = getNextStep(application, now);
		return step.kind === "interview" || step.kind === "follow-up" ? step.at.getTime() : Infinity;
	};
	const compare = (a: Application, b: Application) => {
		const left = sort === "next" ? nextTime(a) : new Date(a.updatedAt).getTime();
		const right = sort === "next" ? nextTime(b) : new Date(b.updatedAt).getTime();
		const order =
			sort === "role"
				? a.role.localeCompare(b.role) || a.company.localeCompare(b.company)
				: left === right
					? 0
					: left < right
						? -1
						: 1;
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
