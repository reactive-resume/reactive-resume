import { describe, expect, it, vi } from "vite-plus/test";
import { createRouterClient } from "@orpc/server";
import { WebAccessError } from "./contracts";
import { webAccessService } from "./credentials";
import { searchScope } from "./regions";
import { webAccessRouter } from "./router";
import { probeWebAccess } from "./service";

vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string } }>() };
});
vi.mock("./credentials", () => ({
	webAccessService: {
		recordTest: vi.fn(),
		resolve: vi.fn(),
		canSearch: vi.fn((hasConnection: boolean) => hasConnection),
	},
}));
vi.mock("./service", () => ({ probeWebAccess: vi.fn() }));
vi.mock("./regions", () => ({ searchScope: vi.fn() }));

describe("web connection probe transport", () => {
	it("reports the shared retrieval limit as HTTP 429 instead of an internal server error", async () => {
		vi.mocked(webAccessService.resolve).mockResolvedValue({ provider: "tavily", apiKey: "test-only-key" });
		vi.mocked(searchScope).mockResolvedValue({ regions: [], locations: [] });
		vi.mocked(probeWebAccess).mockRejectedValue(new WebAccessError("rate-limit"));
		const client = createRouterClient(webAccessRouter, {
			context: { user: { id: "alice" }, reqHeaders: new Headers() } as never,
		});
		await expect(client.test()).rejects.toMatchObject({ code: "RATE_LIMIT_EXCEEDED", status: 429 });
	});

	it("probes search in the user's first region", async () => {
		vi.mocked(webAccessService.resolve).mockResolvedValue({ provider: "tavily", apiKey: "test-only-key" });
		vi.mocked(searchScope).mockResolvedValue({ regions: ["AU", "DE"], locations: [] });
		vi.mocked(probeWebAccess).mockResolvedValue({ search: { success: true }, read: { success: true } });
		const client = createRouterClient(webAccessRouter, {
			context: { user: { id: "alice" }, reqHeaders: new Headers() } as never,
		});
		await client.test();
		expect(probeWebAccess).toHaveBeenCalledWith(
			{ provider: "tavily", apiKey: "test-only-key" },
			expect.objectContaining({ userId: "alice", region: "AU" }),
		);
	});

	it("tests the server's SearXNG search without a web connection", async () => {
		vi.mocked(webAccessService.resolve).mockResolvedValue(null);
		vi.mocked(webAccessService.canSearch).mockReturnValueOnce(true);
		vi.mocked(searchScope).mockResolvedValue({ regions: ["AU"], locations: [] });
		const result = { search: { success: true }, read: { success: false, error: "unavailable" as const } };
		vi.mocked(probeWebAccess).mockResolvedValue(result);
		const client = createRouterClient(webAccessRouter, {
			context: { user: { id: "alice" }, reqHeaders: new Headers() } as never,
		});
		await expect(client.test()).resolves.toEqual(result);
		expect(webAccessService.canSearch).toHaveBeenCalledWith(false);
		expect(probeWebAccess).toHaveBeenLastCalledWith(null, expect.objectContaining({ userId: "alice", region: "AU" }));
	});

	it("refuses the test with neither SearXNG nor a web connection", async () => {
		vi.mocked(webAccessService.resolve).mockResolvedValue(null);
		vi.mocked(searchScope).mockResolvedValue({ regions: [], locations: [] });
		vi.mocked(probeWebAccess).mockClear();
		const client = createRouterClient(webAccessRouter, {
			context: { user: { id: "alice" }, reqHeaders: new Headers() } as never,
		});
		await expect(client.test()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
		expect(probeWebAccess).not.toHaveBeenCalled();
	});
});
