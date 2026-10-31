import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { serve } from "@hono/node-server";

const events = vi.hoisted(() => [] as string[]);
const appFetch = vi.hoisted(() => vi.fn());
vi.mock("./startup/checks", () => ({
	runStartupChecks: async () => {
		await Promise.resolve();
		events.push("migrations complete");
	},
}));
vi.mock("./http/app", () => {
	events.push("auth imported");
	return {
		createApp: () => {
			events.push("app created");
			return { fetch: appFetch };
		},
	};
});
vi.mock("@reactive-resume/auth/config", () => ({
	initializeAuth: async () => {
		await Promise.resolve();
		events.push("auth ready");
	},
}));
vi.mock("@hono/node-server", () => ({
	serve: vi.fn(() => {
		events.push("server listening");
	}),
}));
vi.mock("@reactive-resume/env/server", () => ({ env: { SERVER_PORT: 0 } }));
// Scheduled career and cleanup work have their own tests; here they only have to stop when the server does.
vi.mock("./startup/career-scheduler", () => ({ startCareerScheduler: () => ({ stop: async () => {} }) }));
vi.mock("./startup/storage-cleanup", () => ({ startStorageCleanupScheduler: () => ({ stop: async () => {} }) }));
afterEach(() => vi.restoreAllMocks());

describe("server startup", () => {
	it("finishes migrations before importing auth and seeding OAuth resources", async () => {
		vi.spyOn(process, "on").mockReturnValue(process);
		vi.spyOn(process, "once").mockReturnValue(process);
		const entry = await import("./index");
		expect(events).toEqual([]);
		await entry.main();
		expect(events).toEqual(["migrations complete", "auth imported", "auth ready", "app created", "server listening"]);
	});

	it.each(["SIGTERM", "SIGINT"])("drains active requests before exiting on %s", async (signal) => {
		vi.spyOn(process, "on").mockReturnValue(process);
		const signals = vi.spyOn(process, "once").mockReturnValue(process);
		const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		const started = Promise.withResolvers<void>();
		const finished = Promise.withResolvers<Response>();
		appFetch.mockImplementation(() => {
			started.resolve();
			return finished.promise;
		});
		const { serve: realServe } = await vi.importActual<typeof import("@hono/node-server")>("@hono/node-server");
		let server: ReturnType<typeof serve> | undefined;
		vi.mocked(serve).mockImplementationOnce((options, callback) => {
			server = realServe(options, callback);
			return server;
		});
		await (await import("./index")).main();
		if (!server) throw new Error("Server did not start");
		const runningServer = server;
		try {
			if (!server.listening) await once(server, "listening");
			const address = server.address();
			if (!address || typeof address === "string") throw new Error("Missing HTTP address");
			const url = `http://127.0.0.1:${address.port}`;
			const response = fetch(url);
			await started.promise;
			const shutdown = signals.mock.calls.find(([name]) => name === signal)?.[1];
			expect(shutdown).toBeTypeOf("function");
			const closed = once(server, "close");
			shutdown?.();
			shutdown?.();
			expect(exit).not.toHaveBeenCalled();
			await expect(fetch(url)).rejects.toThrow();
			finished.resolve(new Response("drained"));
			expect(await (await response).text()).toBe("drained");
			await closed;
			// Exit waits for the HTTP drain and the scheduler's stop together, a few microtasks after "close".
			await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
		} finally {
			finished.resolve(new Response("drained"));
			await new Promise<void>((resolve) => runningServer.close(() => resolve()));
		}
	});
});
