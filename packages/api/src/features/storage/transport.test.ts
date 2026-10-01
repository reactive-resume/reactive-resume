import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		APP_URL: "https://resume.test",
		STORAGE_BACKEND: "blob",
		DEPLOYMENT_NAMESPACE: "test",
	},
	authentication: vi.fn(),
	limit: vi.fn(),
	getRedis: vi.fn(),
	redis: { get: vi.fn(), getdel: vi.fn(), set: vi.fn() },
	blob: { del: vi.fn(), get: vi.fn(), list: vi.fn(), issueSignedToken: vi.fn(), presignUrl: vi.fn() },
}));

vi.mock("@vercel/blob", () => mocks.blob);
vi.mock("@reactive-resume/env/server", () => ({ env: mocks.env }));
vi.mock("../../context", () => ({
	resolveAuthenticationFromRequestHeaders: mocks.authentication,
	resolveUserFromRequestHeaders: async (headers: Headers) => (await mocks.authentication(headers))?.user ?? null,
}));
vi.mock("../../redis", () => ({ createRateLimiter: () => ({ limit: mocks.limit }) }));
vi.mock("@reactive-resume/db/redis", () => ({
	getRedis: mocks.getRedis,
	redisKey: (...parts: string[]) => ["test", ...parts].join(":"),
}));

import { prepareStagedBody, withStagedBody } from "./transport";

const id = "74dc653e-3778-41d1-88cf-dbf241a764cc";
const path = "/api/rpc/storage/uploadFile?batch=1";
const pathname = "test/_staging/body";
const wire = new Uint8Array([0, 255, 13, 10, 45, 45, 97, 0, 128]);
const contentType = "multipart/form-data; boundary=original-boundary";
const records = new Map<string, string>();

function stageRequest(headers: Record<string, string> = {}) {
	return new Request(`https://resume.test${path}`, {
		method: "POST",
		headers: {
			"x-resume-staged-body": id,
			"content-length": "0",
			cookie: "session=original",
			origin: "https://resume.test",
			...headers,
		},
	});
}

function prepareRequest(payload: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
	return new Request("https://resume.test/api/storage/stage", {
		method: "POST",
		headers: { origin: "https://resume.test", "content-type": "application/json", ...headers },
		body: JSON.stringify({ path, contentType, size: wire.length, ...payload }),
	});
}

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("VERCEL", "1");
	// Deliberately fake only provider boundaries; Request, streams, schema and body restoration stay real.
	mocks.authentication.mockResolvedValue({ user: { id: "user-1" }, permissions: ["read", "write", "delete"] });
	mocks.limit.mockResolvedValue({ success: true });
	mocks.getRedis.mockReturnValue(mocks.redis);
	records.clear();
	records.set(
		`test:staged-body:${id}`,
		JSON.stringify({ userId: "user-1", pathname, path, contentType, size: wire.length }),
	);
	mocks.redis.get.mockImplementation((key: string) => Promise.resolve(records.get(key) ?? null));
	mocks.redis.getdel.mockImplementation((key: string) => {
		const value = records.get(key) ?? null;
		records.delete(key);
		return Promise.resolve(value);
	});
	mocks.redis.set.mockResolvedValue("OK");
	mocks.blob.del.mockResolvedValue(undefined);
	mocks.blob.get.mockImplementation(() =>
		Promise.resolve({ statusCode: 200, blob: { size: 0 }, stream: new Response(wire).body }),
	);
	mocks.blob.list.mockResolvedValue({ blobs: [] });
	mocks.blob.issueSignedToken.mockResolvedValue({ delegationToken: "delegation", clientSigningToken: "secret" });
	mocks.blob.presignUrl.mockResolvedValue({ presignedUrl: "https://blob.test/signed-put" });
});

afterEach(() => vi.unstubAllEnvs());

describe("staged RPC transport", () => {
	it("denies read-only credentials before granting an upload or consuming an existing staged body", async () => {
		mocks.authentication.mockResolvedValue({ user: { id: "user-1" }, permissions: ["read"] });
		expect((await prepareStagedBody(prepareRequest({}, { "x-api-key": "read-only" }))).status).toBe(403);
		expect(mocks.blob.issueSignedToken).not.toHaveBeenCalled();
		const handle = vi.fn();
		expect((await withStagedBody(stageRequest({ "x-api-key": "read-only" }), handle)).status).toBe(403);
		expect(mocks.redis.getdel).not.toHaveBeenCalled();
		expect(handle).not.toHaveBeenCalled();
	});
	it("issues only a private path-scoped PUT URL with the exact declared size", async () => {
		const result = await prepareStagedBody(prepareRequest());
		expect(result.status).toBe(200);
		const prepared = await result.json();
		expect(prepared).toEqual({ id: expect.any(String), url: "https://blob.test/signed-put" });
		expect(mocks.blob.issueSignedToken).toHaveBeenCalledWith(
			expect.objectContaining({
				pathname: expect.stringMatching(/^test\/_staging\//),
				operations: ["put"],
				maximumSizeInBytes: wire.length,
				allowedContentTypes: ["application/octet-stream"],
			}),
		);
		expect(mocks.blob.presignUrl).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				access: "private",
				addRandomSuffix: false,
				allowOverwrite: false,
				maximumSizeInBytes: wire.length,
			}),
		);
	});

	it.each(["unauthorized", "foreign-origin", "foreign-owner", "foreign-path"])(
		"rejects %s without consuming the upload",
		async (kind) => {
			if (kind === "unauthorized") mocks.authentication.mockResolvedValue(null);
			if (kind === "foreign-owner")
				mocks.authentication.mockResolvedValue({ user: { id: "user-2" }, permissions: ["write"] });
			if (kind === "foreign-path") {
				const key = `test:staged-body:${id}`;
				records.set(key, JSON.stringify({ ...JSON.parse(records.get(key) ?? "{}"), path: "/api/rpc/other" }));
			}
			const handle = vi.fn();
			const response = await withStagedBody(
				stageRequest(kind === "foreign-origin" ? { origin: "https://evil.test" } : {}),
				handle,
			);
			expect(response.status).toBe(kind === "unauthorized" || kind === "foreign-origin" ? 401 : 403);
			expect(mocks.redis.getdel).not.toHaveBeenCalled();
			expect(mocks.blob.get).not.toHaveBeenCalled();
			expect(handle).not.toHaveBeenCalled();
		},
	);

	it("preserves binary RPC bytes and headers while preventing concurrent/repeated mutations", async () => {
		const handle = vi.fn(async (request: Request) => {
			expect(new Uint8Array(await request.arrayBuffer())).toEqual(wire);
			expect(request.url).toBe(`https://resume.test${path}`);
			expect(request.headers.get("content-type")).toBe(contentType);
			expect(request.headers.get("cookie")).toBe("session=original");
			expect(request.headers.has("content-length")).toBe(false);
			expect(request.headers.has("x-resume-staged-body")).toBe(false);
			return new Response("ok");
		});
		const results = await Promise.all([withStagedBody(stageRequest(), handle), withStagedBody(stageRequest(), handle)]);
		expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
		expect((await withStagedBody(stageRequest(), handle)).status).toBe(410);
		expect(handle).toHaveBeenCalledTimes(1);
		expect(mocks.blob.del).toHaveBeenCalledExactlyOnceWith(pathname, {});
	});

	it.each([{ path: "/api/rpc/../../auth" }, { size: 160 * 1024 * 1024 + 1 }])(
		"rejects invalid preparation %o",
		async (payload) => {
			expect((await prepareStagedBody(prepareRequest(payload))).status).toBe(400);
			expect(mocks.blob.issueSignedToken).not.toHaveBeenCalled();
		},
	);
});
