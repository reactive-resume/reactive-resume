import type { ApplicationSummary as Application } from "./types";
import type { ApplicationStatus } from "@reactive-resume/schema/applications/data";
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
	return LIST_ORDER.map((status) => ({
		status,
		data: applications.filter((application) => application.status === status).sort(compare),
	})).filter((group) => group.data.length > 0);
}

/** Hidden/collapsed rows never remain selected for destructive bulk actions. */
export function visibleSelection(
	groups: { status: ApplicationStatus; data: Application[] }[],
	collapsed: ReadonlySet<ApplicationStatus>,
	selected: ReadonlySet<string>,
) {
	return groups.flatMap((group) =>
		collapsed.has(group.status) ? [] : group.data.filter((item) => selected.has(item.id)).map((item) => item.id),
	);
}
