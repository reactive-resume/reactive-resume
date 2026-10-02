import type {
	DurableObjectNamespace,
	ExecutionContext,
	Fetcher,
	Hyperdrive,
	R2Bucket,
} from "@cloudflare/workers-types";
import type { CoordinationService } from "@reactive-resume/db/coordination";
import { AsyncLocalStorage } from "node:async_hooks";
import { on } from "node:events";
import { isIP } from "node:net";
import wasm from "@formepdf/core/pkg-web/forme_bg.wasm";
import { init } from "@formepdf/core/worker";
import { Pool } from "pg";
import { configureAgentStreamLifetime } from "@reactive-resume/api/features/agent/streams";
import { configureStorageService, getStorageService } from "@reactive-resume/api/features/storage";
import { initializeAuth } from "@reactive-resume/auth/config";
import { withDatabasePool } from "@reactive-resume/db/client";
import { configureCoordination } from "@reactive-resume/db/coordination";
import { env } from "@reactive-resume/env/server";
import { configureOwnPictureReader } from "@reactive-resume/pdf/server";
import { TRUSTED_IP_HEADERS } from "@reactive-resume/utils/rate-limit";
import { createApp } from "../http/app";
import { R2StorageService } from "./r2";

export { Coordination } from "./coordination";

export type CloudflareBindings = {
	ASSETS: Fetcher;
	HYPERDRIVE: Hyperdrive;
	BUCKET: R2Bucket;
	COORDINATION: DurableObjectNamespace;
};

const requests = new AsyncLocalStorage<{ bindings: CloudflareBindings; ctx: ExecutionContext }>();
configureAgentStreamLifetime((promise) => requests.getStore()?.ctx.waitUntil(promise));
configureOwnPictureReader(async (key) => {
	const file = await getStorageService().read(key);
	if (!file || file.size > 12_000_000) throw new Error("Picture unavailable or exceeds 12 MB");
	return file.data;
});

const sharedCall = async <T>(key: string, input: object): Promise<T> => {
	const namespace = requests.getStore()?.bindings.COORDINATION;
	if (!namespace) throw new Error("Cloudflare coordination binding is missing");
	const response = await namespace.get(namespace.idFromName(key)).fetch("https://coordination/", {
		method: "POST",
		body: JSON.stringify(input),
	});
	if (!response.ok) throw new Error("Cloudflare coordination is unavailable");
	return response.json<T>();
};
configureCoordination({
	consume: (key, rule) => sharedCall(key, { operation: "consume", ...rule }),
	get: (key) => sharedCall(key, { operation: "get" }),
	set: async (key, value, ttl) => {
		await sharedCall(key, { operation: "set", value, ttl });
	},
	publish: async (key, value) => {
		await sharedCall(key, { operation: "publish", value });
	},
	async *subscribe(key, signal) {
		const namespace = requests.getStore()?.bindings.COORDINATION;
		if (!namespace) throw new Error("Cloudflare coordination binding is missing");
		const response = await namespace
			.get(namespace.idFromName(key))
			.fetch("https://coordination/", { headers: { upgrade: "websocket" } });
		const socket = response.webSocket;
		if (!socket) throw new Error("Cloudflare subscription is unavailable");
		const closed = new AbortController();
		const stopped = signal ? AbortSignal.any([signal, closed.signal]) : closed.signal;
		const messages = on(socket as unknown as EventTarget, "message", { signal: stopped });
		socket.addEventListener("close", () => closed.abort());
		socket.addEventListener("error", () => closed.abort());
		socket.accept();
		try {
			for await (const [event] of messages) {
				const data = (event as MessageEvent).data as unknown;
				if (typeof data === "string") yield data;
			}
		} catch (error) {
			if (!stopped.aborted) throw error;
		} finally {
			socket.close(1000, "Subscription ended");
		}
	},
} satisfies CoordinationService);

const app = createApp({
	serveStatic: false,
	trustedClient: (request) => request.headers.get("x-real-ip") ?? "unknown",
	readWebFile: async (path) => {
		const assetPath = path.includes("dist-prerender/")
			? `/_prerender/${path.split("dist-prerender/")[1]}`
			: "/index.html";
		const response = await requests.getStore()?.bindings.ASSETS.fetch(new URL(assetPath, env.APP_URL).href);
		if (!response?.ok) throw new Error("Web asset is unavailable");
		return response.text();
	},
});

/** Keep the request's pool alive until streaming finishes, including client cancellation. */
function closePoolAfterResponse(
	response: Response,
	pool: Pool,
	bindings: CloudflareBindings,
	ctx: ExecutionContext,
): Response {
	let closed = false;
	const close = () => {
		if (!closed) {
			closed = true;
			ctx.waitUntil(pool.end());
		}
	};
	const run = <T>(callback: () => T) => requests.run({ bindings, ctx }, () => withDatabasePool(pool, callback));
	if (!response.body) {
		close();
		return response;
	}
	const reader = response.body.getReader();
	return new Response(
		new ReadableStream<Uint8Array>({
			pull(controller) {
				return run(async () => {
					try {
						const { done, value } = await reader.read();
						if (done) {
							controller.close();
							close();
						} else controller.enqueue(value);
					} catch (error) {
						controller.error(error);
						close();
					}
				});
			},
			cancel(reason) {
				return run(async () => {
					try {
						await reader.cancel(reason);
					} finally {
						close();
					}
				});
			},
		}),
		response,
	);
}

export default {
	async fetch(request: Request, bindings: CloudflareBindings, ctx: ExecutionContext): Promise<Response> {
		if (new URL(request.url).pathname.startsWith("/_prerender")) return new Response("Not Found", { status: 404 });
		if (!env.CLOUDFLARE || env.STORAGE_BACKEND !== "r2" || !env.FLAG_DISABLE_IMAGE_PROCESSING || env.REDIS_URL) {
			throw new Error("Cloudflare requires CLOUDFLARE=1, R2, disabled image processing and no REDIS_URL.");
		}
		configureStorageService(new R2StorageService(bindings.BUCKET, env.DEPLOYMENT_NAMESPACE));
		const headers = new Headers(request.headers);
		const ip = headers.get("cf-connecting-ip");
		for (const name of TRUSTED_IP_HEADERS) headers.delete(name);
		if (ip && isIP(ip)) {
			headers.set("x-real-ip", ip);
			headers.set("x-forwarded-for", ip);
		}
		const pool = new Pool({
			connectionString: bindings.HYPERDRIVE.connectionString,
			max: 1,
			connectionTimeoutMillis: 10_000,
		});
		const logError = (error: Error) => {
			if (!pool.ending) console.error("[cloudflare] Database connection failed", error.message);
		};
		pool.on("error", logError);
		pool.on("connect", (client) => client.on("error", logError));
		try {
			const response = await requests.run({ bindings, ctx }, () =>
				withDatabasePool(pool, async () => {
					await initializeAuth();
					await init(wasm);
					return app.fetch(new Request(request, { headers }));
				}),
			);
			return closePoolAfterResponse(response, pool, bindings, ctx);
		} catch (error) {
			ctx.waitUntil(pool.end());
			throw error;
		}
	},
};
