import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn<typeof fetch>();
const rpcUrl = "https://resume.test/api/rpc/storage/uploadFile?batch=1";
const contentType = "multipart/form-data; boundary=original-boundary";
const largeBody = new Uint8Array(5 * 1024 * 1024).fill(173);

function queueStaging() {
	fetchMock
		.mockResolvedValueOnce(Response.json({ enabled: true }))
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
	it("sends small requests directly with their body and headers", async () => {
		fetchMock.mockResolvedValue(new Response("ok"));
		const { rpcFetch } = await import("./fetch");
		await rpcFetch(rpcUrl, { method: "POST", body: "original bytes", headers: { "x-example": "preserved" } });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const request = fetchMock.mock.calls[0]?.[0] as Request;
		expect(request.url).toBe(rpcUrl);
		expect(await request.text()).toBe("original bytes");
		expect(request.headers.get("x-example")).toBe("preserved");
		expect(request.credentials).toBe("include");
	});

	it("uploads large wire bytes to Blob, then sends a tiny reference to the original RPC", async () => {
		queueStaging();
		const { rpcFetch } = await import("./fetch");
		const result = await rpcFetch(
			new Request(rpcUrl, {
				method: "POST",
				body: largeBody,
				headers: { "content-type": contentType, "x-example": "preserved" },
			}),
		);
		expect(await result.text()).toBe("rpc-result");
		expect(fetchMock).toHaveBeenCalledTimes(4);
		const [prepareUrl, preparation] = fetchMock.mock.calls[1] ?? [];
		expect(prepareUrl).toBe("/api/storage/stage");
		expect(JSON.parse(preparation?.body as string)).toEqual({
			path: "/api/rpc/storage/uploadFile?batch=1",
			contentType,
			size: largeBody.length,
		});
		const [uploadUrl, upload] = fetchMock.mock.calls[2] ?? [];
		expect(uploadUrl).toBe("https://blob.test/signed-put");
		expect(upload?.method).toBe("PUT");
		const uploadedBody = upload?.body as Blob;
		expect(Buffer.from(await uploadedBody.arrayBuffer()).equals(Buffer.from(largeBody))).toBe(true);
		const [finalUrl, finalRequest] = fetchMock.mock.calls[3] ?? [];
		expect(finalUrl).toBe(rpcUrl);
		expect(finalRequest?.body).toBeUndefined();
		expect(finalRequest?.credentials).toBe("include");
		const headers = new Headers(finalRequest?.headers);
		expect(headers.get("x-resume-staged-body")).toBe("upload-1");
		expect(headers.get("content-type")).toBe(contentType);
		expect(headers.get("x-example")).toBe("preserved");
	});

	it("preserves large direct requests when staging is disabled on Docker", async () => {
		fetchMock.mockResolvedValueOnce(Response.json({ enabled: false })).mockResolvedValueOnce(new Response("ok"));
		const { rpcFetch } = await import("./fetch");
		await rpcFetch(rpcUrl, { method: "POST", body: largeBody });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const request = fetchMock.mock.calls[1]?.[0] as Request;
		expect(request.url).toBe(rpcUrl);
		expect(Buffer.from(await request.arrayBuffer()).equals(Buffer.from(largeBody))).toBe(true);
	});

	it.each(["network", "http"])(
		"retries discovery after a transient %s error without dispatching RPC",
		async (failure) => {
			if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
			else fetchMock.mockResolvedValueOnce(new Response("Unavailable", { status: 503 }));
			const { rpcFetch } = await import("./fetch");
			await expect(
				rpcFetch(rpcUrl, { method: "POST", body: largeBody, headers: { "content-type": contentType } }),
			).rejects.toThrow();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			queueStaging();
			await expect(
				rpcFetch(rpcUrl, { method: "POST", body: largeBody, headers: { "content-type": contentType } }),
			).resolves.toBeInstanceOf(Response);
			expect(fetchMock).toHaveBeenCalledTimes(5);
		},
	);
});
