import { describe, expect, it, vi } from "vitest";
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

	it("returns null when no session is present (data is null)", async () => {
		getSessionMock.mockResolvedValueOnce({ data: null, error: null });

		const result = await getSession();
		expect(result).toBeNull();
	});

	it("returns null when session is explicitly unauthorized (HTTP 401)", async () => {
		getSessionMock.mockResolvedValueOnce({ data: null, error: { status: 401, message: "Unauthorized" } });

		const result = await getSession();
		expect(result).toBeNull();
	});

	it("throws on rate-limited responses (HTTP 429)", async () => {
		getSessionMock.mockResolvedValueOnce({
			data: null,
			error: { status: 429, message: "Too many requests. Please try again later." },
		});

		await expect(getSession()).rejects.toThrow("Too many requests. Please try again later.");
	});

	it("throws on server errors (HTTP 500)", async () => {
		getSessionMock.mockResolvedValueOnce({
			data: null,
			error: { status: 500, message: "Internal server error" },
		});

		await expect(getSession()).rejects.toThrow("Internal server error");
	});

	it("throws on transient network errors", async () => {
		getSessionMock.mockResolvedValueOnce({
			data: null,
			error: { message: "Failed to fetch" },
		});

		await expect(getSession()).rejects.toThrow("Failed to fetch");
	});
});
