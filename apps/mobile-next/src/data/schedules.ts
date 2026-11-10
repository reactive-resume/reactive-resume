import type { RouterInput } from "@/api/client";
import { dataClient } from "./client";
import { approveRecurring, recordRecurringApproval, type Connection } from "./consent";
import { getAccountScope } from "@/auth/session";
/** Caller shows connection/data/cost beside the switch; saving is its explicit approval. */
export async function saveApprovedSchedule(input: RouterInput["career"]["saveSchedule"], connection: Connection) {
	const approval = approveRecurring(connection);
	const saved = await dataClient.career.saveSchedule(input, {
		context: { recurringApproval: approval, scope: approval.scope },
	});
	if (getAccountScope() !== approval.scope) throw new Error("The account changed. Try again.");
	recordRecurringApproval(saved.id, connection);
	return saved;
}
