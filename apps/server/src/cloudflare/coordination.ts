import type { DurableObjectState, WebSocket } from "@cloudflare/workers-types";
import { z } from "zod";

const inputSchema = z.discriminatedUnion("operation", [
	z.object({
		operation: z.literal("consume"),
		window: z.number().positive(),
		max: z.number().int().positive(),
		rolling: z.boolean().optional(),
	}),
	z.object({ operation: z.literal("set"), value: z.string(), ttl: z.number().positive() }),
	z.object({ operation: z.literal("get") }),
	z.object({ operation: z.literal("publish"), value: z.string().max(8192) }),
]);
type Entry = { expiresAt: number; count?: number; value?: string };
declare const WebSocketPair: new () => { 0: WebSocket; 1: WebSocket };

/** One object per key: unrelated users never contend for the same counter or run state. */
export class Coordination {
	constructor(private readonly ctx: DurableObjectState) {}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("upgrade") === "websocket") {
			const pair = new WebSocketPair();
			this.ctx.acceptWebSocket(pair[1]);
			return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
		}
		const input = inputSchema.parse(await request.json());
		if (input.operation === "publish") {
			for (const socket of this.ctx.getWebSockets()) {
				try {
					socket.send(input.value);
				} catch {
					socket.close(1011, "Delivery failed");
				}
			}
			return Response.json(null);
		}
		const now = Date.now();
		const result = this.ctx.storage.transactionSync(() => {
			const stored = this.ctx.storage.kv.get<Entry>("entry");
			const entry = stored && stored.expiresAt > now ? stored : undefined;
			if (input.operation === "get") return entry?.value ?? null;
			if (input.operation === "set") {
				this.ctx.storage.kv.put("entry", { value: input.value, expiresAt: now + input.ttl });
				return null;
			}
			const count = entry?.count ?? 0;
			const allowed = count < input.max;
			const expiresAt = allowed && input.rolling ? now + input.window : (entry?.expiresAt ?? now + input.window);
			if (allowed) this.ctx.storage.kv.put("entry", { count: count + 1, expiresAt });
			return { allowed, remaining: Math.max(0, input.max - count - (allowed ? 1 : 0)), reset: expiresAt };
		});
		// Schedule only once per active key. The alarm reschedules itself if accepted requests extend the expiry.
		const entry = this.ctx.storage.kv.get<Entry>("entry");
		if (entry && (await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(entry.expiresAt);
		return Response.json(result);
	}

	async alarm(): Promise<void> {
		const entry = this.ctx.storage.kv.get<Entry>("entry");
		if (entry && entry.expiresAt > Date.now()) await this.ctx.storage.setAlarm(entry.expiresAt);
		else await this.ctx.storage.deleteAll();
	}

	webSocketClose(socket: WebSocket, code: number, reason: string): void {
		socket.close(code, reason);
	}
	webSocketError(socket: WebSocket): void {
		socket.close(1011, "Connection failed");
	}
}
