import { describe, expect, it, vi } from "vite-plus/test";

// A 30-minute run budget (the slow-inference workaround from the report) must keep a live run from
// being reaped at the old 15-minute mark.
vi.mock("@reactive-resume/env/server", () => ({ env: { AI_AGENT_RUN_TIMEOUT_MS: 30 * 60_000 } }));
vi.mock("@reactive-resume/db/client", () => ({ db: {} }));
vi.mock("@reactive-resume/db/schema", () => ({
	agentThread: {},
	agentMessage: {},
	agentAction: {},
}));
vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions }),
	eq: (left: unknown, right: unknown) => ({ left, right }),
	isNotNull: (value: unknown) => ({ value }),
	isNull: (value: unknown) => ({ value }),
	sql: () => ({}),
}));

const { isStaleAgentRun, STALE_AGENT_RUN_TTL_MS } = await import("./runs");

const NOW = new Date("2026-08-20T12:00:00.000Z");

function minutesBefore(minutes: number) {
	return new Date(NOW.getTime() - minutes * 60_000);
}

describe("configured Assistant run timeout", () => {
	it("keeps the stale-run TTL above the configured run deadline", () => {
		expect(STALE_AGENT_RUN_TTL_MS).toBe(31 * 60_000);
		expect(isStaleAgentRun({ activeRunId: "run-1", activeRunStartedAt: minutesBefore(29) }, NOW)).toBe(false);
		expect(isStaleAgentRun({ activeRunId: "run-1", activeRunStartedAt: minutesBefore(32) }, NOW)).toBe(true);
	});
});
