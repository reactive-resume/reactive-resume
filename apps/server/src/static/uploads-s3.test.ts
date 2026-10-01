import type { IncomingHttpHeaders } from "node:http";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
	APP_URL: "https://resume.example.com",
	S3_ACCESS_KEY_ID: "test-access-key",
	S3_SECRET_ACCESS_KEY: "test-secret-key",
	S3_REGION: "us-east-1",
	S3_ENDPOINT: "",
	STORAGE_BACKEND: "s3",
	S3_BUCKET: "test-bucket",
	S3_FORCE_PATH_STYLE: true,
}));
vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));

type StoredObject = { data: Buffer; contentType: string };
type StorageRequest = { method: string; path: string; headers: IncomingHttpHeaders };
const resolveAuthentication = vi.hoisted(() => vi.fn());
vi.mock("@reactive-resume/api/context", () => ({
	resolveAuthenticationFromRequestHeaders: resolveAuthentication,
	resolveUserFromRequestHeaders: async (headers: Headers) => (await resolveAuthentication(headers))?.user ?? null,
}));

const objects = new Map<string, StoredObject>();
const requests: StorageRequest[] = [];

// Wire-contract stub, not an AWS emulator. It applies the documented BucketOwnerEnforced
// PUT rule to real SDK requests: no ACL or bucket-owner-full-control is accepted.
// https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-ownership-error-responses.html
const server = createServer(async (request, response) => {
	const path = new URL(request.url ?? "/", "http://localhost").pathname;
	requests.push({ method: request.method ?? "", path, headers: request.headers });
	const fail = (status: number, code: string) => {
		response.writeHead(status, { "Content-Type": "application/xml" });
		response.end(`<Error><Code>${code}</Code><Message>${code}</Message></Error>`);
	};
	// Only checks that the SDK authenticates its requests; this stub does not verify signatures.
	if (!request.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) return fail(403, "AccessDenied");
	if (request.method === "PUT") {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(Buffer.from(chunk));
		const acl = request.headers["x-amz-acl"];
		if (acl && acl !== "bucket-owner-full-control") return fail(400, "AccessControlListNotSupported");
		objects.set(path, {
			data: Buffer.concat(chunks),
			contentType: request.headers["content-type"] ?? "application/octet-stream",
		});
		response.writeHead(200, { ETag: '"test-etag"' });
		return response.end();
	}
	const object = objects.get(path);
	if (!object) return fail(404, "NoSuchKey");
	response.writeHead(200, { "Content-Type": object.contentType, "Content-Length": object.data.length });
	response.end(object.data);
});

let storage: ReturnType<typeof import("@reactive-resume/api/features/storage").getStorageService>;
let handleUpload: typeof import("./uploads").handleUpload;

beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Missing stub TCP address");
	envMock.S3_ENDPOINT = `http://127.0.0.1:${address.port}`;
	storage = (await import("@reactive-resume/api/features/storage")).getStorageService();
	({ handleUpload } = await import("./uploads"));
});

beforeEach(() => {
	resolveAuthentication.mockReset();
	objects.clear();
	requests.length = 0;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

it("stores images without ACLs and serves them through the signed application proxy", async () => {
	const key = "uploads/user-1/pictures/photo.png";
	const data = new Uint8Array([137, 80, 78, 71]);
	await storage.write({ key, data, contentType: "image/png" });
	expect(requests[0]?.headers["x-amz-acl"]).toBeUndefined();
	const direct = await fetch(`${envMock.S3_ENDPOINT}/${envMock.S3_BUCKET}/${key}`);
	expect(direct.status).toBe(403);
	const response = await handleUpload(new Request(`${envMock.APP_URL}/api/${key}`));
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("image/png");
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(data);
	expect(requests.at(-1)?.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
});

it("stores private attachments without ACLs while keeping them outside the public proxy", async () => {
	const key = "uploads/user-1/agent/thread-1/private.txt";
	const data = new TextEncoder().encode("private attachment");
	await storage.write({ key, data, contentType: "text/plain", private: true });
	expect(requests[0]?.headers["x-amz-acl"]).toBeUndefined();
	const requestCount = requests.length;
	const response = await handleUpload(new Request(`${envMock.APP_URL}/api/${key}`));
	expect(response.status).toBe(404);
	expect(requests).toHaveLength(requestCount);
	const direct = await fetch(`${envMock.S3_ENDPOINT}/${envMock.S3_BUCKET}/${key}`);
	expect(direct.status).toBe(403);
	expect((await storage.read(key))?.data).toEqual(data);
});

it.each(["text/html", "image/svg+xml"])("downloads stored %s uploads instead of rendering them", async (type) => {
	const key = "uploads/user-1/pictures/upload.bin";
	await storage.write({ key, data: new TextEncoder().encode("<script>alert(1)</script>"), contentType: type });
	resolveAuthentication.mockResolvedValue({ user: { id: "user-1" }, permissions: ["read"] });
	const response = await handleUpload(new Request(`${envMock.APP_URL}/api/${key}`));
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
	expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="upload.bin"');
});

it("requires the upload owner before serving application PDFs, including conditional requests", async () => {
	const key = "uploads/user-1/pictures/application.pdf";
	await storage.write({
		key,
		data: new TextEncoder().encode("private application PDF"),
		contentType: "application/pdf",
	});
	for (const viewer of [
		null,
		{ user: { id: "other-user" }, permissions: ["read"] },
		{ user: { id: "user-1" }, permissions: ["write"] },
	]) {
		resolveAuthentication.mockResolvedValue(viewer);
		const response = await handleUpload(
			new Request(`${envMock.APP_URL}/api/${key}`, { headers: { "If-None-Match": '"test-etag"' } }),
		);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain("private application PDF");
	}
	resolveAuthentication.mockResolvedValue({ user: { id: "user-1" }, permissions: ["read"] });
	const response = await handleUpload(new Request(`${envMock.APP_URL}/api/${key}`));
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("private application PDF");
	expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
