jest.mock("@reactive-resume/utils/http", () => ({ privateUploadUrl: (source: string) => source }));
const mockGetCredentials = jest.fn();
const mockRecover = jest.fn();
const mockReject = jest.fn();
jest.mock("@/auth/session", () => ({
	getCredentials: () => mockGetCredentials(),
	recoverFromUnauthorized: (...args: unknown[]) => mockRecover(...args),
	rejectCredentials: (...args: unknown[]) => mockReject(...args),
	getAccountScope: () => "alex",
}));
jest.mock("./ai-consent", () => ({ authorizeAiRequest: jest.fn() }));
jest.mock("@orpc/client", () => ({ createORPCClient: () => ({}), onError: () => () => {} }));
jest.mock("@orpc/client/fetch", () => ({ RPCLink: class RPCLink {} }));
jest.mock("@orpc/tanstack-query", () => ({ createTanstackQueryUtils: () => ({}) }));
jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
import { withCredentials } from "./client";
beforeEach(() => {
	jest.clearAllMocks();
	mockGetCredentials.mockResolvedValue({ accessToken: "old", scope: "alex", account: 1 });
	mockRecover.mockResolvedValue({ accessToken: "new", scope: "alex", account: 1 });
	mockReject.mockResolvedValue(undefined);
});
test("401 token rejection refreshes once and retries; second token rejection expires session", async () => {
	const send = jest.fn(async () => new Response("UNAUTHORIZED", { status: 401 }));
	expect((await withCredentials(send, "alex")).status).toBe(401);
	expect(send).toHaveBeenCalledTimes(2);
	expect(mockRecover).toHaveBeenCalledTimes(1);
	expect(mockReject).toHaveBeenCalledTimes(1);
});
test("NEED_PASSWORD passes through without refresh, including after token recovery", async () => {
	const send = jest.fn(async () => new Response("NEED_PASSWORD", { status: 401 }));
	expect(await (await withCredentials(send, "alex")).text()).toBe("NEED_PASSWORD");
	expect(mockRecover).not.toHaveBeenCalled();
	send.mockImplementationOnce(async () => new Response("UNAUTHORIZED", { status: 401 }));
	await withCredentials(send, "alex");
	expect(mockReject).not.toHaveBeenCalled();
});
test("account mismatch fails before any request leaves", async () => {
	const send = jest.fn();
	await expect(withCredentials(send, "other")).rejects.toThrow("account changed");
	expect(send).not.toHaveBeenCalled();
});
