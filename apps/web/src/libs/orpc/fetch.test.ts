import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const fetchMock = vi.fn<typeof fetch>();
const rpcUrl = "https://resume.test/api/rpc/storage/uploadFile?batch=1";
const contentType = "multipart/form-data; boundary=original-boundary";
const largeBody = new Uint8Array(5 * 1024 * 1024).fill(173);

function queueStaging() {
	fetchMock
		.mockResolvedValueOnce(Response.json({ id: "upload-1", url: "https://blob.test/signed-put" }))
		.mockResolvedValueOnce(new Response("uploaded"))
		.mockResolvedValueOnce(new Response("rpc-result"));
}

beforeEach(() => {
	vi.resetModules();
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("RPC fetch", () => {
	it("bounds keepalive to small requests instead of failing supported large drafts", async () => {
		fetchMock.mockResolvedValue(new Response("ok"));
		const { rpcFetch } = await import("./fetch");
		await rpcFetch(rpcUrl, { method: "POST", body: "small draft" });
		expect(fetchMock.mock.calls[0]?.[1]?.keepalive).toBe(true);
		await rpcFetch(rpcUrl, { method: "POST", body: new Uint8Array(100000) });
		expect(fetchMock.mock.calls[1]?.[1]?.keepalive).toBe(false);
	});

	it("uploads large wire bytes to Blob, then sends a tiny reference to the original RPC", async () => {
		queueStaging();
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		setAccountScope("alice");
		const { rpcFetch } = await import("./fetch");
		const result = await rpcFetch(
			new Request(rpcUrl, {
				method: "POST",
				body: largeBody,
				headers: { "content-type": contentType, "x-example": "preserved" },
			}),
		);
		expect(await result.text()).toBe("rpc-result");
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const [prepareUrl, preparation] = fetchMock.mock.calls[0] ?? [];
		expect(prepareUrl).toBe("/api/storage/stage");
		expect(JSON.parse(preparation?.body as string)).toEqual({
			path: "/api/rpc/storage/uploadFile?batch=1",
			contentType,
			size: largeBody.length,
		});
		const [uploadUrl, upload] = fetchMock.mock.calls[1] ?? [];
		expect(uploadUrl).toBe("https://blob.test/signed-put");
		expect(upload?.method).toBe("PUT");
		expect(Buffer.from(upload?.body as ArrayBuffer).equals(Buffer.from(largeBody))).toBe(true);
		const [finalUrl, finalRequest] = fetchMock.mock.calls[2] ?? [];
		expect(finalUrl).toBe(rpcUrl);
		expect(finalRequest?.body).toBeUndefined();
		expect(finalRequest?.credentials).toBe("include");
		const headers = new Headers(finalRequest?.headers);
		expect(headers.get("x-resume-staged-body")).toBe("upload-1");
		expect(headers.get("content-type")).toBe(contentType);
		expect(headers.get("x-example")).toBe("preserved");
		expect(headers.get("x-client-timezone")).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
		expect(headers.get("x-account-id")).toBe("alice");
	});

	it("sends large requests directly once staging is unavailable on Docker", async () => {
		fetchMock.mockResolvedValueOnce(new Response("Not Found", { status: 404 })).mockResolvedValue(new Response("ok"));
		const { rpcFetch } = await import("./fetch");
		await rpcFetch(rpcUrl, { method: "POST", body: largeBody });
		await rpcFetch(rpcUrl, { method: "POST", body: largeBody });
		expect(fetchMock).toHaveBeenCalledTimes(3);
		for (const call of [fetchMock.mock.calls[1], fetchMock.mock.calls[2]]) {
			const [url, sent = {}] = call ?? [];
			expect(url).toBe(rpcUrl);
			expect(Buffer.from(sent.body as ArrayBuffer).equals(Buffer.from(largeBody))).toBe(true);
		}
	});

	it("sends the account the page was rendered for so a swapped session refuses its writes", async () => {
		fetchMock.mockResolvedValue(new Response("ok"));
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { rpcFetch } = await import("./fetch");
		setAccountScope("alice");
		await rpcFetch(rpcUrl, { method: "POST", body: "small draft" });
		expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-account-id")).toBe("alice");
	});
	it("prepares the real RPC pipeline before synchronous flush and does not hold unrelated calls", async () => {
		vi.stubGlobal("window", { location: { origin: "https://resume.test" } });
		fetchMock.mockImplementation(async () => Response.json({ json: null }));
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		setAccountScope("alice");
		const { client, prepareRpc } = await import("./client");
		const request = await prepareRpc(client.career.forgetFact, { id: "fictional-fact" });
		expect(fetchMock).not.toHaveBeenCalled();
		await client.career.profile();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const result = request.send();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [url, init] = fetchMock.mock.calls[1] ?? [];
		expect(String(url)).toContain("/career/forgetFact");
		expect(init?.keepalive).toBe(true);
		expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toContain("fictional-fact");
		expect(new Headers(init?.headers).get("x-account-id")).toBe("alice");
		await result;
		await request.send();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("refuses a prepared send after an account switch and rejects oversized Undo bodies before acknowledgement", async () => {
		const { prepareRequest } = await import("@reactive-resume/utils/deferred-request");
		const { setAccountScope } = await import("@/libs/auth/account-scope");
		const { rpcFetch } = await import("./fetch");
		setAccountScope("alice");
		const request = await prepareRequest((defer) =>
			rpcFetch(rpcUrl, { method: "POST", body: "small" }, { context: { defer } }),
		);
		setAccountScope("bob");
		await expect(request.send()).rejects.toMatchObject({ name: "AbortError" });
		expect(fetchMock).not.toHaveBeenCalled();
		await expect(
			prepareRequest((defer) =>
				rpcFetch(rpcUrl, { method: "POST", body: new Uint8Array(61 * 1024) }, { context: { defer } }),
			),
		).rejects.toThrow("Undo dispatch limit");
		expect(fetchMock).not.toHaveBeenCalled();
	});
});
