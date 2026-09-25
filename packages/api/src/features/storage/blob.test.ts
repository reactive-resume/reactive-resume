import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	del: vi.fn(),
	get: vi.fn(),
	list: vi.fn(),
	put: vi.fn(),
	env: {
		DEPLOYMENT_NAMESPACE: "preview-123",
		BLOB_READ_WRITE_TOKEN: undefined as string | undefined,
		BLOB_STORE_ID: undefined as string | undefined,
	},
}));

vi.mock("@vercel/blob", () => mocks);
vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));

import { BlobStorageService, blobOptions, blobPath } from "./blob";

const storage = new BlobStorageService();

function storedResult(data = new Uint8Array([1])) {
	return {
		statusCode: 200,
		stream: new Response(data).body,
		blob: { size: 0, etag: "version-1", uploadedAt: new Date(0), contentType: "image/jpeg" },
	};
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.env.BLOB_READ_WRITE_TOKEN = undefined;
	mocks.env.BLOB_STORE_ID = undefined;
});

describe("BlobStorageService", () => {
	it("uses namespaced paths and leaves OIDC credential discovery to the SDK", () => {
		expect(blobPath("uploads/user/file.jpg")).toBe("preview-123/uploads/user/file.jpg");
		expect(blobOptions()).toEqual({});
		mocks.env.BLOB_READ_WRITE_TOKEN = "token";
		mocks.env.BLOB_STORE_ID = "store";
		expect(blobOptions()).toEqual({ token: "token", storeId: "store" });
		for (const key of ["../production/file", "/file", "uploads/../file", "uploads\\file"]) {
			expect(() => blobPath(key)).toThrow("Invalid storage key");
		}
	});

	it("paginates list results and returns logical keys", async () => {
		mocks.list
			.mockResolvedValueOnce({ blobs: [{ pathname: "preview-123/uploads/a" }], hasMore: true, cursor: "next" })
			.mockResolvedValueOnce({ blobs: [{ pathname: "preview-123/uploads/b" }], hasMore: false });
		expect(await storage.list("uploads/")).toEqual(["uploads/a", "uploads/b"]);
		expect(mocks.list.mock.calls).toEqual([
			[{ prefix: "preview-123/uploads/" }],
			[{ prefix: "preview-123/uploads/", cursor: "next" }],
		]);
	});

	it("writes stable keys privately, including application-public assets", async () => {
		await storage.write({ key: "uploads/a", data: new Uint8Array([1]), contentType: "image/jpeg" });
		expect(mocks.put).toHaveBeenCalledWith("preview-123/uploads/a", Buffer.from([1]), {
			access: "private",
			addRandomSuffix: false,
			allowOverwrite: true,
			contentType: "image/jpeg",
		});
	});

	it("reads private bytes and metadata directly from origin; returns null for missing files", async () => {
		mocks.get.mockResolvedValueOnce(storedResult()).mockResolvedValueOnce(null);
		expect(await storage.read("uploads/a")).toEqual({
			data: new Uint8Array([1]),
			size: 1,
			etag: "version-1",
			lastModified: new Date(0),
			contentType: "image/jpeg",
		});
		expect(mocks.get).toHaveBeenCalledWith("preview-123/uploads/a", { access: "private", useCache: false });
		expect(await storage.read("missing")).toBeNull();
	});

	it("deletes exact keys and descendants without deleting similarly named siblings", async () => {
		mocks.list.mockResolvedValue({
			blobs: ["foo", "foo/a", "foobar", "foo.txt"].map((key) => ({ pathname: `preview-123/${key}` })),
			hasMore: false,
		});
		expect(await storage.delete("foo")).toBe(true);
		expect(mocks.del).toHaveBeenCalledWith(["preview-123/foo", "preview-123/foo/a"], {});
		mocks.list.mockResolvedValue({ blobs: [], hasMore: false });
		expect(await storage.delete("absent")).toBe(false);
		expect(mocks.del).toHaveBeenCalledTimes(1);
	});

	it("checks read/write/delete with unique keys and cleans failed checks", async () => {
		mocks.get.mockImplementation(async () => storedResult());
		expect((await storage.healthcheck()).status).toBe("healthy");
		expect((await storage.healthcheck()).status).toBe("healthy");
		const keys = mocks.put.mock.calls.map(([key]) => key);
		expect(keys[0]).toMatch(/^preview-123\/\.health\//);
		expect(keys[0]).not.toBe(keys[1]);
		expect(mocks.del.mock.calls.map(([key]) => key)).toEqual(keys);
		mocks.get.mockRejectedValueOnce(new Error("private credentials must not escape"));
		expect(await storage.healthcheck()).toEqual({
			status: "unhealthy",
			type: "blob",
			message: "Blob storage is unavailable",
		});
		expect(mocks.del).toHaveBeenCalledTimes(3);
	});
});
