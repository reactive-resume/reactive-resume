import type { UIMessage } from "ai";
import { expect, it } from "vitest";
import { agentWebSources } from "./agent-tool-contracts";

it("preserves deduplicated retrieved sources after serialization and ignores failed tools and invented links", () => {
	const message: UIMessage = {
		id: "message",
		role: "assistant",
		parts: [
			{ type: "text", text: "Made-up citation: https://invented.example/page" },
			{ type: "source-url", sourceId: "native", url: "https://company.example/job#requirements", title: "Company job" },
			{ type: "source-url", sourceId: "private", url: "http://127.0.0.1/secret" },
			{ type: "source-url", sourceId: "js", url: "javascript:alert(1)" },
			{ type: "source-url", sourceId: "credentials", url: "https://secret@company.example/job" },
			{
				type: "tool-search_web",
				toolCallId: "search",
				state: "output-available",
				input: { query: "Job" },
				output: [
					{ url: "https://company.example/job", title: "Duplicate" },
					{ url: "https://careers.example/role", title: "Role" },
				],
			},
			{ type: "tool-search_web", toolCallId: "failed", state: "output-error", input: {}, errorText: "Unavailable" },
			{
				type: "tool-read_page",
				toolCallId: "read",
				state: "output-available",
				input: { url: "https://careers.example/role" },
				output: {
					requestedUrl: "https://careers.example/role",
					resolvedUrl: "https://careers.example/role",
					content: "Posting",
					format: "text",
					retrievedAt: "2026-09-30T12:00:00Z",
					method: "builtin",
					truncated: false,
					completeness: "unknown",
				},
			},
		],
	};
	expect(agentWebSources(JSON.parse(JSON.stringify(message)))).toEqual([
		{ url: "https://company.example/job", title: "Company job", kind: "native" },
		{ url: "https://careers.example/role", title: "Role", kind: "search" },
	]);
});
