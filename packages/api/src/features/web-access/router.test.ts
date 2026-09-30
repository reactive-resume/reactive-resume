import { describe, expect, it, vi } from "vitest";
import { createRouterClient } from "@orpc/server";
import { WebAccessError } from "./contracts";
import { webAccessService } from "./credentials";
import { webAccessRouter } from "./router";
import { probeWebAccess } from "./service";

vi.mock("../../context", async () => {
	const { os } = await vi.importActual<typeof import("@orpc/server")>("@orpc/server");
	return { protectedProcedure: os.$context<{ user: { id: string } }>() };
});
vi.mock("./credentials", () => ({ webAccessService: { resolve: vi.fn() } }));
vi.mock("./service", () => ({ probeWebAccess: vi.fn() }));

describe("web connection probe transport", () => {
	it("reports the shared retrieval limit as HTTP 429 instead of an internal server error", async () => {
		vi.mocked(webAccessService.resolve).mockResolvedValue({ provider: "tavily", apiKey: "test-only-key" });
		vi.mocked(probeWebAccess).mockRejectedValue(new WebAccessError("rate-limit"));
		const client = createRouterClient(webAccessRouter, {
			context: { user: { id: "alice" }, reqHeaders: new Headers() } as never,
		});
		await expect(client.test()).rejects.toMatchObject({ code: "RATE_LIMIT_EXCEEDED", status: 429 });
	});
});
