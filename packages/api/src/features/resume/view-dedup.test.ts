import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
	increment: vi.fn(),
	redis: null as { set: ReturnType<typeof vi.fn> } | null,
	coordination: null as { consume: ReturnType<typeof vi.fn> } | null,
}));

vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: () => mocks.redis,
	redisKey: (...parts: string[]) => parts.join(":"),
}));

vi.mock("@reactive-resume/db/coordination", () => ({
	getCoordination: () => mocks.coordination,
}));

vi.mock("../../middleware/rate-limit", () => ({
	getClientKey: (client?: string) => `ip:${client ?? "unknown"}`,
}));

vi.mock("./service", () => ({
	resumeService: { statistics: { increment: mocks.increment } },
}));

const { countVisit } = await import("./view-dedup");

describe("countVisit", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.redis = null;
		mocks.coordination = null;
		mocks.increment.mockReset();
		mocks.increment.mockResolvedValue(undefined);
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	it("counts a visitor once per window without a shared store", async () => {
		const input = { kind: "view", resumeId: "r1", trustedClient: "1.1.1.1" } as const;

		await countVisit(input);
		await countVisit(input);

		expect(mocks.increment).toHaveBeenCalledTimes(1);
		expect(mocks.increment).toHaveBeenCalledWith({ id: "r1", views: true });
	});

	it("still counts, per instance, when Redis fails", async () => {
		mocks.redis = { set: vi.fn().mockRejectedValue(new Error("down")) };
		const input = { kind: "view", resumeId: "r2", trustedClient: "1.1.1.1" } as const;

		await expect(countVisit(input)).resolves.toBeUndefined();
		await expect(countVisit(input)).resolves.toBeUndefined();

		expect(mocks.increment).toHaveBeenCalledTimes(1);
	});

	it("still counts, per instance, when the coordination service fails", async () => {
		mocks.coordination = { consume: vi.fn().mockRejectedValue(new Error("down")) };
		const input = { kind: "view", resumeId: "r3", trustedClient: "1.1.1.1" } as const;

		await expect(countVisit(input)).resolves.toBeUndefined();
		await expect(countVisit(input)).resolves.toBeUndefined();

		expect(mocks.increment).toHaveBeenCalledTimes(1);
	});

	it("resolves when the statistics write fails", async () => {
		mocks.increment.mockRejectedValue(new Error("db"));

		await expect(countVisit({ kind: "download", resumeId: "r4", trustedClient: "1.1.1.1" })).resolves.toBeUndefined();

		expect(mocks.increment).toHaveBeenCalledWith({ id: "r4", downloads: true });
	});
});
