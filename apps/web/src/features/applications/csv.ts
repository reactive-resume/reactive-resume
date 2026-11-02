import type { ApplicationLane } from "./lanes";
import type { Application } from "./types";
import { csvCell } from "@reactive-resume/schema/applications/csv";
import { INTERVIEW_KINDS, STAGES } from "@reactive-resume/schema/applications/data";
import { getApplicationLane } from "@reactive-resume/schema/applications/lanes";
import { applicationSentAt } from "@reactive-resume/schema/applications/outcomes";

const stageName = (stage: Application["status"]) => STAGES.find((item) => item.value === stage)?.label ?? stage;

export type ApplicationExportOptions = {
	scope: "filtered" | "all";
	from?: string;
	to?: string;
};

export function selectApplicationsForExport(
	applications: readonly Application[],
	filtered: readonly Application[],
	{ scope, from, to }: ApplicationExportOptions,
): Application[] {
	return (scope === "all" ? applications : filtered).filter((application) => {
		if (!from && !to) return true;
		const sent = applicationSentAt(application);
		if (!sent) return false;
		const date = new Date(application.appliedAt).toISOString().slice(0, 10);
		return (!from || date >= from) && (!to || date <= to);
	});
}

/** `lanes` adds each application's lane; Stage stays the standard step, so older importers keep working. */
export function exportApplicationsCsv(
	applications: readonly Application[],
	lanes: readonly ApplicationLane[] = [],
): string {
	const headers = [
		"Company",
		"Role",
		"Stage",
		"Lane",
		"Lane Category",
		"Lane Closed Reason",
		"Stage Date",
		"Application Date",
		"Location",
		"Salary",
		"Source",
		"URL",
		"Job Description",
		"Posting Source",
		"Tags",
		"Contacts",
		"Notes",
		"Closed Reason",
		"Stage History",
		"Timeline",
		"Created At",
		"Updated At",
	];
	const dateOnly = (date: Date) => new Date(date).toISOString().slice(0, 10);
	const stageLabel = stageName;
	const timelineText = (entry: Application["activity"][number]) => {
		if (entry.type === "stage") {
			const label = entry.laneLabel ?? stageLabel(entry.stage);
			return entry.dateUnknown ? `Imported in ${label}; stage date not recorded` : label;
		}
		if (entry.type === "note") return entry.text;
		const kind = INTERVIEW_KINDS.find((item) => item.value === entry.kind)?.label ?? entry.kind;
		return `${kind} interview (${new Date(entry.at).toISOString()})`;
	};
	const rows = applications.map((application) => {
		const sent = applicationSentAt(application);
		const timeline = [...application.activity].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
		const stages = timeline.filter((entry) => entry.type === "stage");
		const currentStage = stages.findLast((entry) => entry.stage === application.status);
		const lane = lanes.length > 0 ? getApplicationLane(lanes, application) : null;
		return [
			application.company,
			application.role,
			application.status,
			lane ? (lane.label ?? stageLabel(lane.category)) : "",
			lane?.category ?? "",
			lane?.closedReason ?? "",
			currentStage && !currentStage.dateUnknown ? dateOnly(currentStage.at) : "",
			sent ? dateOnly(application.appliedAt) : "",
			application.location ?? "",
			application.salary ?? "",
			application.source ?? "",
			application.sourceUrl ?? "",
			application.jobDescription ?? "",
			application.postingSource ? JSON.stringify(application.postingSource) : "",
			// "; " reads in a spreadsheet and imports back; tags that contain a separator keep the JSON list, so they do too.
			application.tags.some((tag) => /[;,|]/.test(tag))
				? JSON.stringify(application.tags)
				: application.tags.join("; "),
			application.contacts
				.map(({ name, role, type }) => {
					const details = [role, type].filter(Boolean).join(", ");
					return details ? `${name} (${details})` : name;
				})
				.join("\n"),
			application.notes ?? "",
			application.closedReason ?? "",
			stages
				.map((entry) => `${stageLabel(entry.stage)} (${entry.dateUnknown ? "date not recorded" : dateOnly(entry.at)})`)
				.join(" → "),
			timeline.map((entry) => `${dateOnly(entry.at)}: ${timelineText(entry)}`).join("\n"),
			new Date(application.createdAt).toISOString(),
			new Date(application.updatedAt).toISOString(),
		];
	});
	// UTF-8 BOM lets spreadsheet apps recognize international names without an import wizard.
	return `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
