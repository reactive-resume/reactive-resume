import { describe, expect, it } from "vitest";
import { getQueryClient } from "./client";

describe("getQueryClient mutationCache", () => {
	it("invalidates data queries but excludes auth session and flags on mutation settled", async () => {
		const queryClient = getQueryClient();

		queryClient.setQueryData(["auth", "session"], { user: { id: "u-1" } });
		queryClient.setQueryData(["flags"], { disableSignups: false });
		queryClient.setQueryData(["resume", "list"], [{ id: "res-1" }]);

		const authQuery = queryClient.getQueryCache().find({ queryKey: ["auth", "session"] });
		const flagsQuery = queryClient.getQueryCache().find({ queryKey: ["flags"] });
		const resumeQuery = queryClient.getQueryCache().find({ queryKey: ["resume", "list"] });

		expect(authQuery?.isStale()).toBe(false);
		expect(flagsQuery?.isStale()).toBe(false);
		expect(resumeQuery?.isStale()).toBe(false);

		// Trigger a mutation that settles
		const mutation = queryClient.getMutationCache().build(queryClient, {
			mutationFn: async () => "success",
		});
		await mutation.execute(undefined);

		// Resume query is invalidated (stale)
		expect(resumeQuery?.isStale()).toBe(true);

		// Auth and flags are preserved (not stale)
		expect(authQuery?.isStale()).toBe(false);
		expect(flagsQuery?.isStale()).toBe(false);
	});
});
