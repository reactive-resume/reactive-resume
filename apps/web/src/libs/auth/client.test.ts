// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { setAccountScope } from "./account-scope";

afterEach(() => {
	vi.restoreAllMocks();
	setAccountScope(null);
});

// Better Auth writes skip the RPC transport. A stale settings tab must not rename the account another tab signed into.
it("binds account settings writes, but not session intents, to the account whose page sent them", async () => {
	const sent: Array<{ path: string; account: string | null }> = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const request = new Request(input, init);
		sent.push({ path: new URL(request.url).pathname, account: request.headers.get("x-account-id") });
		return Response.json({ status: true });
	});
	// Better Fetch keeps the fetch it finds at creation, so the client loads after the stub.
	const { authClient } = await import("./client");
	setAccountScope("alice");

	await authClient.updateUser({ name: "Alice" });
	await authClient.signOut();

	expect(sent).toEqual([
		{ path: "/api/auth/update-user", account: "alice" },
		{ path: "/api/auth/sign-out", account: null },
	]);
});
