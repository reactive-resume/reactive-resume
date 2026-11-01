// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	fetchMock.mockReset();
	fetchMock.mockRejectedValue(new Error("captured transport"));
	vi.stubGlobal("fetch", fetchMock);
	vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

const sentAccount = () => new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-account-id");

describe("RPC account binding", () => {
	it("keeps the account captured when a call started, not the one current at dispatch", async () => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		setAccountScope("alice");
		const pending = client.career.saveProfile({} as never).catch(() => undefined);
		setAccountScope("bob");
		await pending;
		expect(sentAccount()).toBe("alice");
	});

	it("uses the account a call explicitly carries even before a scope is set", async () => {
		const { client } = await import("./client");
		const pending = client.career.saveProfile({} as never, { context: { accountId: "carol" } }).catch(() => undefined);
		await pending;
		expect(sentAccount()).toBe("carol");
	});

	it("never batches an explicitly bound call with another account's call", async () => {
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { client } = await import("./client");
		setAccountScope("bob");
		await Promise.allSettled([
			client.career.saveProfile({} as never, { context: { accountId: "alice" } }),
			client.career.saveFact({} as never),
		]);
		const sent = fetchMock.mock.calls.map(([input, init]) => ({
			url: String(input),
			headers: new Headers(init?.headers),
		}));
		expect(sent).toHaveLength(2);
		expect(sent.map((call) => call.headers.get("x-account-id")).sort()).toEqual(["alice", "bob"]);
		const bound = sent.find((call) => call.headers.get("x-account-id") === "alice");
		expect(bound?.headers.get("x-orpc-batch")).toBeNull();
		expect(bound?.url).not.toContain("__batch__");
	});
});
