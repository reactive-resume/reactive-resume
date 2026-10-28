import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

beforeEach(() => {
	vi.resetAllMocks();
	mocks.env.BLOB_READ_WRITE_TOKEN = undefined;
	mocks.env.BLOB_STORE_ID = undefined;
});

describe("BlobStorageService", () => {
	it.each([
		"uploads/user/%2e%2e/other/file",
		"uploads/user/%252e%252e/file",
		"uploads/user/file?x",
		"uploads/user/file#x",
		"uploads/user/\nfile",
	])("rejects URL interpretation of storage key %s before requesting bytes", async (key) => {
		await expect(storage.read(key)).rejects.toThrow("Invalid storage key");
		expect(mocks.get).not.toHaveBeenCalled();
	});
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
});
