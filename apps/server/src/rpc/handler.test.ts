import { format } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const secret = vi.hoisted(() => "private-value@example.test");

vi.mock("@reactive-resume/api/routers", async () => {
	const { ORPCError, os } = await import("@orpc/server");
	return {
		default: {
			diagnostics: {
				crash: os.handler(() => {
					throw new TypeError(`Failed query: select 1\nparams: ${secret}`);
				}),
				missing: os.handler(() => {
					throw new ORPCError("NOT_FOUND", { message: `No resume for ${secret}` });
				}),
				signedOut: os.handler(() => {
					throw new ORPCError("UNAUTHORIZED");
				}),
			},
		},
	};
});

const { handleRpc } = await import("./handler");

const call = (procedure: string, headers: Record<string, string> = {}) =>
	handleRpc(
		new Request(`http://localhost:3000/api/rpc/diagnostics/${procedure}`, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...headers },
			body: JSON.stringify({}),
		}),
		"127.0.0.1",
	);
const logged = () =>
	vi
		.mocked(console.error)
		.mock.calls.map((args) => format(...args))
		.join("\n");
const loggedObject = () => vi.mocked(console.error).mock.calls[0]?.[1] as Record<string, unknown> | undefined;

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.stubEnv("CLOUDFLARE", "");
	vi.stubEnv("VERCEL", "");
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("RPC error logging", () => {
	it("names the procedure, error class and platform request for an unexpected failure, without its message", async () => {
		vi.stubEnv("CLOUDFLARE", "1");
		const response = await call("crash", { "cf-ray": "8a1b2c3d4e5f6a7b-IAD" });
		expect(response.status).toBe(500);
		expect((await response.json()).json).toMatchObject({
			code: "INTERNAL_SERVER_ERROR",
			message: "Internal server error",
		});
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(vi.mocked(console.error).mock.calls[0]?.[0]).toBe("[oRPC Server]");
		expect(loggedObject()).toMatchObject({
			procedure: "diagnostics.crash",
			code: "INTERNAL_SERVER_ERROR",
			errorName: "TypeError",
			requestId: "8a1b2c3d4e5f6a7b-IAD",
		});
		const stack = loggedObject()?.stack as string[];
		expect(stack.length).toBeGreaterThan(0);
		for (const frame of stack) expect(frame).toMatch(/^at /);
		expect(logged()).not.toContain(secret);
		expect(logged()).not.toContain("Failed query");
	});

	it("logs a deliberate oRPC error by procedure and code only", async () => {
		const response = await call("missing");
		expect(response.status).toBe(404);
		expect(console.error).toHaveBeenCalledTimes(1);
		expect(loggedObject()).toEqual({ procedure: "diagnostics.missing", code: "NOT_FOUND" });
		expect(logged()).not.toContain(secret);
	});

	it("leaves out a request ID that isn't a plain token", async () => {
		vi.stubEnv("CLOUDFLARE", "1");
		await call("crash", { "cf-ray": "not a token" });
		expect(loggedObject()).not.toHaveProperty("requestId");
		expect(logged()).not.toContain("not a token");
	});

	it("ignores a platform's request header when the server doesn't run on that platform", async () => {
		await call("crash", { "cf-ray": "8a1b2c3d4e5f6a7b-IAD", "x-vercel-id": "iad1::abcde-1700000000000-0123456789ab" });
		expect(loggedObject()).toMatchObject({ procedure: "diagnostics.crash", errorName: "TypeError" });
		expect(loggedObject()).not.toHaveProperty("requestId");
		expect(logged()).not.toContain("8a1b2c3d4e5f6a7b-IAD");
	});

	it("reads Vercel's request ID on Vercel, and not Cloudflare's", async () => {
		vi.stubEnv("VERCEL", "1");
		await call("crash", { "cf-ray": "8a1b2c3d4e5f6a7b-IAD", "x-vercel-id": "iad1::abcde-1700000000000-0123456789ab" });
		expect(loggedObject()).toMatchObject({ requestId: "iad1::abcde-1700000000000-0123456789ab" });
	});

	it("still does not log signed-out callers", async () => {
		const response = await call("signedOut");
		expect(response.status).toBe(401);
		expect(console.error).not.toHaveBeenCalled();
	});
});
