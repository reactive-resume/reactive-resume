import { describe, expect, it, vi } from "vite-plus/test";

// The stale-run TTL must stay independent of the Assistant configuration: even if a replica is
// misconfigured with a 30-minute run budget, the 15-minute TTL leaves five minutes for persistence
// after the capped 10-minute run.
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

describe("stale-run TTL", () => {
	it("stays five minutes above the maximum Assistant run budget", () => {
		expect(STALE_AGENT_RUN_TTL_MS).toBe(15 * 60_000);
		expect(isStaleAgentRun({ activeRunId: "run-1", activeRunStartedAt: minutesBefore(14) }, NOW)).toBe(false);
		expect(isStaleAgentRun({ activeRunId: "run-1", activeRunStartedAt: minutesBefore(16) }, NOW)).toBe(true);
	});
});
