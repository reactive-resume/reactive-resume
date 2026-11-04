import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { execute, healthcheck, ping, env } = vi.hoisted(() => ({
	execute: vi.fn(),
	healthcheck: vi.fn(),
	ping: vi.fn(),
	env: { STORAGE_HEALTHCHECK_TIMEOUT_MS: 5_000, APP_REVISION: undefined as string | undefined },
}));

vi.mock("@reactive-resume/db/client", () => ({ db: { execute } }));
vi.mock("@reactive-resume/api/features/storage", () => ({ getStorageService: () => ({ healthcheck }) }));
vi.mock("@reactive-resume/db/redis", () => ({ getRedis: () => ({ ping }) }));
vi.mock("@reactive-resume/env/server", () => ({ env }));

import { handleHealth } from "./health";

beforeEach(() => {
	execute.mockResolvedValue([]);
	healthcheck.mockResolvedValue({ status: "healthy" });
	ping.mockResolvedValue("PONG");
	env.STORAGE_HEALTHCHECK_TIMEOUT_MS = 5_000;
	env.APP_REVISION = undefined;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

it.each([undefined, "a".repeat(40)])(
	"reports the running image's commit, or null when unknown (%s)",
	async (revision) => {
		env.APP_REVISION = revision;
		const response = await handleHealth();
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect((await response.json()).revision).toBe(revision ?? null);
	},
);

describe("health check timeouts", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("accepts working storage taking longer than the default deadline within its configured one", async () => {
		const latency = 6_000;
		env.STORAGE_HEALTHCHECK_TIMEOUT_MS = 7_000;
		healthcheck.mockImplementationOnce(
			() => new Promise((resolve) => setTimeout(() => resolve({ status: "healthy", type: "s3" }), latency)),
		);

		const pending = handleHealth();
		await vi.advanceTimersByTimeAsync(latency);
		const response = await pending;

		expect(response.status).toBe(200);
		expect((await response.json()).storage).toMatchObject({ status: "healthy", type: "s3", latencyMs: latency });
	});

	it("fails stalled storage only after its configured deadline", async () => {
		const timeout = 7_000;
		env.STORAGE_HEALTHCHECK_TIMEOUT_MS = timeout;
		healthcheck.mockImplementationOnce(() => new Promise(() => {}));
		const settled = vi.fn();
		const pending = handleHealth().then((response) => {
			settled();
			return response;
		});

		await vi.advanceTimersByTimeAsync(timeout - 1);
		expect(settled).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		const response = await pending;

		expect(response.status).toBe(503);
		expect((await response.json()).storage).toEqual({
			status: "unhealthy",
			error: "Storage health check failed.",
			latencyMs: timeout,
		});
	});

	it.each(["database", "redis"])("retains the 1500 ms deadline for stalled %s", async (dependency) => {
		({ database: execute, redis: ping })[dependency]?.mockImplementationOnce(() => new Promise(() => {}));
		const pending = handleHealth();
		await vi.advanceTimersByTimeAsync(1_500);
		const response = await pending;

		expect(response.status).toBe(503);
		expect((await response.json())[dependency]).toMatchObject({ status: "unhealthy", latencyMs: 1_500 });
	});
});

describe("health failure reporting", () => {
	it.each([
		["database", "Database"],
		["redis", "Redis"],
	] as const)("keeps thrown %s error details in server logs only", async (dependency, name) => {
		const detail = "Connection failed for private-user at internal.example:5432";
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		({ database: execute, redis: ping })[dependency].mockRejectedValueOnce(new Error(detail));

		const response = await handleHealth();
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(JSON.stringify(body)).not.toContain(detail);
		expect(body[dependency]).toMatchObject({ status: "unhealthy", error: `${name} health check failed.` });
		expect(warn).toHaveBeenCalledWith(
			"[Healthcheck]",
			expect.objectContaining({ [dependency]: expect.objectContaining({ error: detail }) }),
		);
	});

	it("redacts returned storage failures while preserving diagnostics in server logs", async () => {
		const detail = "Access denied to bucket private-bucket on internal.example";
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		healthcheck.mockResolvedValueOnce({
			status: "unhealthy",
			type: "s3",
			message: detail,
			error: detail,
			internalDetail: detail,
		});

		const response = await handleHealth();
		const body = await response.json();

		expect(response.status).toBe(503);
		expect(body.storage).toEqual({
			status: "unhealthy",
			type: "s3",
			latencyMs: expect.any(Number),
			error: "Storage health check failed.",
		});
		expect(JSON.stringify(body)).not.toContain(detail);
		expect(warn).toHaveBeenCalledWith(
			"[Healthcheck]",
			expect.objectContaining({ storage: expect.objectContaining({ error: detail, message: detail }) }),
		);
	});
});
