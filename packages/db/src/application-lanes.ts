import { createDefaultApplicationLanes } from "@reactive-resume/schema/applications/lanes";
export { MAX_APPLICATION_LANES } from "@reactive-resume/schema/applications/lanes";

/** Shared by application writes and guest linking; matches the additive migration's deterministic IDs. */
export function createDefaultOwnedApplicationLanes(userId: string) {
	return createDefaultApplicationLanes().map((lane) => ({
		...lane,
		id: `application-lane:${userId}:${lane.category}`,
		userId,
	}));
}
