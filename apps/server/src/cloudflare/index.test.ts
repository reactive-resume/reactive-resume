import type { CloudflareBindings } from "./index";
import type { ExecutionContext, ScheduledController } from "@cloudflare/workers-types";
import type { CoordinationService } from "@reactive-resume/db/coordination";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getPool } from "@reactive-resume/db/client";
import worker from "./index";

const mocks = vi.hoisted(() => ({
	run: vi.fn<() => Promise<{ processed: number }>>(),
	cleanup: vi.fn<() => Promise<unknown>>(),
	auth: vi.fn<() => Promise<void>>(),
	wasm: vi.fn<() => Promise<void>>(),
	fetch: vi.fn<(request: Request) => Promise<Response>>(),
	pools: [] as Array<{ ending: boolean; end: () => Promise<void> }>,
	lifetime: ((_promise: Promise<unknown>) => {
		throw new Error("Agent lifetime handler was not configured");
	}) as (promise: Promise<unknown>) => void,
	coordination: undefined as CoordinationService | undefined,
	publicOwner: vi.fn(),
	readPicture: vi.fn(),
	pictureReader: undefined as ((key: string) => Promise<Uint8Array>) | undefined,
}));

vi.mock("pg", () => ({
	Pool: class {
		ending = false;
		end = vi.fn(async () => {
			this.ending = true;
		});
		on = vi.fn(() => this);
		constructor() {
			mocks.pools.push(this);
		}
	},
}));
vi.mock("@reactive-resume/env/server", () => ({
	env: {
		CLOUDFLARE: true,
		STORAGE_BACKEND: "r2",
		FLAG_DISABLE_IMAGE_PROCESSING: true,
		APP_URL: "https://resume.example",
		DATABASE_URL: "postgresql://synthetic:test@localhost/test",
		DATABASE_POOL_MAX: 1,
		DEPLOYMENT_NAMESPACE: "test",
	},
}));
vi.mock("@formepdf/core/pkg-web/forme_bg.wasm", () => ({ default: new Uint8Array() }));
vi.mock("@formepdf/core/worker", () => ({ init: mocks.wasm }));
vi.mock("@reactive-resume/auth/config", () => ({ initializeAuth: mocks.auth }));
vi.mock("@reactive-resume/api/features/career/jobs", () => ({ runCareerJobs: mocks.run }));
vi.mock("@reactive-resume/api/features/storage/cleanup", () => ({
	runStorageCleanup: mocks.cleanup,
	reportStorageCleanupSummary: vi.fn(),
}));
vi.mock("@reactive-resume/api/features/agent/streams", () => ({
	configureAgentStreamLifetime: (lifetime: (promise: Promise<unknown>) => void) => {
		mocks.lifetime = lifetime;
	},
}));
vi.mock("@reactive-resume/db/coordination", () => ({
	configureCoordination: (coordination: CoordinationService) => {
		mocks.coordination = coordination;
	},
}));
vi.mock("@reactive-resume/api/features/storage", () => ({
	configureStorageService: vi.fn(),
	getStorageService: () => ({ read: mocks.readPicture }),
	isPublicUploadOwner: mocks.publicOwner,
}));
vi.mock("@reactive-resume/pdf/server", () => ({
	configureOwnPictureReader: (reader: typeof mocks.pictureReader) => {
		mocks.pictureReader = reader;
	},
}));
vi.mock("@reactive-resume/utils/rate-limit", () => ({ TRUSTED_IP_HEADERS: ["x-real-ip", "x-forwarded-for"] }));
vi.mock("../http/app", () => ({ createApp: () => ({ fetch: mocks.fetch }) }));
vi.mock("./coordination", () => ({ Coordination: class {} }));
vi.mock("./r2", () => ({ R2StorageService: class {} }));

function invocation() {
	const pending: Promise<unknown>[] = [];
	const durableFetch = vi.fn(async () => Response.json("present"));
	const bindings = {
		BUCKET: {},
		HYPERDRIVE: { connectionString: "postgresql://synthetic:test@localhost/invocation" },
		COORDINATION: { idFromName: (key: string) => key, get: () => ({ fetch: durableFetch }) },
	} as unknown as CloudflareBindings;
	const ctx = {
		waitUntil(promise: Promise<unknown>) {
			pending.push(promise);
			// The runtime observes rejections even before a test awaits the invocation.
			void promise.catch(() => undefined);
		},
	} as unknown as ExecutionContext;
	const controller: ScheduledController = { scheduledTime: 0, cron: "* * * * *", noRetry: vi.fn() };
	return { bindings, ctx, controller, pending, durableFetch };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function invocationPool() {
	const pool = mocks.pools[0];
	if (!pool) throw new Error("Invocation did not create a pool");
	return pool;
}

beforeEach(() => {
	mocks.pools.length = 0;
	mocks.run.mockReset().mockResolvedValue({ processed: 0 });
	mocks.cleanup.mockReset().mockResolvedValue({ completed: 0, missing: 0, failed: 0, partial: 0, abandoned: 0 });
	mocks.auth.mockReset().mockResolvedValue();
	mocks.wasm.mockReset().mockResolvedValue();
	mocks.fetch.mockReset().mockResolvedValue(new Response("ok"));
});

describe("Cloudflare invocation lifetime", () => {
	it("rejects a banned owner's picture before reading storage", async () => {
		mocks.publicOwner.mockResolvedValue(false);
		await expect(mocks.pictureReader?.("uploads/banned/pictures/photo.png")).rejects.toThrow("Picture unavailable");
		expect(mocks.publicOwner).toHaveBeenCalledWith("banned");
		expect(mocks.readPicture).not.toHaveBeenCalled();
	});
	it("runs scheduled work in its request context and drains nested background work before closing its pool", async () => {
		const fixture = invocation();
		const job = Promise.withResolvers<void>();
		const background = Promise.withResolvers<void>();
		const nested = Promise.withResolvers<void>();
		const nestedStarted = Promise.withResolvers<void>();
		const stages: string[] = [];
		let authPool: unknown;
		let jobPool: unknown;
		let backgroundPool: unknown;
		let coordinationResult: unknown;
		mocks.auth.mockImplementation(async () => {
			authPool = getPool();
			stages.push("auth");
		});
		mocks.wasm.mockImplementation(async () => {
			stages.push("wasm");
		});
		mocks.run.mockImplementation(async () => {
			stages.push("job");
			jobPool = getPool();
			coordinationResult = await mocks.coordination?.get("scheduled-context");
			mocks.lifetime(
				background.promise.then(() => {
					backgroundPool = getPool();
					mocks.lifetime(nested.promise);
					nestedStarted.resolve();
				}),
			);
			await job.promise;
			return { processed: 0 };
		});

		worker.scheduled(fixture.controller, fixture.bindings, fixture.ctx);
		await nextTurn();
		const pool = invocationPool();
		expect(stages).toEqual(["auth", "wasm", "job"]);
		expect(authPool).toBe(pool);
		expect(jobPool).toBe(pool);
		expect(coordinationResult).toBe("present");
		expect(fixture.durableFetch).toHaveBeenCalledOnce();
		expect(pool.end).not.toHaveBeenCalled();
		job.resolve();
		await nextTurn();
		expect(pool.end).not.toHaveBeenCalled();
		background.resolve();
		await nestedStarted.promise;
		await nextTurn();
		expect(backgroundPool).toBe(pool);
		expect(pool.end).not.toHaveBeenCalled();
		nested.resolve();
		await Promise.all(fixture.pending);
		expect(pool.end).toHaveBeenCalledOnce();
	});

	it("retains the pool for background work when a scheduled runner rejects", async () => {
		const fixture = invocation();
		const background = Promise.withResolvers<void>();
		const failure = new Error("Synthetic scheduled failure");
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.run.mockImplementation(async () => {
			mocks.lifetime(background.promise);
			throw failure;
		});
		worker.scheduled(fixture.controller, fixture.bindings, fixture.ctx);
		await nextTurn();
		const pool = invocationPool();
		expect(mocks.run).toHaveBeenCalledOnce();
		expect(pool.end).not.toHaveBeenCalled();
		background.resolve();
		await expect(fixture.pending[0]).resolves.toBeUndefined();
		expect(pool.end).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalled();
	});

	it("waits for the career runner before closing the pool when cleanup rejects", async () => {
		const fixture = invocation();
		const career = Promise.withResolvers<void>();
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		mocks.run.mockImplementation(async () => {
			await career.promise;
			return { processed: 1 };
		});
		mocks.cleanup.mockRejectedValueOnce(new Error("cleanup failed"));

		worker.scheduled(fixture.controller, fixture.bindings, fixture.ctx);
		await nextTurn();
		const pool = invocationPool();
		expect(mocks.cleanup).toHaveBeenCalledOnce();
		expect(pool.end).not.toHaveBeenCalled();

		career.resolve();
		await Promise.all(fixture.pending);
		expect(pool.end).toHaveBeenCalledOnce();
		expect(log).toHaveBeenCalledWith(expect.stringContaining("storage-cleanup"));
	});

	it("closes the invocation pool when initialization fails before scheduled work starts", async () => {
		const fixture = invocation();
		const failure = new Error("Synthetic initialization failure");
		mocks.auth.mockRejectedValue(failure);
		worker.scheduled(fixture.controller, fixture.bindings, fixture.ctx);
		await expect(fixture.pending[0]).rejects.toBe(failure);
		expect(mocks.run).not.toHaveBeenCalled();
		expect(invocationPool().end).toHaveBeenCalledOnce();
	});

	it("keeps the fetch pool open until the response body has been consumed", async () => {
		const fixture = invocation();
		const body = new TransformStream<Uint8Array, Uint8Array>();
		mocks.fetch.mockResolvedValue(new Response(body.readable));
		const response = await worker.fetch(
			new Request("https://resume.example/api/health"),
			fixture.bindings,
			fixture.ctx,
		);
		const pool = invocationPool();
		expect(pool.end).not.toHaveBeenCalled();
		const writer = body.writable.getWriter();
		const text = response.text();
		await writer.write(new TextEncoder().encode("ok"));
		expect(pool.end).not.toHaveBeenCalled();
		await writer.close();
		expect(await text).toBe("ok");
		await Promise.all(fixture.pending);
		expect(pool.end).toHaveBeenCalledOnce();
	});
});
