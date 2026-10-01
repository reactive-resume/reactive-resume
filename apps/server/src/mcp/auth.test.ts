import { beforeEach, expect, it, vi } from "vitest";

const resolve = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/api/context", () => ({ resolveAuthenticationFromRequestHeaders: resolve }));

import { AuthError, authenticateRequest } from "./auth";

beforeEach(() => resolve.mockReset());
it("resolves MCP credentials through the shared API auth policy without accepting cookies", async () => {
	resolve.mockResolvedValue({ user: { id: "user-1" }, method: "bearer", permissions: ["read"] });
	await authenticateRequest(
		new Request("https://resume.example/mcp", {
			headers: { authorization: "Bearer valid-token", "x-api-key": "expired-key", cookie: "session=browser" },
		}),
	);
	const headers = resolve.mock.calls[0]?.[0] as Headers;
	expect(headers.get("authorization")).toBe("Bearer valid-token");
	expect(headers.get("x-api-key")).toBe("expired-key");
	expect(headers.has("cookie")).toBe(false);
});
it("rejects requests when shared credential resolution finds no user", async () => {
	resolve.mockResolvedValue(null);
	await expect(authenticateRequest(new Request("https://resume.example/mcp"))).rejects.toBeInstanceOf(AuthError);
});
