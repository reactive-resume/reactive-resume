import type { ResourceOutput, MutationInputs } from "./resources";
import { t } from "@lingui/core/macro";
import { generateId } from "@reactive-resume/utils/string";
import { usePlatformActions } from "./actions";
import { now } from "./clock";
import { readLocal, writeLocal } from "./local-state";
import { useResource } from "./provider";
import { activeDataScope, assertDataScope } from "./scope";

export const useApplicationLanes = () => useResource("lanes", {});
export function useApplicationLaneActions() {
	const actions = usePlatformActions();
	return {
		create: (input: MutationInputs["applications.lanes.create"]) => actions.run("applications.lanes.create", input),
		update: (input: MutationInputs["applications.lanes.update"]) =>
			actions.write("applications", "applications.lanes.update", input),
		reorder: (input: MutationInputs["applications.lanes.reorder"]) =>
			actions.write("applications", "applications.lanes.reorder", input),
		retire: (input: MutationInputs["applications.lanes.retire"]) =>
			actions.write("applications", "applications.lanes.retire", input),
	};
}
export function useApplicationTags() {
	const actions = usePlatformActions();
	return {
		set: (ids: string[], addTags: string[]) =>
			actions.write("applications", "applications.bulkUpdate", { ids, addTags }),
	};
}
export type StepUndo = { id: string; scope: string; applicationId: string; kind: string; previous: string | null };
const stepKey = (input: { applicationId: string; kind: string }) =>
	`step:${JSON.stringify([input.applicationId, input.kind])}`;
/** Completion only hides a suggested step; it never pretends the underlying interview or submission happened. */
export function completeStep(input: { applicationId: string; kind: string }): StepUndo {
	const scope = activeDataScope();
	const previous = readLocal<string | null>(scope, stepKey(input), null);
	const handle = { ...input, scope, previous, id: generateId() };
	writeLocal(scope, stepKey(input), handle.id);
	writeLocal(scope, "step-revision", readLocal(scope, "step-revision", 0) + 1);
	return handle;
}
export function undoStep(handle: StepUndo) {
	assertDataScope(handle.scope);
	if (readLocal(handle.scope, stepKey(handle), null) !== handle.id) throw new Error(t`Step changed. Review again.`);
	writeLocal(handle.scope, stepKey(handle), handle.previous);
	writeLocal(handle.scope, "step-revision", readLocal(handle.scope, "step-revision", 0) + 1);
}
export function isStepComplete(input: { applicationId: string; kind: string }, scope = activeDataScope()) {
	return readLocal<string | null>(scope, stepKey(input), null) !== null;
}
export function hadNoResponse(application: Pick<ResourceOutput<"application">, "activity" | "closedReason">) {
	return (
		application.closedReason === "no-response" ||
		application.activity.some((entry) => entry.type === "stage" && entry.closedReason === "no-response")
	);
}
const escapeICS = (text: string) =>
	text.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const stamp = (at: Date) =>
	at
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
export function interviewCalendar(application: ResourceOutput<"application">, interviewId: string) {
	const entry = application.activity.find((row) => row.type === "interview" && row.id === interviewId);
	if (!entry || entry.type !== "interview") throw new Error(t`Interview unavailable.`);
	const at = new Date(entry.at);
	const lines = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Reactive Resume//Interviews//EN",
		"BEGIN:VEVENT",
		`UID:${escapeICS(`${application.id}-${entry.id}@rxresu.me`)}`,
		`DTSTAMP:${stamp(now())}`,
		`DTSTART:${stamp(at)}`,
		`DTEND:${stamp(new Date(at.getTime() + entry.durationMinutes * 60_000))}`,
		`SUMMARY:${escapeICS(`${application.company} · ${application.role}`)}`,
		`LOCATION:${escapeICS(entry.location)}`,
		"END:VEVENT",
		"END:VCALENDAR",
	];
	// RFC 5545 folds at 75 octets; iterate code points so UTF-8 characters stay intact.
	const fold = (line: string) => {
		let result = "";
		let width = 0;
		for (const char of line) {
			const size = new TextEncoder().encode(char).length;
			if (width + size > 75) {
				result += "\r\n ";
				width = 1;
			}
			result += char;
			width += size;
		}
		return result;
	};
	return { name: "interview.ics", mimeType: "text/calendar", text: lines.map(fold).join("\r\n") + "\r\n" };
}
