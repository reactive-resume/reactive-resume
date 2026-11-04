import { describe, expect, it, vi } from "vite-plus/test";
import { getSession } from "./session";

const getSessionMock = vi.hoisted(() => vi.fn());

vi.mock("./client", () => ({
	authClient: {
		getSession: getSessionMock,
	},
}));

describe("getSession", () => {
	it("returns session data on successful fetch", async () => {
		const mockSession = { user: { id: "user-1", name: "Alice" }, session: { id: "sess-1" } };
		getSessionMock.mockResolvedValueOnce({ data: mockSession, error: null });

		const result = await getSession();
		expect(result).toEqual(mockSession);
	});

	it("returns null when session is explicitly unauthorized (HTTP 401)", async () => {
		getSessionMock.mockResolvedValueOnce({ data: null, error: { status: 401, message: "Unauthorized" } });

		const result = await getSession();
		expect(result).toBeNull();
	});

	// Only a 401 means signed out; treating a transient failure as one would clear this account's data and drafts.
	it.each([
		["a server error", { status: 500, message: "Internal server error" }],
		["a rate limit", { status: 429, message: "Too many requests" }],
		["a network drop", { message: "Failed to fetch" }],
	])("throws on %s instead of reporting no session", async (_, error) => {
		getSessionMock.mockResolvedValueOnce({ data: null, error });

		await expect(getSession()).rejects.toThrow(error.message);
	});
});
