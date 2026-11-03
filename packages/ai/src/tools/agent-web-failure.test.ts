import { expect, it } from "vite-plus/test";
import { agentWebFailure } from "./agent-tool-contracts";

it("recognizes recorded failures and built-in fallback causes without reading model prose", () => {
	const failed = (type: string, reason: string) => ({
		type,
		state: "output-error",
		errorText: `Web access failed (${reason}).`,
	});
	for (const reason of ["auth", "quota", "rate-limit", "timeout", "unavailable"])
		expect(agentWebFailure(failed("tool-search_web", reason))).toBe(reason);
	expect(agentWebFailure(failed("tool-propose_edits", "auth"))).toBeUndefined();
	expect(agentWebFailure(failed("tool-search_web", "private-key-material"))).toBeUndefined();
	expect(agentWebFailure({ ...failed("tool-search_web", "auth"), state: "input-available" })).toBeUndefined();
	const read = {
		type: "tool-read_page",
		state: "output-available",
		output: {
			requestedUrl: "https://example.test/job",
			content: "Public role",
			format: "text",
			method: "builtin",
			retrievedAt: "2030-01-01T00:00:00Z",
			truncated: false,
			completeness: "unknown",
			fallbackReason: "auth",
		},
	};
	expect(agentWebFailure(read)).toBe("auth");
	expect(agentWebFailure({ ...read, output: { fallbackReason: "auth" } })).toBeUndefined();
	expect(agentWebFailure({ type: "text", text: "Web access failed (auth)." })).toBeUndefined();
});
