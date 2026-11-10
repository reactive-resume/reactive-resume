import { t } from "@lingui/core/macro";
export function assertStageGate(operation: string, input: unknown) {
	if (
		(operation === "applications.update" || operation === "applications.bulkUpdate") &&
		input &&
		typeof input === "object" &&
		"status" in input &&
		input.status === "applied"
	)
		throw new Error(t`Confirm what you sent before marking as applied.`);
	if (
		operation === "documents.copyForJob" &&
		(!input ||
			typeof input !== "object" ||
			!("newId" in input) ||
			typeof input.newId !== "string" ||
			!/^[0-9a-f-]{36}$/i.test(input.newId))
	)
		throw new Error(t`Prepare a durable copy identity before queueing.`);
}
