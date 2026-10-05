import type { RequestAuthentication } from "@reactive-resume/api/context";
import { once } from "node:events";
import { Socket } from "node:net";
import { setImmediate } from "node:timers/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serve } from "@hono/node-server";
import { Pool } from "pg";
import z from "zod";

const mocks = vi.hoisted(() => ({
	authentication: vi.fn(),
	limit: vi.fn(),
	call: vi.fn(),
	execute: vi.fn(),
	healthcheck: vi.fn(),
}));
vi.mock("@reactive-resume/db/client", async (original) => {
	const actual = await original<typeof import("@reactive-resume/db/client")>();
	return {
		...actual,
		db: new Proxy(actual.db, {
			get: (target, property) => (property === "execute" ? mocks.execute : Reflect.get(target, property)),
		}),
	};
});
vi.mock("@reactive-resume/db/redis", async (original) => ({
	...(await original<typeof import("@reactive-resume/db/redis")>()),
	getRedis: () => null,
}));
vi.mock("@reactive-resume/api/features/storage", async (original) => ({
	...(await original<typeof import("@reactive-resume/api/features/storage")>()),
	getStorageService: () => ({ healthcheck: mocks.healthcheck }),
}));
vi.mock("@reactive-resume/api/context", async (original) => ({
	...(await original<typeof import("@reactive-resume/api/context")>()),
	resolveAuthenticationFromRequestHeaders: mocks.authentication,
}));
vi.mock("@reactive-resume/api/features/mcp/transport", () => ({
	consumeMcpRequestLimit: mocks.limit,
	consumeMcpUserLimit: mocks.limit,
}));
vi.mock("@orpc/server", async (original) => ({
	...(await original<typeof import("@orpc/server")>()),
	createRouterClient: (_router: unknown, options: { context: () => unknown }) => ({
		resume: {
			listVersions: (input: unknown) => mocks.call("listVersions", input, options.context()),
			deleteVersion: (input: unknown) => mocks.call("deleteVersion", input, options.context()),
		},
	}),
}));

function authentication(id: string, permissions: RequestAuthentication["permissions"]): RequestAuthentication {
	return {
		user: {
			id,
			name: id,
			email: `${id}@example.test`,
			emailVerified: true,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		},
		method: "bearer",
		permissions,
	};
}

function request(method = "tools/list", token = "reader", params: object = {}) {
	return new Request("http://localhost:3000/mcp", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
			Authorization: `Bearer ${token}`,
			Cookie: `session=${token}; locale=en-US`,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.execute.mockImplementation(async () => {
		await setImmediate();
		return [];
	});
	mocks.healthcheck.mockImplementation(async () => {
		await setImmediate();
		return { status: "healthy" };
	});
	mocks.authentication.mockImplementation((headers: Headers) => {
		const token = headers.get("authorization")?.slice(7);
		return token === "reader"
			? authentication("reader", ["read"])
			: token === "writer"
				? authentication("writer", ["read", "write", "delete"])
				: null;
	});
	mocks.call.mockImplementation(
		(
			method: string,
			_input: unknown,
			context: {
				authentication: RequestAuthentication;
				resHeaders: Headers;
			},
		) => {
			context.resHeaders.set("X-MCP-User", context.authentication.user.id);
			return method === "listVersions"
				? [{ id: context.authentication.user.id, kind: "named", name: "Saved", createdAt: new Date(0) }]
				: undefined;
		},
	);
});
afterEach(() => vi.restoreAllMocks());

it("precomputes discovery before the first request without user queries or network calls", async () => {
	const query = vi.spyOn(Pool.prototype, "query").mockImplementation(() => {
		throw new Error("Unexpected database query");
	});
	const connect = vi.spyOn(Pool.prototype, "connect").mockImplementation(() => {
		throw new Error("Unexpected database connection");
	});
	const socket = vi.spyOn(Socket.prototype, "connect").mockImplementation(() => {
		throw new Error("Unexpected network connection");
	});
	const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network call"));
	// Import under the guards: parity contracts are also built during module initialization.
	const { createApp } = await import("../http/app");
	createApp({ serveStatic: false });
	expect(query.mock.calls.length).toBe(0);
	expect(connect.mock.calls.length).toBe(0);
	expect(socket.mock.calls.length).toBe(0);
	expect(fetch.mock.calls.length).toBe(0);
	for (const mock of [mocks.authentication, mocks.call, mocks.execute, mocks.healthcheck, mocks.limit]) {
		expect(mock.mock.calls.length).toBe(0);
	}
	const conversions = vi.spyOn(z.globalRegistry, "get");
	const { handleMcp } = await import("./handler");
	const response = await handleMcp(request());
	expect(response.status).toBe(200);
	expect((await response.json()).result.tools.length).toBeGreaterThan(70);
	expect(conversions.mock.calls.length).toBe(0);
}, 30_000);

it("reuses static schema conversions across separate authenticated discovery requests", async () => {
	const { handleMcp } = await import("./handler");
	// Warm-up models startup. Conversion metadata lookups expose both Zod and SDK conversion work.
	await handleMcp(request());
	const conversions = vi.spyOn(z.globalRegistry, "get");
	const durations: number[] = [];
	for (const token of ["reader", "writer", "reader"]) {
		const started = performance.now();
		const response = await handleMcp(request("tools/list", token));
		expect(response.status).toBe(200);
		expect((await response.json()).result.tools.length).toBeGreaterThan(70);
		durations.push(performance.now() - started);
	}
	console.info("MCP tools/list milliseconds", durations.map(Math.round));
	expect(mocks.authentication).toHaveBeenCalledTimes(4);
	expect(conversions.mock.calls.length).toBe(0);
}, 30_000);

it("keeps concurrent HTTP health checks responsive during repeated MCP discovery", async () => {
	const { createApp } = await import("../http/app");
	const app = createApp({ serveStatic: false, trustedClient: () => "127.0.0.1" });
	const server = serve({ fetch: app.fetch, port: 0 });
	try {
		if (!server.listening) await once(server, "listening");
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing HTTP address");
		const url = `http://127.0.0.1:${address.port}`;
		const input = request();
		const body = await input.text();
		const started = performance.now();
		const discovery = Promise.all(
			Array.from({ length: 20 }, async () => {
				const response = await fetch(`${url}/mcp`, { method: "POST", headers: input.headers, body });
				expect(response.status).toBe(200);
				expect((await response.json()).result.tools.length).toBeGreaterThan(70);
			}),
		);
		// Health probes queue behind the in-flight discoveries, so probe latency tracks the storm's
		// own duration — under an oversubscribed runner both stretch together (CI: ~1.1s storm with
		// ~1.0s probes, tripping the old fixed 1s bound). Measure each probe's own round trip and
		// bound it by the storm; a real stall overshoots a couple of storm windows by far.
		const stormSettled = discovery.then(() => performance.now() - started);
		const health = Promise.all(
			Array.from({ length: 3 }, async () => {
				await setImmediate();
				const probeStarted = performance.now();
				const response = await fetch(`${url}/api/health`);
				expect(response.status).toBe(200);
				expect((await response.json()).status).toBe("healthy");
				return performance.now() - probeStarted;
			}),
		);
		const [stormDuration, healthDurations] = await Promise.all([stormSettled, health]);
		console.info("20 concurrent MCP discoveries milliseconds", Math.round(stormDuration));
		console.info("Concurrent HTTP health milliseconds", healthDurations.map(Math.round));
		expect(Math.max(...healthDurations)).toBeLessThan(stormDuration * 2);
		expect(mocks.execute).toHaveBeenCalledTimes(3);
		expect(mocks.healthcheck).toHaveBeenCalledTimes(3);
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
}, 30_000);

it("keeps credentials, permissions, headers and callbacks isolated between requests", async () => {
	const { handleMcp } = await import("./handler");
	for (const token of ["reader", "writer", "reader"]) {
		const response = await handleMcp(
			request("tools/call", token, {
				name: "api_resume_list_versions",
				arguments: { resumeId: "resume-1" },
			}),
		);
		expect(response.headers.get("x-mcp-user")).toBe(token);
		expect((await response.json()).result.structuredContent.items[0].id).toBe(token);
	}
	const params = { name: "api_resume_delete_version", arguments: { resumeId: "resume-1", versionId: "version-1" } };
	for (const token of ["reader", "writer", "reader"]) {
		const response = await handleMcp(request("tools/call", token, params));
		const result = (await response.json()).result;
		expect(result.isError === true).toBe(token === "reader");
	}
	expect(mocks.call.mock.calls.filter(([method]) => method === "deleteVersion")).toHaveLength(1);
	const contexts = mocks.call.mock.calls.map(
		([, , context]) =>
			context as {
				reqHeaders: Headers;
				resHeaders: Headers;
				authentication: RequestAuthentication;
			},
	);
	expect(new Set(contexts.map((context) => context.resHeaders)).size).toBe(contexts.length);
	for (const context of contexts) {
		expect(context.reqHeaders.has("cookie")).toBe(false);
		expect(context.reqHeaders.get("authorization")).toBe(`Bearer ${context.authentication.user.id}`);
	}
	expect((await handleMcp(request("tools/list", "invalid"))).status).toBe(401);
	expect(mocks.authentication.mock.calls.every(([headers]) => !(headers as Headers).has("cookie"))).toBe(true);
	const beforeInvalidInput = mocks.call.mock.calls.length;
	const invalid = await handleMcp(
		request("tools/call", "reader", {
			name: "api_resume_list_versions",
			arguments: { resumeId: 123 },
		}),
	);
	expect((await invalid.json()).result.isError).toBe(true);
	expect(mocks.call.mock.calls.length).toBe(beforeInvalidInput);
	mocks.call.mockResolvedValueOnce([{ createdAt: "not-a-date" }]);
	const invalidOutput = await handleMcp(
		request("tools/call", "reader", {
			name: "api_resume_list_versions",
			arguments: { resumeId: "resume-1" },
		}),
	);
	expect((await invalidOutput.json()).result).toMatchObject({
		isError: true,
		content: [{ type: "text", text: expect.stringContaining("Output validation error") }],
	});
}, 30_000);
